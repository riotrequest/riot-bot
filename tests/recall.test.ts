import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { Database } from '../src/core/db'
import { newId } from '../src/core/ids'
import type { ChatMessage } from '../src/core/model'
import { MockProvider } from '../src/core/provider'
import { refersBack } from '../src/core/recall'
import { makeApp, reopen } from './helpers'

const BLOG = 'Blog deploy setup: build with Hugo, upload to Netlify, then purge the Cloudflare cache.'
const SHOP = 'Shop deploy setup: build with Vite, sync to S3 with rclone, then invalidate CloudFront.'
const TEA = 'Prefers tea after lunch.'
const OTHER = 'Blog deploy setup for another bot: OTHER-BOT-PRIVATE-STEPS.'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })

/** A bot with two deploy setups and an unrelated preference, plus another bot whose blog setup must never appear. */
async function seeded(options: { workspace?: string; history?: ['user' | 'assistant', string][]; pinTea?: boolean } = {}) {
  const first = makeApp()
  const own = first.app.getSnapshot()
  const botId = own.bot!.id, conversationId = own.ongoingConversationId!
  if (options.workspace) {
    const folder = path.join(first.dir, options.workspace)
    fs.mkdirSync(folder)
    first.app.updateSettings({ workspacePath: folder })
  }
  const other = await first.app.createBot({ name: 'Other Bot', purpose: 'Run a different blog', provider: 'openai', model: '', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
  first.app.selectBot(botId)
  await first.app.close()

  const db = new Database(first.dbPath)
  db.migrate()
  const ids = { blog: newId(), shop: newId(), tea: newId() }
  const memory = (id: string, owner: string, content: string, at: number, pinned = false) => db.insertMemory({ id, botId: owner, content, kind: 'fact', pinned, createdAt: at, updatedAt: at, sourceMessageId: null, conversationId: null, provenance: 'user_explicit' })
  memory(ids.blog, botId, BLOG, 1)
  memory(ids.shop, botId, SHOP, 2)
  memory(ids.tea, botId, TEA, 3, options.pinTea)
  memory(newId(), other.bot.id, OTHER, 4)
  for (const [index, [role, content]] of (options.history ?? []).entries()) {
    db.addMessage({ id: newId(), conversationId, role, content, toolCallsJson: null, toolCallId: null, toolName: null, createdAt: 10 + index, summarized: false, runId: null })
  }
  // The keyword search used before this change found nothing for an indirect follow-up.
  expect(db.searchMemories('Use the same setup as last time.', 5, botId)).toEqual([])
  db.close()

  const provider = new MockProvider()
  provider.handler = () => ({ content: 'On it.', toolCalls: [] })
  const second = reopen(first.dbPath, provider)
  cleanups.push(() => second.app.close())
  return { app: second.app, provider, conversationId, ids }
}

function request(messages: ChatMessage[] | undefined) {
  const system = (messages ?? []).filter(message => message.role === 'system').map(message => message.content)
  return {
    instructions: system[0] ?? '',
    pinned: system.find(text => text.startsWith('Pinned memories')) ?? '',
    retrieved: system.find(text => text.startsWith('Retrieved memories')) ?? '',
    all: (messages ?? []).map(message => message.content).join('\n')
  }
}

describe('memory recall', () => {
  it('resolves “the same setup as last time” from the recent conversation, within this bot', async () => {
    const { app, provider, conversationId, ids } = await seeded({
      pinTea: true,
      history: [['user', 'I finished the new blog post about autumn hikes.'], ['assistant', 'Nice. Want me to publish it?']]
    })
    expect((await app.sendMessage(conversationId, 'Yes, use the same setup as last time.')).status).toBe('completed')
    const sent = request(provider.calls.at(-1)?.messages)
    expect(sent.retrieved).toContain(`${ids.blog}: ${BLOG}`)
    expect(sent.retrieved).not.toContain(SHOP)
    expect(sent.instructions).toContain(`Memory ${ids.blog} best matches the recent conversation`)
    expect(sent.instructions).not.toContain('Do not guess')
    // Pinned memories still arrive on their own, and another bot's matching memory never does.
    expect(sent.pinned).toContain(`${ids.tea}: ${TEA}`)
    expect(sent.retrieved).not.toContain(TEA)
    expect(sent.all).not.toContain('OTHER-BOT-PRIVATE-STEPS')
    expect(provider.calls).toHaveLength(1)
  })

  it('asks which setup the user means when the conversation does not settle it', async () => {
    const { app, provider, conversationId, ids } = await seeded()
    expect((await app.sendMessage(conversationId, 'Use the same setup as last time.')).status).toBe('completed')
    const sent = request(provider.calls.at(-1)?.messages)
    expect(sent.retrieved).toContain(BLOG)
    expect(sent.retrieved).toContain(SHOP)
    expect(sent.instructions).toMatch(new RegExp(`memories (?:${ids.blog}, ${ids.shop}|${ids.shop}, ${ids.blog}) fit about equally`))
    expect(sent.instructions).toContain('ask one short question that names the options. Do not guess.')
    expect(sent.instructions).not.toContain('best matches')
    expect(sent.all).not.toContain('OTHER-BOT-PRIVATE-STEPS')
  })

  it('uses the active project when the chat gives no clue', async () => {
    const { app, provider, conversationId, ids } = await seeded({ workspace: 'shop-site' })
    await app.sendMessage(conversationId, 'Deploy it the same way as last time.')
    const sent = request(provider.calls.at(-1)?.messages)
    expect(sent.retrieved).toContain(SHOP)
    expect(sent.retrieved).not.toContain(BLOG)
    expect(sent.instructions).toContain(`Memory ${ids.shop} best matches`)
  })

  it('says so instead of guessing when no memory fits the follow-up', async () => {
    const { app, provider, conversationId } = await seeded()
    await app.sendMessage(conversationId, 'Use the same printer settings as last time.')
    const sent = request(provider.calls.at(-1)?.messages)
    expect(sent.retrieved).toBe('')
    expect(sent.instructions).toContain('no saved memory matches it')
    expect(sent.instructions).toContain('ask instead of guessing')
  })

  it('finds a memory phrased differently from the question', async () => {
    const { app, provider, conversationId, ids } = await seeded()
    await app.sendMessage(conversationId, 'What is my tea preference?')
    const sent = request(provider.calls.at(-1)?.messages)
    expect(sent.retrieved).toContain(`${ids.tea}: ${TEA}`)
    expect(sent.retrieved).not.toContain(BLOG)
    expect(sent.instructions).not.toContain('referring back')
  })

  it('recognizes follow-ups without treating ordinary phrases as one', () => {
    for (const text of ['Use the same setup as last time.', 'Deploy it like before', 'Do it again', 'The usual, please', 'Set it up again for the new site', 'Use what we agreed on']) expect(refersBack(text), text).toBe(true)
    for (const text of ['Thanks again!', 'Deploy the blog to Netlify.', 'What time is it?', 'Same here, good night']) expect(refersBack(text), text).toBe(false)
  })
})
