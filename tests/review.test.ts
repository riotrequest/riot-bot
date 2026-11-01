import fs from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import { browserDestinationBlocked } from '../src/core/browser-policy'
import { planContext } from '../src/core/context-policy'
import { Database } from '../src/core/db'
import { ProviderError } from '../src/core/errors'
import { writeTextFile } from '../src/core/files'
import { resolveWorkspacePath } from '../src/core/path-safety'
import { newId } from '../src/core/ids'
import { createOpenAICompatibleProvider } from '../src/core/provider'
import { fetchPublicUrl, isPrivateAddress, validatePublicUrl } from '../src/core/web'
import { FakeTerminal, makeApp, reopen, tempDir, waitFor } from './helpers'

describe('review regressions', () => {
  it('preserves binary files and enforces the write limit in bytes', () => {
    const dir = tempDir()
    const file = path.join(dir, 'binary.bin')
    const original = Buffer.from([0xff, 0xfe, 0x41, 0x42])
    fs.writeFileSync(file, original)
    expect(writeTextFile(dir, 'binary.bin', 'replacement', true)).toHaveProperty('error')
    expect(fs.readFileSync(file)).toEqual(original)
    expect(writeTextFile(dir, 'large.txt', '😀'.repeat(300_000), true)).toHaveProperty('error')
    expect(fs.existsSync(path.join(dir, 'large.txt'))).toBe(false)
    expect(() => resolveWorkspacePath(dir, 'notes.txt:hidden')).toThrow(/Windows/)
    expect(resolveWorkspacePath(dir, '..notes.txt')).toBe(path.join(dir, '..notes.txt'))
  })

  it('finds this bot’s history, memory, and skills when another bot has many matches', async () => {
    const { app, dbPath } = makeApp()
    const other = app.getSnapshot()
    const target = await app.createBot({ name: 'Recall Test', purpose: 'Check recall', provider: 'openai', model: '', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
    await app.close()
    const db = new Database(dbPath)
    db.migrate()
    const own = { message: '', memory: '', skill: '' }
    try {
      for (let i = 0; i < 25; i += 1) {
        const isOwn = i === 24
        const botId = isOwn ? target.bot.id : other.bot!.id
        const conversationId = isOwn ? target.conversation.id : other.ongoingConversationId!
        const messageId = newId(), memoryId = newId(), skillId = newId()
        db.addMessage({ id: messageId, conversationId, role: 'user', content: 'sharedrecall keyword', toolCallsJson: null, toolCallId: null, toolName: null, createdAt: i, summarized: false, runId: null })
        db.insertMemory({ id: memoryId, botId, content: 'sharedrecall keyword', kind: 'fact', pinned: false, createdAt: i, updatedAt: i, sourceMessageId: null, conversationId, provenance: 'user_explicit' })
        db.insertSkill({ id: skillId, botId, name: 'sharedrecall', description: 'keyword', procedure: 'Check', pitfalls: '', verification: '', enabled: true, createdAt: i, updatedAt: i, sourceConversationId: conversationId, sourceMessageId: null, version: 1, deletedAt: null })
        if (isOwn) Object.assign(own, { message: messageId, memory: memoryId, skill: skillId })
      }
      expect(db.searchMessages('sharedrecall', 1, target.bot.id).map((hit) => hit.messageId)).toEqual([own.message])
      expect(db.searchMemories('sharedrecall', 1, target.bot.id).map((hit) => hit.id)).toEqual([own.memory])
      expect(db.searchSkills('sharedrecall', 1, target.bot.id).map((hit) => hit.id)).toEqual([own.skill])
    } finally { db.close() }
  })

  it('does not use another model’s prices for a budgeted setup call', async () => {
    const { app, provider } = makeApp()
    try {
      app.updateSettings({ inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxEstimatedSpendPerDayUsd: 0 })
      await app.createBot({ name: '', purpose: 'Check setup price', provider: 'openai', model: 'different-model', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      expect(provider.calls).toHaveLength(0)
      expect(app.listActivity('app')).toHaveLength(0)
    } finally { await app.close() }
  })

  it('blocks private IPv6 spellings in both fetches and the browser proxy', async () => {
    for (const address of ['::ffff:7f00:1', '::ffff:a00:1', '0:0:0:0:0:ffff:c0a8:101', '0:0:0:0:0:0:0:1', 'fe80::1%12']) {
      expect(isPrivateAddress(address), address).toBe(true)
      expect(browserDestinationBlocked('example.com', [address]), address).toMatch(/private|local/i)
    }
    expect(isPrivateAddress('::ffff:808:808')).toBe(false)
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
    expect(() => validatePublicUrl('http://[::ffff:127.0.0.1]/')).toThrow(/private|local/i)
    const transport = vi.fn()
    await expect(fetchPublicUrl({
      url: 'https://example.com', lookupHost: async () => ['::ffff:7f00:1'], transport,
      timeoutMs: 1000, maxBytes: 1000, signal: new AbortController().signal
    })).rejects.toThrow(/private|local/i)
    expect(transport).not.toHaveBeenCalled()
  })

  it('enforces Tools off even if the model returns a file action', async () => {
    const { app, provider, dir } = makeApp()
    try {
      app.updateSettings({ toolsEnabled: false, workspacePath: dir, workspaceEditing: true })
      provider.handler = () => ({ content: '', toolCalls: [{ id: 'write', name: 'write_file', arguments: '{"path":"blocked.txt","content":"oops"}' }] })
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Create a file')
      expect(run.status).toBe('paused')
      expect(run.note).toMatch(/tools.*off/i)
      expect(fs.existsSync(path.join(dir, 'blocked.txt'))).toBe(false)
      expect(provider.calls).toHaveLength(1)
    } finally { await app.close() }
  })

  it('honors Tools off while a command is waiting for approval', async () => {
    const terminal = new FakeTerminal()
    const { app, provider } = makeApp({ terminal })
    provider.handler = () => ({ content: '', toolCalls: [{ id: 'command', name: 'run_terminal', arguments: '{"command":"echo test"}' }] })
    const pending = app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Run a command')
    try {
      await waitFor(() => app.pendingApproval() !== null)
      app.updateSettings({ toolsEnabled: false })
      app.resolveApproval(app.pendingApproval()!.id, true)
      expect((await pending).status).toBe('paused')
      expect(terminal.ran).toEqual([])
    } finally { app.stop(); await pending; await app.close() }
  })

  it.each([
    '{"path":"existing.txt"}',
    '{"path":"existing.txt","content":null}',
    '{"path":"existing.txt","content":false}',
    '{"path":"existing.txt","content":"replacement"',
    '[]'
  ])('rejects malformed write arguments before any action in the batch: %s', async (argumentsJson) => {
    const { app, provider, dir } = makeApp()
    const file = path.join(dir, 'existing.txt')
    fs.writeFileSync(file, 'keep this')
    try {
      app.updateSettings({ workspacePath: dir, workspaceEditing: true, maxModelCallsPerTask: 1 })
      provider.handler = () => ({ content: '', toolCalls: [
        { id: 'first', name: 'write_file', arguments: '{"path":"first.txt","content":"should not run"}' },
        { id: 'bad', name: 'write_file', arguments: argumentsJson }
      ] })
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Update the file')
      expect(run.status).toBe('paused')
      expect(run.note).toMatch(/arguments/i)
      expect(fs.readFileSync(file, 'utf8')).toBe('keep this')
      expect(fs.existsSync(path.join(dir, 'first.txt'))).toBe(false)
    } finally { await app.close() }
  })

  it('does not execute a tool batch cut off by the output limit', async () => {
    const { app, provider, dir } = makeApp()
    try {
      app.updateSettings({ workspacePath: dir, workspaceEditing: true, maxModelCallsPerTask: 1 })
      provider.handler = () => ({ content: '', finishReason: 'length', toolCalls: [{ id: 'write', name: 'write_file', arguments: '{"path":"partial.txt","content":"cut off"}' }] })
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Write the file')
      expect(run.status).toBe('paused')
      expect(run.note).toMatch(/output.*limit/i)
      expect(fs.existsSync(path.join(dir, 'partial.txt'))).toBe(false)
    } finally { await app.close() }
  })

  it('rejects a stream that ends without a completion signal and releases it', async () => {
    const chunks: string[] = []
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
      controller.close()
    } })
    const provider = createOpenAICompatibleProvider({ name: 'openrouter', apiKey: 'test-key', fetchImpl: async () => new Response(body) })
    await expect(provider.complete({
      model: 'test', messages: [{ role: 'user', content: 'go' }], stream: true, maxOutputTokens: 64,
      tokenParameter: 'max_completion_tokens', signal: new AbortController().signal, onDelta: (chunk) => chunks.push(chunk)
    })).rejects.toThrow(/stream.*end|incomplete|completion/i)
    expect(chunks.join('')).toBe('partial')
    expect(body.locked).toBe(false)
  })

  it('does not count an HTTP 200 error body as a completed model call', async () => {
    const provider = createOpenAICompatibleProvider({
      name: 'openrouter', apiKey: 'test-key',
      fetchImpl: async () => new Response('{"error":{"message":"provider failure"}}', { headers: { 'content-type': 'application/json' } })
    })
    await expect(provider.complete({
      model: 'test', messages: [{ role: 'user', content: 'go' }], stream: false, maxOutputTokens: 64,
      tokenParameter: 'max_completion_tokens', signal: new AbortController().signal
    })).rejects.toThrow(/provider failure/)
  })

  it('observes cancellation even when the final text and DONE arrive together', async () => {
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({ start(stream) {
      stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
      stream.close()
    } })
    const provider = createOpenAICompatibleProvider({ name: 'openrouter', apiKey: 'test-key', fetchImpl: async () => new Response(body) })
    await expect(provider.complete({
      model: 'test', messages: [{ role: 'user', content: 'go' }], stream: true, maxOutputTokens: 64,
      tokenParameter: 'max_completion_tokens', signal: controller.signal, onDelta: () => controller.abort()
    })).rejects.toMatchObject({ kind: 'cancelled' })
    expect(body.locked).toBe(false)
  })

  it.each(['reply', 'provider check', 'bot setup'])('waits for an active %s to settle before closing the database', async (operation) => {
    const { app, provider, dbPath } = makeApp()
    let settled = false
    provider.handler = (input) => new Promise((_resolve, reject) => {
      input.signal.addEventListener('abort', () => { setTimeout(() => { settled = true; reject(new ProviderError('cancelled', 'Stopped.')) }, 10) }, { once: true })
    })
    const pending = operation === 'provider check' ? app.runProviderCheck()
      : operation === 'bot setup' ? app.createBot({ name: '', purpose: 'Help with code', provider: 'openai', model: 'mock-model', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      : app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Hello')
    await waitFor(() => provider.calls.length === 1)
    if (operation === 'reply') await expect(app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Another request')).rejects.toThrow(/already working/)
    await app.close()
    expect(settled).toBe(true)
    await pending
    const restarted = reopen(dbPath)
    try {
      expect(restarted.app.getSnapshot().runningBotId).toBeNull()
      expect(restarted.app.listActivity('app').every((entry) => entry.outcome !== 'started')).toBe(true)
    } finally { await restarted.app.close() }
  })

  it('keeps partial text and avoids an automatic retry after text has streamed', async () => {
    const { app, provider } = makeApp()
    try {
      provider.handler = (input) => {
        input.onDelta?.('Useful partial answer')
        throw new ProviderError('transient', 'Connection lost after streaming')
      }
      const conversationId = app.getSnapshot().ongoingConversationId!
      const run = await app.sendMessage(conversationId, 'Tell me something')
      expect(run.status).toBe('failed')
      expect(provider.calls).toHaveLength(1)
      expect(app.openConversation(conversationId).messages.some((message) => message.content === 'Useful partial answer')).toBe(true)
    } finally { await app.close() }
  })

  it('does not report an unrelated provider error as successful cancellation', async () => {
    const { app, provider } = makeApp()
    try {
      provider.handler = (input) => {
        const last = input.messages.at(-1)?.content ?? ''
        if (last.includes('weather')) throw new ProviderError('unknown', 'unrelated failure')
        return { content: 'pong', toolCalls: [] }
      }
      const result = await app.runProviderCheck()
      expect(result.steps.find((step) => step.name === 'Streaming reply')).toMatchObject({ ok: false })
      expect(result.steps.find((step) => step.name === 'Cancellation')).toMatchObject({ ok: false })
    } finally { await app.close() }
  })

  it('reserves no input room when the reply consumes the context window', () => {
    expect(planContext({ mode: 'automatic', contextTokenBudget: 8000, maxOutputTokens: 2048, configuredCapacity: 1024, providerCapacity: null }).inputCeiling).toBe(0)
  })

  it('aborts an in-flight model call when the task deadline expires', async () => {
    vi.useFakeTimers()
    const { app, provider } = makeApp()
    let pending: ReturnType<typeof app.sendMessage> | undefined
    try {
      app.updateSettings({ maxTaskDurationMs: 10_000 })
      provider.handler = (input) => new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new ProviderError('cancelled', 'Stopped.')), { once: true })
      })
      pending = app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Wait for a long reply')
      await vi.waitFor(() => expect(provider.calls).toHaveLength(1))
      await vi.advanceTimersByTimeAsync(10_001)
      expect(provider.calls[0].signal.aborted).toBe(true)
      const run = await pending
      expect(run.status).toBe('paused')
      expect(run.note).toMatch(/time limit/i)
    } finally {
      app.stop()
      await pending
      await app.close()
      vi.useRealTimers()
    }
  })

  it('can stop a context-catalog lookup before any model call', async () => {
    let started = false
    const { app, provider } = makeApp({ fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      started = true
      init?.signal?.addEventListener('abort', () => reject(new Error('catalog cancelled')), { once: true })
    }) })
    app.updateSettings({ provider: 'openrouter' })
    const pending = app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Hello')
    await waitFor(() => started)
    app.stop()
    const run = await pending
    expect(run.status).toBe('stopped')
    expect(provider.calls).toHaveLength(0)
    await app.close()
  })
})
