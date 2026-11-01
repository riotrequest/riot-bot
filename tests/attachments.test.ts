import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IMAGE_TOKEN_RESERVE, MAX_ATTACHMENT_BYTES, prepareAttachment } from '../src/core/attachments'
import { Database } from '../src/core/db'
import { createOpenAICompatibleProvider } from '../src/core/provider'
import { ChatTranscript } from '../src/renderer/src/chat'
import type { RiotBridge } from '../src/shared/types'
import { makeApp, reopen } from './helpers'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

describe('chat attachments', () => {
  it('persists scoped drafts across restart without a model call, and removes only a draft', async () => {
    const { app, provider, dbPath } = makeApp()
    const botId = app.getSnapshot().bot!.id
    const [text, image] = app.stageAttachments([{ name: '../notes.txt', bytes: Buffer.from('A local note.') }, { name: 'shot.png', bytes: PNG }], botId)
    expect(text).toMatchObject({ name: 'notes.txt', kind: 'text', previewUrl: null })
    expect(image.previewUrl).toMatch(/^data:image\/png;base64,/)
    expect(provider.calls).toHaveLength(0)
    await app.close()
    const restarted = reopen(dbPath)
    expect(restarted.app.getSnapshot().draftAttachments.map((item) => item.id)).toEqual([text.id, image.id])
    restarted.app.removeDraftAttachment(text.id)
    expect(restarted.app.getSnapshot().draftAttachments.map((item) => item.id)).toEqual([image.id])
    expect(restarted.provider.calls).toHaveLength(0)
    await restarted.app.close()
  })

  it('sends image and text together, reserves image tokens, and keeps attachment previews in the transcript', async () => {
    const { app, provider } = makeApp()
    app.updateSettings({ contextMode: 'manual', contextTokenBudget: 80_000 })
    const snapshot = app.getSnapshot()
    const items = app.stageAttachments([{ name: 'screen.png', bytes: PNG }, { name: 'notes.ts', bytes: Buffer.from('export const attached = true') }], snapshot.bot!.id)
    const run = await app.sendMessage(snapshot.current!.conversation.id, 'Check both files.', items.map((item) => item.id))
    expect(run.status).toBe('completed')
    const user = provider.calls[0].messages.find((message) => message.role === 'user')!
    expect(user.content).toContain('export const attached = true')
    expect(user.content).toContain(items[1].id)
    expect(user.images).toEqual([`data:image/png;base64,${PNG.toString('base64')}`])
    expect(user.content).not.toContain(PNG.toString('base64'))
    const after = app.getSnapshot()
    expect(after.draftAttachments).toHaveLength(0)
    expect(after.current!.messages.find((message) => message.role === 'user')!.attachments?.map((item) => item.id)).toEqual(items.map((item) => item.id))
    expect(after.activity[0].context!.estimatedInputTokens).toBeGreaterThan(IMAGE_TOKEN_RESERVE)
    expect(() => app.removeDraftAttachment(items[0].id)).toThrow(/not here/)
    await app.close()
  })

  it('reads text outside the preview in bounded tool chunks and refuses an unsent draft', async () => {
    const { app, provider } = makeApp()
    const snapshot = app.getSnapshot()
    const [sent, unsent] = app.stageAttachments([{ name: 'long.txt', bytes: Buffer.from('prefix '.repeat(800) + 'secret-answer-47') }, { name: 'draft.txt', bytes: Buffer.from('UNSENT-DRAFT-MARKER') }], snapshot.bot!.id)
    let step = 0
    provider.handler = () => step++ === 0 ? { content: '', toolCalls: [
      { id: 'read1', name: 'read_attachment', arguments: JSON.stringify({ id: sent.id, query: 'secret-answer' }) },
      { id: 'read2', name: 'read_attachment', arguments: JSON.stringify({ id: unsent.id }) }
    ] } : { content: 'Found the answer.', toolCalls: [] }
    await app.sendMessage(snapshot.current!.conversation.id, 'Find the answer.', [sent.id])
    expect(provider.calls[0].messages.at(-1)!.content).not.toContain('secret-answer-47')
    const results = provider.calls.at(-1)!.messages.filter((item) => item.role === 'tool')
    expect(results[0].content).toContain('secret-answer-47')
    expect(results[0].content.length).toBeLessThan(3400)
    expect(results[1].content).not.toContain('UNSENT-DRAFT-MARKER')
    expect(results[1].content).toContain('not in this bot')
    await app.close()
  })

  it('rejects cross-bot sends and stale uploads without consuming drafts or contacting the model', async () => {
    const { app, provider, dir } = makeApp()
    const first = app.getSnapshot()
    const [item] = app.stageAttachments([{ name: 'private.txt', bytes: Buffer.from('BOT-A-MARKER') }], first.bot!.id)
    const other = await app.createBot({ name: 'Other', purpose: 'Other bot', provider: 'openai', model: 'mock-model', workspaceKind: 'existing', workspacePath: dir, avatarKind: 'builtin', avatarValue: 'leaf', avatarBackground: '#2f6f62' })
    expect(app.getSnapshot().draftAttachments).toEqual([])
    expect(() => app.stageAttachments([{ name: 'late.txt', bytes: Buffer.from('late') }], first.bot!.id)).toThrow(/selected bot changed/)
    await expect(app.sendMessage(other.conversation.id, 'Read this.', [item.id])).rejects.toThrow(/not in this bot/)
    expect(() => app.removeDraftAttachment(item.id)).toThrow(/not here/)
    expect(provider.calls).toHaveLength(0)
    app.selectBot(first.bot!.id)
    expect(app.getSnapshot().draftAttachments).toHaveLength(1)
    await app.close()
  })

  it('rolls back an invalid multi-file selection, caps drafts, and accepts attachment-only messages', async () => {
    const { app, provider } = makeApp()
    const s = app.getSnapshot()
    expect(() => app.stageAttachments([{ name: 'valid.txt', bytes: Buffer.from('good') }, { name: 'binary.zip', bytes: Buffer.from([0, 1, 2]) }], s.bot!.id)).toThrow(/not supported/)
    expect(app.getSnapshot().draftAttachments).toHaveLength(0)
    const drafts = app.stageAttachments(Array.from({ length: 4 }, (_, index) => ({ name: `${index}.txt`, bytes: Buffer.from(`Text ${index}`) })), s.bot!.id)
    expect(() => app.stageAttachments([{ name: 'fifth.txt', bytes: Buffer.from('fifth') }], s.bot!.id)).toThrow(/up to 4/)
    expect(provider.calls).toHaveLength(0)
    await expect(app.sendMessage(s.current!.conversation.id, '', [drafts[0].id, drafts[0].id])).rejects.toThrow(/different/)
    const run = await app.sendMessage(s.current!.conversation.id, '', [drafts[0].id])
    expect(run.status).toBe('completed')
    expect(provider.calls[0].messages.at(-1)!.content).toContain('Please examine the attached files.')
    await app.close()
  })

  it('deletes stored attachment data with its conversation and keeps migration idempotent', async () => {
    const { app, dbPath } = makeApp()
    const earlier = app.createConversation()
    const [item] = app.stageAttachments([{ name: 'file.txt', bytes: Buffer.from('saved') }], app.getSnapshot().bot!.id)
    await app.sendMessage(earlier.id, 'Read it.', [item.id])
    app.deleteConversation(earlier.id)
    const db = new Database(dbPath)
    db.migrate()
    db.migrate()
    expect(db.getAttachment(item.id, app.getSnapshot().bot!.id)).toBeNull()
    db.close()
    await app.close()
  })

  it('rejects empty, oversized, malformed, binary, invalid UTF-8, and huge-dimension uploads', () => {
    expect(() => prepareAttachment('empty.txt', Buffer.alloc(0))).toThrow(/empty/)
    expect(() => prepareAttachment('big.png', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))).toThrow(/8 MB/)
    expect(() => prepareAttachment('fake.png', Buffer.from('not png'))).toThrow(/not a PNG/)
    expect(() => prepareAttachment('doc.pdf', Buffer.from('%PDF-file'))).toThrow(/not supported/)
    expect(() => prepareAttachment('bad.txt', Buffer.from([0xff, 0xfe, 1]))).toThrow(/UTF-8/)
    expect(() => prepareAttachment('unsupported.gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'))).toThrow(/Use PNG or JPEG/)
    expect(() => prepareAttachment('big.txt', Buffer.alloc(1_000_001, 65))).toThrow(/1 MB/)
    const huge = Buffer.from(PNG)
    huge.writeUInt32BE(30_000, 16)
    expect(() => prepareAttachment('bomb.png', huge)).toThrow(/too large/)
  })

  it('encodes images as multimodal content parts in the real provider transport', async () => {
    let body: Record<string, any> = {}
    const provider = createOpenAICompatibleProvider({ name: 'openrouter', apiKey: 'test-key', fetchImpl: async (_input, init) => {
      body = JSON.parse(init!.body as string)
      return Response.json({ choices: [{ message: { content: 'Seen.' }, finish_reason: 'stop' }] })
    } })
    await provider.complete({ model: 'fixture', messages: [{ role: 'user', content: 'Inspect.', images: ['data:image/png;base64,AA=='] }], stream: false, maxOutputTokens: 50, tokenParameter: 'max_tokens', signal: new AbortController().signal })
    expect(body.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Inspect.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] })
  })

  it('pauses before a paid call if an image cannot fit the working budget', async () => {
    const { app, provider } = makeApp()
    app.updateSettings({ contextMode: 'manual', contextTokenBudget: 9000, toolsEnabled: false })
    const s = app.getSnapshot()
    const [item] = app.stageAttachments([{ name: 'shot.png', bytes: PNG }], s.bot!.id)
    const run = await app.sendMessage(s.current!.conversation.id, 'Inspect this.', [item.id])
    expect(run.status).toBe('paused')
    expect(provider.calls).toHaveLength(0)
    expect(app.getSnapshot().current!.messages.find((message) => message.role === 'user')!.attachments).toHaveLength(1)
    await app.close()
  })

  it('renders an older failed turn as failed when the latest run completed', async () => {
    const { app, dbPath } = makeApp()
    const s = app.getSnapshot()
    const db = new Database(dbPath)
    const failed = db.createRun(s.current!.conversation.id, 1)
    db.finishRun(failed.id, 'failed', 2, 'failure')
    db.addMessage({ id: 'old-user', conversationId: failed.conversationId, role: 'user', content: 'Earlier request', toolCallsJson: null, toolCallId: null, toolName: null, createdAt: 3, summarized: false, runId: failed.id })
    db.addMessage({ id: 'old-tool', conversationId: failed.conversationId, role: 'tool', content: 'partial', toolCallsJson: null, toolCallId: 'call', toolName: 'fetch_url', createdAt: 4, summarized: false, runId: failed.id })
    const completed = db.createRun(failed.conversationId, 5)
    db.finishRun(completed.id, 'completed', 6, '')
    db.addMessage({ id: 'new-user', conversationId: failed.conversationId, role: 'user', content: 'New request', toolCallsJson: null, toolCallId: null, toolName: null, createdAt: 7, summarized: false, runId: completed.id })
    const html = renderToStaticMarkup(React.createElement(ChatTranscript, { detail: app.openConversation(failed.conversationId), running: false, statusLabel: '', showToolDetails: false, avatar: null, api: {} as RiotBridge, onUndo: () => {}, onError: () => {}, onOlderPage: () => {} }))
    expect(html).toContain('Failed · 1 action finished')
    expect(html).not.toContain('Completed · 1 action')
    db.close()
    await app.close()
  })
})
