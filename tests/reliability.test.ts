import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { buildContext } from '../src/core/context'
import { Database, type MessageRecord } from '../src/core/db'
import { ProviderError } from '../src/core/errors'
import { newId } from '../src/core/ids'
import { MemoryLogger } from '../src/core/logger'
import { createOpenAICompatibleProvider } from '../src/core/provider'
import { parseSkillMarkdown, skillToMarkdown } from '../src/core/skills'
import { openDatabase } from '../src/core/sqlite'
import { describePinnedConnection, fetchPublicUrl } from '../src/core/web'
import { makeApp } from './helpers'

describe('provider streams', () => {
  it('joins fragmented tool calls, keeps every call, and reports finish and usage', async () => {
    const logger = new MemoryLogger()
    const key = 'sk-test-secret'
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"list_mem',
      'ories","arguments":""}}]}}]}\n\n',
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"' } }] } }] }),
      sse({
        choices: [
          {
            finish_reason: 'tool_calls',
            delta: {
              tool_calls: [
                { index: 1, id: 'call_b', function: { name: 'read_skill', arguments: '{"id":"abc"}' } },
                { index: 0, function: { arguments: 'tea"}' } }
              ]
            }
          }
        ]
      }),
      'data: {"usage":{"prompt_tokens":11,"completion_tokens":7,"cost":0.02}}'
    ]
    const provider = createOpenAICompatibleProvider({
      name: 'openai',
      apiKey: key,
      logger,
      fetchImpl: async () => streamResponse(chunks)
    })
    const response = await provider.complete({
      model: 'fixture-model',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
      maxOutputTokens: 64,
      tokenParameter: 'max_completion_tokens',
      signal: new AbortController().signal
    })
    expect(response.toolCalls).toEqual([
      { id: 'call_a', name: 'list_memories', arguments: '{"query":"tea"}' },
      { id: 'call_b', name: 'read_skill', arguments: '{"id":"abc"}' }
    ])
    expect(response.finishReason).toBe('tool_calls')
    expect(response.usage).toMatchObject({ inputTokens: 11, outputTokens: 7, reportedCostUsd: 0.02 })
    expect(logger.lines.join('\n')).not.toContain(key)
  })

  it('redacts a stream error and treats cancellation after send as a stop', async () => {
    const key = 'sk-test-secret'
    const failing = createOpenAICompatibleProvider({
      name: 'openrouter',
      apiKey: key,
      fetchImpl: async () => streamResponse([`data: {"error":{"message":"rejected ${key}"}}\n\n`])
    })
    await expect(
      failing.complete({
        model: 'fixture-model',
        messages: [{ role: 'user', content: 'go' }],
        stream: true,
        maxOutputTokens: 16,
        tokenParameter: 'max_completion_tokens',
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/\[redacted\]/)

    const controller = new AbortController()
    const cancelling = createOpenAICompatibleProvider({
      name: 'openai',
      apiKey: key,
      fetchImpl: async () => streamResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'], controller)
    })
    await expect(
      cancelling.complete({
        model: 'fixture-model',
        messages: [{ role: 'user', content: 'go' }],
        stream: true,
        maxOutputTokens: 16,
        tokenParameter: 'max_completion_tokens',
        signal: controller.signal,
        onDelta: () => controller.abort()
      })
    ).rejects.toThrow(/^Stopped\.$/)
  })
})

describe('context assembly', () => {
  it('keeps the full current user message and does not split a tool pair', () => {
    const current = `CURRENT-TOKEN ${'word '.repeat(2500)}`
    const oldId = newId()
    const built = buildContext({
      systemPrompt: 'Stay brief.',
      pinnedInstructions: '',
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: [stored(oldId, `OLD-TOKEN ${'x '.repeat(800)}`, 'user', 1), stored(newId(), current, 'user', 2)],
      tokenBudget: 2500,
      responseAllowance: 200
    })
    const text = built.messages.map((message) => message.content).join('\n')
    expect(text).toContain(current)
    expect(text).not.toContain('OLD-TOKEN')
    expect(built.omittedMessageIds).toContain(oldId)
    expect(built.pauseReason ?? '').toMatch(/not shortened|left out/)

    const assistantId = newId()
    const toolA = newId()
    const toolB = newId()
    const userId = newId()
    const paired = buildContext({
      systemPrompt: 'Stay brief.',
      pinnedInstructions: '',
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: [
        stored(oldId, `OLD-TOKEN ${'x '.repeat(800)}`, 'user', 1),
        { ...stored(assistantId, '', 'assistant', 2), toolCallsJson: JSON.stringify([{ id: 'call-a', name: 'list_memories', arguments: '{}' }, { id: 'call-b', name: 'read_skill', arguments: '{"id":"s"}' }]) },
        { ...stored(toolA, 'result-a', 'tool', 3), toolCallId: 'call-a', toolName: 'list_memories' },
        { ...stored(toolB, 'result-b', 'tool', 4), toolCallId: 'call-b', toolName: 'read_skill' },
        stored(userId, 'What remains?', 'user', 5)
      ],
      tokenBudget: 2500,
      responseAllowance: 100
    })
    const pairedText = paired.messages.map((message) => `${message.content} ${message.toolCalls?.map((call) => call.id).join(' ') ?? ''}`).join('\n')
    expect(pairedText).toContain('call-a')
    expect(pairedText).toContain('call-b')
    expect(pairedText).toContain('result-a')
    expect(pairedText).toContain('result-b')
    expect(paired.omittedMessageIds).not.toEqual(expect.arrayContaining([assistantId, toolA, toolB]))

    const incomplete = buildContext({
      systemPrompt: 'Stay brief.',
      pinnedInstructions: '',
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: [
        { ...stored(assistantId, '', 'assistant', 1), toolCallsJson: JSON.stringify([{ id: 'call-a', name: 'list_memories', arguments: '{}' }, { id: 'call-b', name: 'read_skill', arguments: '{}' }]) },
        { ...stored(toolA, 'only-one-result', 'tool', 2), toolCallId: 'call-a', toolName: 'list_memories' },
        stored(userId, 'Continue', 'user', 3)
      ],
      tokenBudget: 8000
    })
    const incompleteText = incomplete.messages.map((message) => message.content).join('\n')
    expect(incompleteText).not.toContain('only-one-result')
    expect(incompleteText).not.toContain('call-a')
    expect(incomplete.omittedMessageIds).not.toContain(assistantId)
  })

  it('refuses to discard oversized pinned instructions', () => {
    const pin = `PIN-KEEP-${'pq'.repeat(8000)}`
    const built = buildContext({
      systemPrompt: 'Stay brief.',
      pinnedInstructions: pin,
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: [stored(newId(), 'Hello', 'user', 1)],
      tokenBudget: 4000,
      responseAllowance: 2048,
      toolTokenReserve: 400
    })
    expect(built.hardStop).toBe(true)
    expect(built.pauseReason).toMatch(/Pinned instructions/)
    expect(built.messages.map((message) => message.content).join('\n')).toContain(pin)
  })
})

describe('accounting and recall', () => {
  it('keeps a conservative estimate when a sent request is cancelled without usage', async () => {
    const { app, provider } = makeApp()
    app.updateSettings({ inputUsdPerMillion: 3, outputUsdPerMillion: 9, maxOutputTokens: 200 })
    provider.handler = () => {
      throw new ProviderError('cancelled', 'Stopped.')
    }
    const conversationId = app.getSnapshot().conversations[0].id
    const run = await app.sendMessage(conversationId, 'Hello')
    expect(run.status).toBe('stopped')
    const entry = app.listActivity()[0]
    expect(entry.costLabel).toBe('estimated')
    expect(entry.estimatedCostUsd).toBeGreaterThan(0)
    expect(entry.outputTokens).toBe(0)
    expect(app.getUsage().estimatedUsd).toBeGreaterThan(0)
    await app.close()
  })

  it('does not call a provider when dollar limits have no price', async () => {
    const { app, provider } = makeApp()
    app.updateSettings({ maxEstimatedSpendPerTaskUsd: 1, inputUsdPerMillion: null, outputUsdPerMillion: null })
    const plan = app.planProviderCheck()
    expect(provider.calls).toHaveLength(0)
    expect(plan.blockedReason).toMatch(/price/)
    await expect(app.runProviderCheck()).rejects.toThrow(/price/)
    expect(provider.calls).toHaveLength(0)
    await app.close()
  })

  it('drops a deleted memory and a disabled skill from the next request', async () => {
    const { app, provider } = makeApp()
    const first = app.getSnapshot().conversations[0].id
    provider.handler = () => ({ content: 'Noted.', toolCalls: [] })
    await app.sendMessage(first, 'Remember this: the codename is ORCHID-42.')
    const memory = app.listMemories()[0]
    app.deleteMemory(memory.id)
    const skill = app.saveSkill({
      name: 'Deploy',
      description: 'Use when deploying the app',
      procedure: 'Run the unique step ZEPHYR-SKILL-9',
      pitfalls: '',
      verification: 'Confirm ZEPHYR-SKILL-9'
    })
    app.setSkillEnabled(skill.id, false)
    const second = app.createConversation().id
    let seen = ''
    provider.handler = (input) => {
      seen = input.messages.map((message) => message.content).join('\n')
      return { content: 'I do not have that in the current notes.', toolCalls: [] }
    }
    await app.sendMessage(second, 'How do we deploy, and what is the codename?')
    expect(seen).not.toContain('ORCHID-42')
    expect(seen).not.toContain('ZEPHYR-SKILL-9')
    expect(seen).not.toContain('Deploy')
    const enabled = app.setSkillEnabled(skill.id, true)
    await app.sendMessage(second, 'How do we deploy the app?')
    expect(seen).toContain(enabled.name)
    expect(seen).not.toContain('ZEPHYR-SKILL-9')
    await app.close()
  })

  it('labels history roles and can read the surrounding messages', async () => {
    const { app, provider } = makeApp()
    const conversationId = app.getSnapshot().conversations[0].id
    provider.handler = () => ({ content: 'I suggest blue instead.', toolCalls: [] })
    await app.sendMessage(conversationId, 'We talked about using the brick color.')
    provider.handler = (input) => {
      const tools = input.messages.filter((message) => message.role === 'tool')
      if (tools.length === 0) {
        return { content: '', toolCalls: [{ id: 'h1', name: 'search_history', arguments: JSON.stringify({ query: 'brick color' }) }] }
      }
      if (tools.length === 1) {
        expect(tools[0].content).toContain('user statement')
        const id = /([0-9a-f-]{8,80}) \| user statement/i.exec(tools[0].content)?.[1]
        return { content: '', toolCalls: [{ id: 'h2', name: 'read_history', arguments: JSON.stringify({ message_id: id, before: 2, after: 2 }) }] }
      }
      expect(tools[1].content).toContain('assistant suggestion')
      expect(tools[1].content).toContain('user statement')
      return { content: 'The user mentioned brick color. The assistant suggested blue. The transcript does not show a confirmed decision.', toolCalls: [] }
    }
    const run = await app.sendMessage(conversationId, 'What did we decide about that yesterday?')
    expect(run.status).toBe('completed')
    const reply = app.openConversation(conversationId).messages.at(-1)?.content ?? ''
    expect(reply).toContain('does not show a confirmed decision')
    await app.close()
  })

  it('saves a skill only for an explicit request and restores an older version', async () => {
    const { app, provider } = makeApp()
    const conversationId = app.getSnapshot().conversations[0].id
    const draft = {
      name: 'Deploy',
      description: 'Use when deploying',
      procedure: 'Run the first check',
      pitfalls: 'Do not skip the check',
      verification: 'The check printed ok'
    }
    provider.handler = (input) => {
      if (input.messages.at(-1)?.role === 'tool') return { content: 'Shown.', toolCalls: [] }
      return { content: '', toolCalls: [{ id: 's1', name: 'save_skill', arguments: JSON.stringify(draft) }] }
    }
    await app.sendMessage(conversationId, 'Thanks, that worked.')
    expect(app.listSkills().filter((skill) => !skill.deletedAt)).toHaveLength(0)
    expect(app.getSnapshot().skillProposal?.name).toBe('Deploy')
    app.resolveSkillProposal(app.getSnapshot().skillProposal!.id, 'dismiss')
    await app.sendMessage(conversationId, 'Save this workflow as a skill.')
    const saved = app.listSkills().find((skill) => skill.name === 'Deploy' && !skill.deletedAt)
    expect(saved?.enabled).toBe(true)
    expect(saved?.procedure).toBe('Run the first check')
    provider.handler = (input) => {
      if (input.messages.at(-1)?.role === 'tool') return { content: 'Updated.', toolCalls: [] }
      return {
        content: '',
        toolCalls: [{ id: 's2', name: 'update_skill', arguments: JSON.stringify({ ...draft, id: saved?.id, procedure: 'Run the corrected check' }) }]
      }
    }
    await app.sendMessage(conversationId, 'Update that skill with the correction we just discovered.')
    const updated = app.listSkills().find((skill) => skill.id === saved?.id)
    expect(updated?.procedure).toBe('Run the corrected check')
    expect(updated?.version).toBe(2)
    const restored = app.restoreSkillVersion(updated!.id, 1)
    expect(restored.procedure).toBe('Run the first check')
    expect(restored.version).toBe(3)
    const markdown = skillToMarkdown({
      ...restored,
      procedure: `${restored.procedure}\n\n\`\`\`js\nrequire("child_process").exec("calc")\n\`\`\``
    })
    const preview = parseSkillMarkdown(markdown)
    expect('draft' in preview).toBe(true)
    if ('draft' in preview) expect(preview.draft.procedure).toContain('require("child_process").exec("calc")')
    const imported = app.importSkill(skillToMarkdown({ ...restored, name: 'Imported deploy', description: 'Use for a copied procedure', procedure: 'Read the note only' }))
    expect(imported.enabled).toBe(false)
    await app.close()
  })
})

describe('web destination pinning', () => {
  it('connects to the resolved address and rechecks a redirect', async () => {
    const seen: ReturnType<typeof describePinnedConnection>[] = []
    const lookups: string[] = []
    await expect(
      fetchPublicUrl({
        url: 'https://example.com/start',
        timeoutMs: 1000,
        maxBytes: 1000,
        signal: new AbortController().signal,
        lookupHost: async (hostname) => {
          lookups.push(hostname)
          if (hostname === 'example.com') return ['93.184.216.34', '10.1.1.1']
          return ['203.0.113.9']
        },
        transport: async (request) => {
          seen.push(describePinnedConnection(request.url, request.address))
          expect(request.rejectUnauthorized).toBe(true)
          if (request.url.hostname === 'example.com') {
            return { status: 302, headers: { location: 'https://other.test/next' }, body: new Uint8Array() }
          }
          return { status: 200, headers: { 'content-type': 'text/plain' }, body: new TextEncoder().encode('public page') }
        }
      })
    ).rejects.toThrow(/private|local/)
    expect(seen).toHaveLength(0)
    expect(lookups).toEqual(['example.com'])

    const followed: { address: string; hostHeader: string; servername: string; rejectUnauthorized: boolean; hostname: string }[] = []
    await expect(
      fetchPublicUrl({
        url: 'https://example.com/start',
        timeoutMs: 1000,
        maxBytes: 1000,
        signal: new AbortController().signal,
        lookupHost: async (hostname) => (hostname === 'example.com' ? ['93.184.216.34'] : ['203.0.113.9']),
        transport: async (request) => {
          followed.push({
            address: request.address,
            hostHeader: request.hostHeader,
            servername: request.servername,
            rejectUnauthorized: request.rejectUnauthorized,
            hostname: request.url.hostname
          })
          if (request.url.hostname === 'example.com') {
            return { status: 302, headers: { location: 'http://127.0.0.1/secret' }, body: new Uint8Array() }
          }
          throw new Error('private redirect was fetched')
        }
      })
    ).rejects.toThrow(/private|local/)
    expect(followed).toEqual([
      { address: '93.184.216.34', hostHeader: 'example.com', servername: 'example.com', rejectUnauthorized: true, hostname: 'example.com' }
    ])
  })
})

describe('provider check', () => {
  it('previews the credit risk without a call, then stays inside the mock budget', async () => {
    const { app, provider } = makeApp()
    const preview = app.planProviderCheck()
    expect(provider.calls).toHaveLength(0)
    expect(preview.maxCalls).toBe(4)
    expect(preview.maxOutputTokens).toBe(64)
    expect(preview.message.toLowerCase()).toContain('credit')
    app.updateSettings({ inputUsdPerMillion: 1, outputUsdPerMillion: 2, maxEstimatedSpendPerDayUsd: 5 })
    provider.handler = (input) => {
      const last = input.messages.at(-1)
      if (input.messages.some((message) => message.role === 'tool')) {
        return { content: 'done', toolCalls: [], usage: { inputTokens: 8, outputTokens: 1 } }
      }
      if (last?.content.includes('pong')) {
        input.onDelta?.('pong')
        return { content: 'pong', toolCalls: [], usage: { inputTokens: 5, outputTokens: 1 } }
      }
      if (last?.content.includes('list_memories')) {
        return { content: '', toolCalls: [{ id: 'c1', name: 'list_memories', arguments: '{}' }], usage: { inputTokens: 6, outputTokens: 2 } }
      }
      if (last?.content.includes('weather')) {
        input.onDelta?.('Hello')
        if (!input.signal.aborted) throw new Error('The check did not cancel the request.')
        throw new ProviderError('cancelled', 'Stopped.')
      }
      throw new Error(`Unexpected check prompt: ${last?.content}`)
    }
    const result = await app.runProviderCheck()
    expect(provider.calls.length).toBeLessThanOrEqual(4)
    expect(result.modelCalls).toBeLessThanOrEqual(4)
    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([
      ['Streaming reply', true],
      ['Tool call', true],
      ['Tool follow-up', true],
      ['Cancellation', true]
    ])
    const activity = app.listActivity()
    expect(activity.every((entry) => entry.trigger === 'provider_check')).toBe(true)
    const cancelled = activity.find((entry) => entry.outcome === 'cancelled')
    expect(cancelled?.estimatedCostUsd).toBeGreaterThan(0)
    expect(cancelled?.context?.reportedInputTokens).toBeNull()
    const streamed = activity.find((entry) => entry.outcome === 'completed')
    expect(streamed?.context?.reportedInputTokens).toBeGreaterThan(0)
    expect(streamed?.tokenSource).toBe('reported')
    await app.close()
  })
})

describe('migration', () => {
  it('adds skills without discarding an existing memory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-bot-'))
    const dbPath = path.join(dir, 'riot.sqlite')
    const raw = openDatabase(dbPath)
    raw.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        kind TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source_message_id TEXT,
        conversation_id TEXT,
        provenance TEXT NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE model_requests (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        purpose TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        outcome TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_tokens INTEGER,
        token_source TEXT,
        estimated_cost_usd REAL,
        reported_cost_usd REAL,
        cost_label TEXT,
        reserved_usd REAL,
        error TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        day TEXT NOT NULL
      );
    `)
    raw.prepare(`INSERT INTO memories (id, content, kind, pinned, created_at, updated_at, source_message_id, conversation_id, provenance, deleted_at) VALUES (?, ?, 'fact', 0, 1, 1, NULL, NULL, 'user_explicit', NULL)`).run('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'keep-me-orchid')
    raw.exec('PRAGMA user_version = 1')
    raw.close()
    const db = new Database(dbPath)
    db.migrate()
    expect(db.listMemories().map((memory) => memory.content)).toEqual(['keep-me-orchid'])
    expect(db.listSkills()).toEqual([])
    db.migrate()
    expect(db.listMemories()).toHaveLength(1)
    db.close()
  })
})

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function streamResponse(chunks: string[], controller?: AbortController): Response {
  const encoder = new TextEncoder()
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(streamController) {
      if (controller?.signal.aborted) {
        streamController.close()
        return
      }
      if (index >= chunks.length) {
        streamController.close()
        return
      }
      streamController.enqueue(encoder.encode(chunks[index]))
      index += 1
    }
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function stored(id: string, content: string, role: MessageRecord['role'], createdAt: number): MessageRecord {
  return {
    id,
    conversationId: 'conv',
    role,
    content,
    toolCallsJson: null,
    toolCallId: null,
    toolName: null,
    createdAt,
    summarized: false,
    runId: null
  }
}
