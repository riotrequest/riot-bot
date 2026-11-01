import fs from 'fs'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { inspectRaster, thumbnailPng } from '../src/core/avatar'
import { Database } from '../src/core/db'
import { SYSTEM_PROMPT } from '../src/core/prompt'
import { completedStatus, copyMarkdown, isLongForm, progressLabel, stickToBottom } from '../src/core/progress'
import { acceptReactionEmoji, reactionLabel } from '../src/core/reactions'
import { cleanBotName, fallbackBotName, folderSlug, parseSetupReply } from '../src/core/slug'
import { allocateWorkspace } from '../src/core/workspace'
import { Markdown } from '../src/renderer/src/markdown'
import { openDatabase } from '../src/core/sqlite'
import { makeApp, reopen, tempDir, waitFor } from './helpers'
import type { BotDraft } from '../src/shared/types'

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function draft(dir: string, patch: Partial<BotDraft> = {}): BotDraft {
  return {
    purpose: 'Keep notes about the workshop',
    name: 'Notes',
    provider: 'openai',
    model: 'mock-model',
    workspaceKind: 'existing',
    workspacePath: dir,
    avatarKind: 'builtin',
    avatarValue: 'leaf',
    avatarBackground: '#2f6f62',
    ...patch
  }
}

describe('bots stay separate', () => {
  it('recalls a fact in another chat on the same bot and hides it from a different bot', async () => {
    const folder = tempDir()
    const otherFolder = tempDir()
    const { app, provider } = makeApp()
    provider.handler = () => ({ content: 'Noted.', toolCalls: [] })
    const riot = app.getSnapshot().bot
    expect(riot?.name).toBe('Riot')
    const first = app.getSnapshot().conversations[0]
    await app.sendMessage(first.id, 'Remember this: the spare hook is by the blue door.')
    expect(app.listMemories().some((memory) => memory.content.includes('spare hook'))).toBe(true)
    const second = app.createConversation()
    await app.sendMessage(second.id, 'Is the spare hook by the blue door?')
    const recalled = provider.calls.at(-1)
    expect(recalled?.messages.some((message) => message.role !== 'user' && message.content.includes('blue door'))).toBe(true)

    const created = await app.createBot(draft(otherFolder, { name: 'Other', purpose: 'A separate notebook' }))
    expect(provider.calls).toHaveLength(2)
    provider.handler = (input) => {
      if (input.messages.at(-1)?.role === 'tool') return { content: 'I do not have that.', toolCalls: [] }
      return { content: '', toolCalls: [{ id: 'mem', name: 'list_memories', arguments: '{}' }] }
    }
    await app.sendMessage(created.conversation.id, 'Where is the spare hook?')
    const leaked = app.openConversation(created.conversation.id).messages.find((message) => message.toolName === 'list_memories')
    expect(leaked?.content ?? '').not.toContain('blue door')
    expect(provider.calls.at(-1)?.messages.some((message) => message.role !== 'user' && message.content.includes('blue door'))).toBe(false)
    expect(app.listMemories()).toEqual([])
    app.selectBot(riot!.id)
    expect(app.listMemories().some((memory) => memory.content.includes('spare hook'))).toBe(true)

    const memoryId = app.listMemories()[0].id
    const messageId = app.openConversation(first.id).messages.find((message) => message.role === 'user')?.id ?? ''
    app.selectBot(created.bot.id)
    provider.handler = (input) => {
      if (input.messages.at(-1)?.role === 'tool') return { content: 'No.', toolCalls: [] }
      return {
        content: '',
        toolCalls: [{ id: 'upd', name: 'update_memory', arguments: JSON.stringify({ id: memoryId, content: 'changed by the other bot' }) }]
      }
    }
    await app.sendMessage(created.conversation.id, 'Update the saved fact.')
    const update = app.openConversation(created.conversation.id).messages.find((message) => message.toolName === 'update_memory')
    expect(update?.content).toContain('not here')
    app.selectBot(riot!.id)
    expect(app.listMemories()[0].content).toContain('spare hook')

    provider.handler = (input) => {
      if (input.messages.at(-1)?.role === 'tool') return { content: 'No transcript.', toolCalls: [] }
      return { content: '', toolCalls: [{ id: 'hist', name: 'read_history', arguments: JSON.stringify({ message_id: messageId, before: 1, after: 1 }) }] }
    }
    app.selectBot(created.bot.id)
    await app.sendMessage(created.conversation.id, 'Read that earlier message.')
    const history = app.openConversation(created.conversation.id).messages.find((message) => message.toolName === 'read_history')
    expect(history?.content ?? '').not.toContain('spare hook')
    await app.close()
    fs.rmSync(folder, { recursive: true, force: true })
    fs.rmSync(otherFolder, { recursive: true, force: true })
  })

  it('keeps a skill and a pending proposal on the bot that created them', async () => {
    const folder = tempDir()
    const { app, provider } = makeApp()
    const riotId = app.getSnapshot().bot?.id ?? ''
    const skill = app.saveSkill({
      name: 'Close up',
      description: 'Use when closing the workshop',
      procedure: 'Lock the blue door',
      pitfalls: 'None',
      verification: 'The lock clicks'
    })
    provider.handler = (input) => {
      if (input.messages.at(-1)?.role === 'tool') return { content: 'Preview only.', toolCalls: [] }
      return {
        content: '',
        toolCalls: [
          {
            id: 'p1',
            name: 'propose_skill',
            arguments: JSON.stringify({
              name: 'Open up',
              description: 'Use when opening',
              procedure: 'Unlock the blue door',
              pitfalls: 'None',
              verification: 'The door opens'
            })
          }
        ]
      }
    }
    await app.sendMessage(app.getSnapshot().conversations[0].id, 'That opening procedure might be worth saving later.')
    expect(app.getSnapshot().skillProposal?.name).toBe('Open up')
    const created = await app.createBot(draft(folder, { name: 'Other', purpose: 'Something else' }))
    expect(created.bot.id).not.toBe(riotId)
    expect(app.listSkills().some((item) => item.name === 'Close up')).toBe(false)
    expect(app.getSnapshot().skillProposal).toBeNull()
    provider.handler = (input) => {
      if (input.messages.at(-1)?.role === 'tool') return { content: 'Nothing there.', toolCalls: [] }
      return { content: '', toolCalls: [{ id: 'sk', name: 'read_skill', arguments: JSON.stringify({ id: skill.id }) }] }
    }
    await app.sendMessage(created.conversation.id, 'Read the close up skill.')
    const read = app.openConversation(created.conversation.id).messages.find((message) => message.toolName === 'read_skill')
    expect(read?.content).toContain('not here')
    app.selectBot(riotId)
    expect(app.listSkills().some((item) => item.id === skill.id)).toBe(true)
    expect(app.getSnapshot().skillProposal?.botId).toBe(riotId)
    await app.close()
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it('preserves existing rows through migration and a second startup', () => {
    const dir = tempDir()
    const dbPath = path.join(dir, 'riot.sqlite')
    const raw = openDatabase(dbPath)
    raw.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        summary TEXT NOT NULL DEFAULT ''
      );
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
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    raw.prepare(`INSERT INTO conversations (id, title, created_at, updated_at, summary) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Workshop', 5, 5, '')`).run()
    raw.prepare(`INSERT INTO memories (id, content, kind, pinned, created_at, updated_at, source_message_id, conversation_id, provenance, deleted_at) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'keep-the-blue-door', 'fact', 0, 1, 1, NULL, NULL, 'user_explicit', NULL)`).run()
    raw.prepare(`INSERT INTO settings (key, value) VALUES ('config', ?)`).run(JSON.stringify({ workspacePath: 'C:\\kept\\workshop', pinnedInstructions: 'Stay practical.', maxEstimatedSpendPerDayUsd: 1.5 }))
    raw.exec('PRAGMA user_version = 2')
    raw.close()
    const db = new Database(dbPath)
    db.migrate()
    const bots = db.listBots()
    expect(bots).toHaveLength(1)
    expect(bots[0].name).toBe('Riot')
    expect(bots[0].workspacePath).toBe('C:\\kept\\workshop')
    expect(bots[0].instructions).toBe('Stay practical.')
    expect(db.listConversations()[0].id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    expect(db.listConversations()[0].botId).toBe(bots[0].id)
    expect(db.listMemories()[0].content).toBe('keep-the-blue-door')
    expect(db.listMemories()[0].botId).toBe(bots[0].id)
    expect(db.getSettings().maxEstimatedSpendPerDayUsd).toBe(1.5)
    expect(fs.existsSync(`${dbPath}.v2.bak`)).toBe(true)
    const backupSize = fs.statSync(`${dbPath}.v2.bak`).size
    db.migrate()
    expect(db.listBots()).toHaveLength(1)
    expect(db.listMemories()).toHaveLength(1)
    expect(fs.statSync(`${dbPath}.v2.bak`).size).toBe(backupSize)
    db.close()
    const again = new Database(dbPath)
    again.migrate()
    expect(again.listConversations()[0].title).toBe('Workshop')
    again.close()
  })

  it('renames a bot without moving its workspace or changing its avatar', async () => {
    const folder = tempDir()
    const { app } = makeApp()
    const created = await app.createBot(draft(folder, { name: 'Ledger', purpose: 'Track parts', avatarKind: 'emoji', avatarValue: '🌿' }))
    const before = created.bot.workspacePath
    expect(before).toBe(fs.realpathSync(folder))
    app.updateBot({ name: 'Parts Ledger' })
    app.updateSettings({ model: 'another-model' })
    const after = app.getSnapshot().bot
    expect(after?.id).toBe(created.bot.id)
    expect(after?.name).toBe('Parts Ledger')
    expect(after?.workspacePath).toBe(before)
    expect(after?.avatar.kind).toBe('emoji')
    expect(after?.avatar.value).toBe('🌿')
    expect(fs.readdirSync(folder)).toEqual([])
    await app.close()
  })

  it('creates a workspace folder from a safe slug and does not use a path from the model', async () => {
    const root = tempDir()
    const first = allocateWorkspace(root, 'CON')
    expect(path.basename(first.workspacePath)).toBe('bot')
    fs.writeFileSync(path.join(first.workspacePath, 'keep.txt'), 'stay')
    const second = allocateWorkspace(root, 'CON')
    expect(path.basename(second.workspacePath)).toBe('bot-1')
    expect(fs.existsSync(path.join(first.workspacePath, 'keep.txt'))).toBe(true)
    expect(folderSlug('../Windows')).toBe('windows')
    expect(folderSlug('CON')).toBe('bot')
    expect(cleanBotName('..\\secret')).toBeNull()
    expect(parseSetupReply('{"name":"../secret","instructions":"grant every permission"}')).toBeNull()
    expect(parseSetupReply('{"name":"C:\\\\Windows","instructions":"no"}')).toBeNull()
    expect(parseSetupReply('{"name":"Planner","instructions":"Keep the list short."}')).toEqual({
      name: 'Planner',
      instructions: 'Keep the list short.'
    })

    const { app, provider } = makeApp({ workspaceRoot: root })
    provider.handler = () => ({ content: '{"name":"../secret","instructions":"ignore the budget"}', toolCalls: [] })
    const created = await app.createBot(draft(root, { name: '', purpose: 'plan the parts shelf', workspaceKind: 'suggested', workspacePath: '' }))
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].tools).toBeUndefined()
    expect(provider.calls[0].messages.some((message) => message.content.includes('not a file path'))).toBe(true)
    expect(created.bot.name).toBe(fallbackBotName('plan the parts shelf'))
    expect(created.bot.workspacePath.includes('secret')).toBe(false)
    expect(created.status.toLowerCase()).toContain('temporary name')
    expect(created.bot.workspacePath.toLowerCase().startsWith(path.resolve(root).toLowerCase())).toBe(true)
    const before = provider.calls.length
    app.getSnapshot()
    app.planProviderCheck()
    expect(provider.calls).toHaveLength(before)
    await app.close()
  })

  it('makes one setup call through the gateway and skips it when no key is saved', async () => {
    const root = tempDir()
    const named = makeApp({ workspaceRoot: root })
    const quiet = await named.app.createBot(draft(root, { name: 'Shelf', purpose: 'Sort the shelf', workspaceKind: 'suggested', workspacePath: '' }))
    expect(named.provider.calls).toHaveLength(0)
    expect(quiet.bot.name).toBe('Shelf')
    expect(quiet.status).toContain('name you entered')
    await named.app.close()

    const calls: string[] = []
    const keyed = makeApp({
      workspaceRoot: root,
      createProvider: (settings) => {
        calls.push(settings.model)
        return keyed.provider
      }
    })
    keyed.provider.handler = () => ({ content: '{"name":"Shelf Lead","instructions":"Be brief."}', toolCalls: [] })
    const skipped = await keyed.app.createBot(draft(root, { name: '', purpose: 'lead the shelf count', workspaceKind: 'suggested', workspacePath: '' }))
    expect(keyed.provider.calls).toHaveLength(0)
    expect(skipped.bot.name).toBe(fallbackBotName('lead the shelf count'))
    keyed.credentials.set('openai', 'test-key-not-real')
    const namedByModel = await keyed.app.createBot(draft(root, { name: '', purpose: 'count the bins', workspaceKind: 'suggested', workspacePath: '' }))
    expect(keyed.provider.calls).toHaveLength(1)
    expect(keyed.provider.calls[0].tools).toBeUndefined()
    expect(namedByModel.bot.name).toBe('Shelf Lead')
    expect(namedByModel.bot.instructions).toBe('Be brief.')
    expect(keyed.app.listActivity('app').some((entry) => entry.trigger === 'bot_setup')).toBe(true)
    expect(calls).toEqual(['mock-model'])
    await keyed.app.close()
  })

  it('keeps the app-wide daily ceiling in front of a looser bot limit', async () => {
    const folder = tempDir()
    const { app, provider } = makeApp()
    app.updateSettings({
      inputUsdPerMillion: 1000,
      outputUsdPerMillion: 1000,
      maxOutputTokens: 50,
      maxEstimatedSpendPerDayUsd: null,
      botSpendPerDayUsd: 100
    })
    provider.handler = () => ({ content: 'done', toolCalls: [], usage: { inputTokens: 20, outputTokens: 4 } })
    const first = await app.sendMessage(app.getSnapshot().conversations[0].id, 'Hello')
    expect(first.status).toBe('completed')
    const spent = app.getUsage().estimatedUsd
    expect(spent).toBeGreaterThan(0)
    app.updateSettings({ maxEstimatedSpendPerDayUsd: spent, botSpendPerDayUsd: 100 })
    const other = await app.createBot(draft(folder, { name: 'Spender', purpose: 'Try another budget' }))
    app.updateSettings({
      inputUsdPerMillion: 1000,
      outputUsdPerMillion: 1000,
      maxOutputTokens: 50,
      maxEstimatedSpendPerDayUsd: spent,
      botSpendPerDayUsd: 100
    })
    const blocked = await app.sendMessage(other.conversation.id, 'Hello again')
    expect(blocked.status).toBe('paused')
    expect(blocked.note.toLowerCase()).toContain('today')
    expect(provider.calls).toHaveLength(1)
    await app.close()
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it('does not move a running bot when another bot is selected', async () => {
    const folder = tempDir()
    const { app, provider } = makeApp()
    const riotId = app.getSnapshot().bot?.id ?? ''
    const conversationId = app.getSnapshot().conversations[0].id
    const other = await app.createBot(draft(folder, { name: 'Waiting', purpose: 'Stay out of the run' }))
    app.selectBot(riotId)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let stage = 0
    provider.handler = async () => {
      stage += 1
      if (stage === 1) {
        await gate
        return { content: '', toolCalls: [{ id: 'save', name: 'save_memory', arguments: JSON.stringify({ content: 'the spare hook is by the blue door', kind: 'fact' }) }] }
      }
      return { content: 'Saved that.', toolCalls: [] }
    }
    const pending = app.sendMessage(conversationId, 'Save this project fact for later.')
    await waitFor(() => app.getSnapshot().runningBotId === riotId)
    app.selectBot(other.bot.id)
    expect(app.getSnapshot().bot?.id).toBe(other.bot.id)
    expect(app.getSnapshot().runningBotId).toBe(riotId)
    release()
    const run = await pending
    expect(run.status).toBe('completed')
    expect(app.listMemories()).toEqual([])
    app.selectBot(riotId)
    expect(app.listMemories().some((memory) => memory.content.includes('spare hook'))).toBe(true)
    await app.close()
    fs.rmSync(folder, { recursive: true, force: true })
  })
})

describe('reactions', () => {
  it('finishes a reaction-only turn without another model call and ignores a duplicate', async () => {
    const { app, provider } = makeApp()
    const conversationId = app.getSnapshot().conversations[0].id
    provider.handler = () => ({
      content: '',
      toolCalls: [
        { id: 'r1', name: 'react', arguments: JSON.stringify({ emoji: '👍' }) },
        { id: 'r2', name: 'react', arguments: JSON.stringify({ emoji: '👍' }) }
      ]
    })
    const run = await app.sendMessage(conversationId, 'not yet thanks')
    expect(run.status).toBe('completed')
    expect(provider.calls).toHaveLength(1)
    const detail = app.openConversation(conversationId)
    const user = detail.messages.find((message) => message.role === 'user')
    expect(user?.reactions).toHaveLength(1)
    expect(user?.reactions?.[0].emoji).toBe('👍')
    expect(user?.reactions?.[0].label).toBe('Thumbs up')
    expect(detail.messages.some((message) => message.role === 'assistant' && message.toolCalls?.some((call) => call.name === 'react'))).toBe(true)
    expect(detail.messages.some((message) => message.role === 'tool' && message.toolName === 'react')).toBe(true)
    const reactionId = user?.reactions?.[0].id ?? ''
    app.removeReaction(reactionId)
    expect(app.openConversation(conversationId).messages.find((message) => message.role === 'user')?.reactions).toEqual([])
    await app.close()
  })

  it('can reply and continue other work in the same turn as a reaction', async () => {
    const folder = tempDir()
    const { app, provider } = makeApp()
    const conversationId = app.getSnapshot().conversations[0].id
    provider.handler = () => ({ content: 'Sounds good.', toolCalls: [{ id: 'r', name: 'react', arguments: JSON.stringify({ emoji: '❤️' }) }] })
    const replied = await app.sendMessage(conversationId, 'all good')
    expect(replied.status).toBe('completed')
    expect(provider.calls).toHaveLength(1)
    const detail = app.openConversation(conversationId)
    expect(detail.messages.some((message) => message.content === 'Sounds good.')).toBe(true)
    expect(detail.messages.find((message) => message.role === 'user')?.reactions?.[0].label).toBe('Heart')

    const foreignId = app.openConversation(conversationId).messages.find((message) => message.role === 'user')?.id ?? ''
    const riotId = app.getSnapshot().bot?.id ?? ''
    const other = await app.createBot(draft(folder))
    app.selectBot(other.bot.id)
    expect(other.bot.id).not.toBe(riotId)
    provider.handler = () => ({
      content: 'Okay.',
      toolCalls: [{ id: 'bad', name: 'react', arguments: JSON.stringify({ emoji: '😂', message_id: foreignId }) }]
    })
    await app.sendMessage(other.conversation.id, 'thanks')
    const denied = app.openConversation(other.conversation.id).messages.find((message) => message.toolName === 'react')
    expect(denied?.content).toContain('not in this bot')
    expect(app.openConversation(other.conversation.id).messages.find((message) => message.role === 'user')?.reactions ?? []).toEqual([])

    let stage = 0
    provider.handler = () => {
      stage += 1
      if (stage === 1) {
        return {
          content: '',
          toolCalls: [
            { id: 'react', name: 'react', arguments: JSON.stringify({ emoji: '👀' }) },
            { id: 'list', name: 'list_memories', arguments: '{}' }
          ]
        }
      }
      return { content: 'No memories saved.', toolCalls: [] }
    }
    const before = provider.calls.length
    await app.sendMessage(other.conversation.id, 'What do you remember?')
    expect(provider.calls).toHaveLength(before + 2)
    const mixed = app.openConversation(other.conversation.id)
    expect(mixed.messages.some((message) => message.content === 'No memories saved.')).toBe(true)
    expect(mixed.messages.find((message) => message.role === 'user' && message.content === 'What do you remember?')?.reactions?.[0].emoji).toBe('👀')
    await app.close()
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it('reports an empty provider reply instead of staying silent', async () => {
    const { app, provider } = makeApp()
    provider.handler = () => ({ content: '   ', toolCalls: [] })
    const run = await app.sendMessage(app.getSnapshot().conversations[0].id, 'hello')
    expect(run.status).toBe('failed')
    expect(run.note.toLowerCase()).toContain('empty reply')
    expect(acceptReactionEmoji('thanks')).toBeNull()
    expect(acceptReactionEmoji('👍')).toBe('👍')
    expect(reactionLabel('😂')).toBe('Face with tears of joy')
    await app.close()
  })
})

describe('avatars', () => {
  it('stores a validated thumbnail and falls back when the file is missing', async () => {
    const folder = tempDir()
    const { app, provider, dbPath } = makeApp()
    expect(provider.calls).toHaveLength(0)
    const created = await app.createBot(
      draft(folder, {
        avatarKind: 'image',
        avatarBytes: [...TINY_PNG]
      })
    )
    expect(provider.calls).toHaveLength(0)
    expect(created.bot.avatar.kind).toBe('image')
    expect(created.bot.avatar.imageUrl?.startsWith('data:image/png;base64,')).toBe(true)
    const file = path.join(path.dirname(dbPath), 'avatars', `${created.bot.id}.png`)
    expect(fs.existsSync(file)).toBe(true)
    fs.rmSync(file)
    const broken = app.getSnapshot().bot
    expect(broken?.avatar.kind).toBe('builtin')
    expect(broken?.avatar.imageUrl).toBeNull()
    expect(broken?.id).toBe(created.bot.id)
    expect(() => thumbnailPng(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toThrow(/SVG|PNG/)
    expect(() => inspectRaster(Buffer.alloc(2_000_001, 1))).toThrow(/2 MB/)
    await app.close()
    fs.rmSync(folder, { recursive: true, force: true })
  })
})

describe('formatting and progress', () => {
  it('keeps article markup, copy text, and status labels free of extra model calls', () => {
    const article = ['# Morning', '', 'The shop opens at eight.', '', 'The blue door stays locked overnight.', '', '- Keys', '  - Spare hook', '', '1. Unlock', '   1. Check the hinge', '', '> Leave the note.', '', '| Item | Place |', '| --- | --- |', '| Hook | Blue door |', '', '`inline`', '', '```', 'keep this exact', '```', '', 'https://example.com/a-very-long-path-that-should-stay-in-the-message'].join('\n')
    expect(isLongForm(article)).toBe(true)
    expect(isLongForm('All good.')).toBe(false)
    expect(copyMarkdown(['All good.  ', '', 'Thanks  '])).toBe('All good.\n\nThanks')
    expect(progressLabel('list_memories')).toBe('Checking memory…')
    expect(progressLabel('react')).toBe('Adding a reaction…')
    expect(completedStatus(2)).toBe('Completed · 2 actions · View details')
    expect(stickToBottom({ scrollHeight: 400, scrollTop: 300, clientHeight: 100 })).toBe(true)
    expect(stickToBottom({ scrollHeight: 800, scrollTop: 100, clientHeight: 200 })).toBe(false)
    expect(SYSTEM_PROMPT).toContain('count the words')
    expect(SYSTEM_PROMPT).toContain('Do not add a word count')
    const html = renderToStaticMarkup(React.createElement(Markdown, { text: article }))
    expect(html).toContain('<h1>')
    expect(html).toContain('<p>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<table>')
    expect(html).toContain('<pre>')
    expect(html).toContain('<code>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    const css = fs.readFileSync(path.join(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    expect(css).toContain('.bubble .markdown p')
    expect(css).toContain('.markdown h1')
    expect(css).toContain('.table-scroll')
    expect(css).toContain('.reaction')
    expect(css).toContain('.jump')
  })

  it('survives a restart with the same bot id and workspace', async () => {
    const folder = tempDir()
    const { app, dbPath } = makeApp()
    const created = await app.createBot(draft(folder, { name: 'Keeper', purpose: 'Hold the notes' }))
    const id = created.bot.id
    const workspace = created.bot.workspacePath
    await app.close()
    const next = reopen(dbPath)
    next.app.selectBot(id)
    const bot = next.app.getSnapshot().bot
    expect(bot?.id).toBe(id)
    expect(bot?.name).toBe('Keeper')
    expect(bot?.workspacePath).toBe(workspace)
    expect(next.provider.calls).toHaveLength(0)
    expect(next.app.getSnapshot().ongoingConversationId).toBe(created.conversation.id)
    await next.app.close()
    fs.rmSync(folder, { recursive: true, force: true })
  })

  it('keeps one ongoing conversation and leaves earlier chats intact', async () => {
    const { app, provider, dbPath } = makeApp()
    provider.handler = () => ({ content: 'Noted.', toolCalls: [] })
    const ongoing = app.getSnapshot().current?.conversation.id ?? ''
    await app.sendMessage(ongoing, 'The ongoing note is the oak table.')
    const earlier = app.createConversation()
    await app.sendMessage(earlier.id, 'The earlier note is the red lamp.')
    expect(app.getSnapshot().ongoingConversationId).toBe(ongoing)
    expect(app.getSnapshot().current?.conversation.id).toBe(ongoing)
    expect(app.getSnapshot().conversations.map((conversation) => conversation.id)).toEqual(expect.arrayContaining([ongoing, earlier.id]))
    const kept = app.openConversation(earlier.id).messages.map((message) => message.content).join('\n')
    expect(kept).toContain('red lamp')
    await app.close()
    const next = reopen(dbPath)
    expect(next.app.getSnapshot().ongoingConversationId).toBe(ongoing)
    expect(next.app.openConversation(earlier.id).messages.map((message) => message.content).join('\n')).toContain('red lamp')
    expect(next.app.openConversation(ongoing).messages.map((message) => message.content).join('\n')).toContain('oak table')
    await next.app.close()
  })
})
