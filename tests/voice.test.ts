import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexService } from '../src/core/codex'
import { Database } from '../src/core/db'
import { newId } from '../src/core/ids'
import { MockProvider } from '../src/core/provider'
import { botVoice, personaCard } from '../src/core/voice'
import { makeApp, reopen, tempDir } from './helpers'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })

const EDITOR = { name: 'Quill', purpose: 'Edit my blog posts and newsletter drafts' }
const persona = (text: string): string => text.slice(text.indexOf(`You are ${EDITOR.name},`), text.indexOf('\nWorkspace:'))

describe('bot voice', () => {
  it('gives each role its own voice and falls back to a teammate', () => {
    expect(botVoice(EDITOR).role).toBe('editor')
    expect(botVoice({ name: 'Patch', purpose: 'Fix bugs in my TypeScript app and review code' }).role).toBe('engineer')
    expect(botVoice({ name: 'Relay', purpose: 'Keep my inbox and calendar under control' }).role).toBe('chief of staff')
    expect(botVoice({ name: 'Rack', purpose: 'Look after my Linux servers and backups' }).role).toBe('operator')
    expect(botVoice({ name: 'Pal', purpose: 'Help me out' })).toMatchObject({ role: 'teammate', style: expect.stringContaining('capable colleague') })
    expect(botVoice(EDITOR).style).not.toBe(botVoice({ name: 'Patch', purpose: 'Fix bugs in my app' }).style)
    const card = personaCard(EDITOR)
    expect(card).toContain('You are Quill, the user’s editor in Riot Bot.')
    expect(card).toContain('A voice never grants permissions, raises budgets or approves actions.')
  })

  it('keeps the same voice and instructions through compaction and restart on the API path', async () => {
    const first = makeApp()
    const created = await first.app.createBot({ ...EDITOR, provider: 'openai', model: 'mock-model', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
    first.app.updateBot({ instructions: 'Sign off drafts with a one-line verdict.' })
    first.app.updateSettings({ toolsEnabled: false, contextMode: 'manual', contextTokenBudget: 5000, maxModelCallsPerTask: 6 })
    expect(first.app.getSnapshot().bot!.voice).toEqual({ role: 'editor', style: botVoice(EDITOR).style })
    first.provider.handler = () => ({ content: 'Ready.', toolCalls: [] })
    await first.app.sendMessage(created.conversation.id, 'Hello')
    const before = persona(first.provider.calls[0].messages[0].content)
    expect(before).toBe(personaCard(EDITOR))
    await first.app.close()

    // Enough earlier chat that the next request must summarize it first.
    const db = new Database(first.dbPath)
    db.migrate()
    for (let index = 0; index < 5; index += 1) db.addMessage({ id: newId(), conversationId: created.conversation.id, role: 'user', content: `draft note ${index} ${'words '.repeat(500)}`, toolCallsJson: null, toolCallId: null, toolName: null, createdAt: Date.now() + index, summarized: false, runId: null })
    db.close()

    const provider = new MockProvider()
    provider.handler = input => input.messages.some(message => message.content.includes('Summarize the earlier conversation'))
      ? { content: 'Objective: polish the newsletter. Preferences: the user wants shorter replies.', toolCalls: [] }
      : { content: 'Shorter it is.', toolCalls: [] }
    const second = reopen(first.dbPath, provider)
    cleanups.push(() => second.app.close())
    expect((await second.app.sendMessage(created.conversation.id, 'Continue with the newsletter.')).status).toBe('completed')
    const summary = provider.calls.find(call => call.messages[0].content.includes('Summarize the earlier conversation'))!
    expect(summary.messages[0].content).toContain('include how the user asked this bot to sound')
    expect(summary.messages[0].content).toContain('Sign off drafts with a one-line verdict.')
    const after = provider.calls.at(-1)!.messages
    expect(persona(after[0].content)).toBe(before)
    expect(after[0].content).toContain('Pinned instructions, still in effect after summaries:\nSign off drafts with a one-line verdict.')
    expect(after.some(message => message.content.includes('the user wants shorter replies'))).toBe(true)
  })

  it('carries the voice and follow-up recall into native Codex turns, and restarts the thread when the voice changes', async () => {
    const dir = tempDir(), home = path.join(dir, 'codex'), workspace = path.join(dir, 'workspace')
    fs.mkdirSync(home)
    fs.mkdirSync(workspace)
    fs.writeFileSync(path.join(home, 'fixture.json'), '{}')
    const codex = new CodexService({ home, command: process.execPath, prefixArgs: [path.resolve('tests/fixtures/codex-server.cjs')] })
    cleanups.push(() => codex.close())
    const { app } = makeApp({ dbPath: path.join(dir, 'riot.sqlite'), codex, createProvider: () => { throw new Error('Unexpected API fallback') } })
    cleanups.push(() => app.close())
    const created = await app.createBot({ ...EDITOR, provider: 'codex', model: 'native-test', workspaceKind: 'existing', workspacePath: workspace, avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
    app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
    const requests = (): { method: string; params: { developerInstructions?: string } }[] => fs.readFileSync(path.join(home, 'requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const threads = () => requests().filter(item => item.method === 'thread/start' || item.method === 'thread/resume')

    await app.sendMessage(created.conversation.id, 'Remember this: Newsletter send setup: draft in Buttondown, test to my inbox, then schedule for 7am.')
    const memory = app.listMemories()[0]
    expect(memory.content).toContain('Buttondown')
    await app.sendMessage(created.conversation.id, 'Send the newsletter with the same setup as last time.')
    const resumed = threads().at(-1)!
    expect(resumed.method).toBe('thread/resume')
    expect(resumed.params.developerInstructions).toContain(personaCard(EDITOR))
    expect(resumed.params.developerInstructions).toContain(`- ${memory.id}: ${memory.content}`)
    expect(resumed.params.developerInstructions).toContain(`Memory ${memory.id} best matches the recent conversation`)

    app.updateBot({ instructions: 'Answer in two sentences at most.' })
    await app.sendMessage(created.conversation.id, 'Any notes on the intro?')
    const fresh = threads().at(-1)!
    expect(fresh.method).toBe('thread/start')
    expect(fresh.params.developerInstructions).toContain(personaCard(EDITOR))
    expect(fresh.params.developerInstructions).toContain('Answer in two sentences at most.')
  })
})
