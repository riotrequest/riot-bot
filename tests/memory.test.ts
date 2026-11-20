import { describe, expect, it, vi } from 'vitest'
import { Database } from '../src/core/db'
import { MEMORY_INDEX_KEY, type EmbedMemory } from '../src/core/semantic-memory'
import { openDatabase } from '../src/core/sqlite'
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

  it('recalls a paraphrase after migrating existing notes and retires edited and deleted vectors', async () => {
    const original = 'The public Windows installer requires a publisher signing certificate.'
    const query = 'What is blocking distribution of our desktop app?'
    const replacement = 'The office kitchen opens at noon.'
    const privateNote = 'OTHER BOT confidential release details.'
    const seed = makeApp()
    const { bot, ongoingConversationId: conversationId } = seed.app.getSnapshot()
    await seed.app.sendMessage(conversationId!, `Remember this: ${original}`)
    const memoryId = seed.app.listMemories()[0].id
    const other = await seed.app.createBot({ name: 'Other', purpose: 'A separate bot', provider: 'openai', model: '', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
    seed.app.selectBot(bot!.id)
    await seed.app.close()

    const raw = openDatabase(seed.dbPath)
    raw.prepare('UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?')
      .run(Buffer.alloc(768 * 4), 'embeddinggemma:300m/768/v1', memoryId)
    raw.prepare(`INSERT INTO memories (id, bot_id, content, kind, created_at, updated_at, provenance) VALUES (?, ?, ?, 'fact', 1, 1, 'user_explicit')`)
      .run('other-memory', other.bot.id, privateNote)
    raw.close()

    let online = true
    const batches: string[][] = []
    const embed = vi.fn<EmbedMemory>(async input => {
      if (!online) throw new Error('Bundled model unavailable')
      batches.push(input)
      return input.map(text => {
        const vector = new Float32Array(384)
        vector[text === replacement ? 1 : 0] = 1
        return vector
      })
    })
    const { app, provider } = makeApp({ dbPath: seed.dbPath, embedMemory: embed })
    const recalled = () => provider.calls.at(-1)?.messages.find(message => message.content.startsWith('Retrieved memories.'))?.content
    try {
      await app.sendMessage(conversationId!, query)
      expect(recalled()).toBeUndefined()
      expect(embed).not.toHaveBeenCalled()

      app.updateSettings({ semanticMemory: true })
      await app.sendMessage(conversationId!, query)
      expect(recalled()).toContain(original)
      expect(recalled()).not.toContain(privateNote)
      expect(batches[0].join('\n')).not.toContain(privateNote)
      await app.sendMessage(conversationId!, query)
      expect(batches[1]).toHaveLength(1)

      app.updateMemory(memoryId, replacement)
      await app.sendMessage(conversationId!, query)
      expect(batches[2]).toHaveLength(2)
      expect(recalled()).toBeUndefined()

      online = false
      expect((await app.sendMessage(conversationId!, 'What time does the office kitchen open?')).status).toBe('completed')
      expect(recalled()).toContain(replacement)
      app.deleteMemory(memoryId)
      const database = new Database(seed.dbPath)
      try {
        expect(database.memoryEmbeddings(bot!.id, MEMORY_INDEX_KEY, 10)).toEqual([])
      } finally { database.close() }
      await app.sendMessage(conversationId!, query)
      expect(recalled()).toBeUndefined()
      expect(embed).toHaveBeenCalledTimes(4)
    } finally { await app.close() }
  })

  it('saves an evidenced episode through the existing quiet review when enabled', async () => {
    const { app, provider } = makeApp({ learning: true })
    const conversationId = app.getSnapshot().ongoingConversationId!
    const user = 'We completed the reporting dashboard migration on Friday.'
    const review = { memory: { content: user, kind: 'episode', evidence: user, importance: 'high' }, skill: null }
    try {
      provider.script.push(() => ({ content: 'Great.', toolCalls: [] }), () => ({ content: JSON.stringify(review), toolCalls: [] }))
      await app.sendMessage(conversationId, user)
      expect(app.listMemories()).toEqual([])
      app.updateSettings({ semanticMemory: true })
      provider.script.push(() => ({ content: 'Great.', toolCalls: [] }), () => ({ content: JSON.stringify(review), toolCalls: [] }))
      await app.sendMessage(conversationId, user)
      expect(app.listMemories()).toMatchObject([{ kind: 'episode', content: user, provenance: 'automatic' }])
      expect(provider.calls).toHaveLength(4)
    } finally { await app.close() }
  })
})
