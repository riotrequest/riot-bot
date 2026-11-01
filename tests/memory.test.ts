import { describe, expect, it } from 'vitest'
import { makeApp, reopen } from './helpers'

describe('memory', () => {
  it('saves an explicit remember request, survives restart, and can be corrected or deleted', async () => {
    const first = makeApp()
    const conversationId = first.app.getSnapshot().conversations[0].id
    first.provider.handler = () => ({ content: 'I will keep that in mind.', toolCalls: [] })
    await first.app.sendMessage(conversationId, 'Remember this: I prefer tea after lunch.')
    const saved = first.app.listMemories()
    expect(saved).toHaveLength(1)
    expect(saved[0].content).toBe('I prefer tea after lunch.')
    expect(saved[0].provenance).toBe('user_explicit')
    expect(first.app.openConversation(conversationId).messages.some((message) => message.content === 'Saved a memory.')).toBe(true)
    const dbPath = first.dbPath
    await first.app.close()

    const second = reopen(dbPath)
    const edited = second.app.updateMemory(saved[0].id, 'I prefer tea, not coffee, after lunch.')
    expect(edited.content).toContain('not coffee')
    expect(edited.provenance).toBe('user_edit')
    second.app.pinMemory(saved[0].id, true)
    expect(second.app.listMemories()[0].pinned).toBe(true)
    second.app.deleteMemory(saved[0].id)
    expect(second.app.listMemories()).toHaveLength(0)
    expect(second.provider.calls).toHaveLength(0)
    await second.app.close()
  })

  it('blocks an obvious secret pattern and still saves an explicit guess', async () => {
    const { app, provider } = makeApp()
    const conversationId = app.getSnapshot().conversations[0].id
    provider.handler = () => ({ content: 'Okay.', toolCalls: [] })
    await app.sendMessage(conversationId, 'Remember this: api_key=sk-live-secret-value-123456')
    expect(app.listMemories()).toHaveLength(0)
    expect(app.openConversation(conversationId).messages.some((message) => message.content.includes('does not catch every secret'))).toBe(true)
    await app.sendMessage(conversationId, 'Remember this: I think the server might be in Ohio.')
    const saved = app.listMemories()
    expect(saved).toHaveLength(1)
    expect(saved[0].content).toContain('Ohio')
    expect(saved[0].provenance).toBe('user_explicit')
    const corrected = app.updateMemory(saved[0].id, 'The server location was a guess and is not confirmed.')
    expect(corrected.provenance).toBe('user_edit')
    await app.close()
  })
})
