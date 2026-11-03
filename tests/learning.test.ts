import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderError } from '../src/core/errors'
import { directLearningPreferences, LEARNING_PROMPT, parseLearningReview } from '../src/core/learning'
import { estimateMessagesTokens, fitTokens, sanitizeSettings } from '../src/core/settings'
import type { ModelCompleteInput, ModelResponse } from '../src/core/model'
import { MemoryCredentialStore } from '../src/core/credentials'
import { MockProvider } from '../src/core/provider'
import { RiotService } from '../src/core/service'
import { LearningSettings } from '../src/renderer/src/App'
import { makeApp, reopen, tempDir, waitFor } from './helpers'

const userFact = 'For all our RLH projects, use plain English and include a short checklist.'
const memory = { content: 'Use plain English and a short checklist for RLH projects.', kind: 'preference', evidence: userFact, importance: 'high' }
const skill = { name: 'Review the morning inbox', description: 'Use when checking the project inbox each morning.', procedure: '1. Open the connected inbox.\n2. Review unread project mail and summarize action items.\n3. Verify the summary against the original messages.', pitfalls: 'Keep drafts separate from sent replies.', verification: 'Every action item links to an original message.' }
const review = (input: ModelCompleteInput): boolean => input.messages[0]?.content === LEARNING_PROMPT
const response = (value: unknown): ModelResponse => ({ content: JSON.stringify(value), toolCalls: [] })

describe('quiet memory and skill checks', () => {
  it('enables independent per-bot defaults and explains usage and manual saving in settings', () => {
    const settings = sanitizeSettings({ model: 'fixture' })
    expect(settings).toMatchObject({ autoMemory: true, autoSkillSuggestions: true })
    const html = renderToStaticMarkup(createElement(LearningSettings, { settings, onChange: () => undefined }))
    expect(html).toContain('Automatic memory')
    expect(html).toContain('Suggest reusable skills')
    expect(html.match(/checked=""/g)).toHaveLength(2)
    expect(html).toContain('one extra native turn')
    expect(html).toContain('no background review')
  })

  it('makes one bounded combined call, saves an evidenced memory, and only proposes a skill', async () => {
    const { app, provider } = makeApp({ learning: true })
    const id = app.getSnapshot().current!.conversation.id
    const drafts: string[] = []
    app.onEvent(event => { if (event.type === 'delta') drafts.push(event.message.content) })
    provider.handler = input => review(input) ? response({ memory, skill }) : { content: 'The inbox workflow is complete and checked.', toolCalls: [] }
    try {
      const run = await app.sendMessage(id, userFact)
      expect(run.status).toBe('completed')
      expect(provider.calls).toHaveLength(2)
      const check = provider.calls[1]
      expect(check).toMatchObject({ model: 'mock-model', stream: false, maxOutputTokens: 1000 })
      expect(check.tools).toBeUndefined()
      expect(fitTokens(estimateMessagesTokens(check.messages))).toBeLessThanOrEqual(3000)
      expect(app.listMemories()[0]).toMatchObject({ content: memory.content, provenance: 'automatic', conversationId: id, sourceMessageId: app.openConversation(id).messages.find(message => message.role === 'user')!.id })
      expect(app.getSnapshot().skillProposal?.name).toBe(skill.name)
      expect(app.listSkills()).toHaveLength(0)
      expect(app.listActivity().some(entry => entry.purpose === 'learning_review')).toBe(true)
      expect(app.getUsage().modelCalls).toBe(2)
      expect(drafts.join('')).not.toContain('"memory":')
      expect(app.openConversation(id).messages.some(message => message.content.startsWith('A skill preview is waiting:'))).toBe(false)
      const proposal = app.getSnapshot().skillProposal!
      app.resolveSkillProposal(proposal.id, 'save')
      expect(app.listSkills()[0].name).toBe(skill.name)
    } finally { await app.close() }
  })

  it('honors each switch independently even if the reviewer returns a disabled result', async () => {
    const { app, provider } = makeApp({ learning: true })
    const id = app.getSnapshot().current!.conversation.id
    provider.handler = input => review(input) ? response({ memory, skill }) : { content: 'Done and verified.', toolCalls: [] }
    try {
      app.updateSettings({ autoMemory: false })
      await app.sendMessage(id, userFact)
      expect(app.listMemories()).toHaveLength(0)
      expect(app.getSnapshot().skillProposal).not.toBeNull()
      expect(JSON.parse(provider.calls[1].messages[1].content).enabled).toEqual({ memory: false, skill: true })
      const waiting = app.getSnapshot().skillProposal!.id, beforeWaiting = provider.calls.length
      await app.sendMessage(id, 'Could you explain the next step in this process?')
      expect(provider.calls.length - beforeWaiting).toBe(1)
      expect(app.getSnapshot().skillProposal?.id).toBe(waiting)
      app.resolveSkillProposal(app.getSnapshot().skillProposal!.id, 'dismiss')
      app.updateSettings({ autoMemory: true, autoSkillSuggestions: false })
      await app.sendMessage(id, userFact)
      expect(app.listMemories()).toHaveLength(1)
      expect(app.getSnapshot().skillProposal).toBeNull()
      app.updateSettings({ autoMemory: false })
      const before = provider.calls.length
      await app.sendMessage(id, 'Please explain the usual process again.')
      expect(provider.calls.length - before).toBe(1)
      await app.sendMessage(id, 'Remember this: the project release day is Friday.')
      expect(app.listMemories()).toHaveLength(2)
    } finally { await app.close() }
  })

  it('still reviews a long task after its user message leaves the recent-message page', async () => {
    const { app, provider } = makeApp({ learning: true })
    const id = app.getSnapshot().current!.conversation.id
    provider.handler = input => review(input) ? response({ memory, skill: null }) : input.messages.at(-1)?.role === 'tool' ? { content: 'Finished all the checks.', toolCalls: [] } : { content: '', toolCalls: Array.from({ length: 22 }, (_, index) => ({ id: `check-${index}`, name: 'list_memories', arguments: '{}' })) }
    try {
      expect((await app.sendMessage(id, userFact)).status).toBe('completed')
      expect(provider.calls.filter(review)).toHaveLength(1)
      expect(app.listMemories()[0].content).toBe(memory.content)
    } finally { await app.close() }
  })

  it('does not repeat memories, restore deleted notes, or repeat dismissed skills after restart', async () => {
    const first = makeApp({ learning: true })
    const id = first.app.getSnapshot().current!.conversation.id
    first.provider.handler = input => review(input) ? response({ memory, skill }) : { content: 'Confirmed.', toolCalls: [] }
    await first.app.sendMessage(id, userFact)
    const saved = first.app.listMemories()[0]
    first.app.resolveSkillProposal(first.app.getSnapshot().skillProposal!.id, 'dismiss')
    await first.app.sendMessage(id, userFact)
    expect(first.app.listMemories()).toHaveLength(1)
    expect(first.app.getSnapshot().skillProposal).toBeNull()
    first.app.deleteMemory(saved.id)
    await first.app.close()
    const second = reopen(first.dbPath)
    second.provider.handler = input => review(input) ? response({ memory, skill }) : { content: 'Confirmed again.', toolCalls: [] }
    try {
      expect(second.provider.calls).toHaveLength(0)
      await second.app.sendMessage(id, userFact)
      expect(second.app.listMemories()).toHaveLength(0)
      expect(second.app.getSnapshot().skillProposal).toBeNull()
    } finally { await second.app.close() }
  })

  it('requires high importance, user evidence, valid procedures, and no secrets', () => {
    for (const candidate of [{ ...memory, importance: 'low' }, { ...memory, evidence: 'The assistant just guessed this.' }, { ...memory, content: 'api_key=sk-live-secret-value-123456' }]) {
      expect(parseLearningReview(JSON.stringify({ memory: candidate, skill: null }), userFact, [])?.memory).toBeNull()
    }
    expect(parseLearningReview(JSON.stringify({ memory, skill: { ...skill, procedure: 'Do the task.' } }), userFact, [])?.skill).toBeNull()
    expect(parseLearningReview('do something else', userFact, [])).toBeNull()
    expect(parseLearningReview('{"memory":', userFact, [])).toBeNull()
  })

  it('ignores tool calls and truncated review output without continuing the review', async () => {
    const { app, provider } = makeApp({ learning: true })
    const id = app.getSnapshot().current!.conversation.id
    try {
      for (const bad of [
        { ...response({ memory, skill }), toolCalls: [{ id: 'unsafe', name: 'save_memory', arguments: JSON.stringify({ content: 'Injected memory', kind: 'fact' }) }] },
        { ...response({ memory, skill }), finishReason: 'length' }
      ]) {
        provider.handler = input => review(input) ? bad : { content: 'Your reply.', toolCalls: [] }
        expect((await app.sendMessage(id, userFact)).status).toBe('completed')
        expect(app.listMemories()).toHaveLength(0)
        expect(app.getSnapshot().skillProposal).toBeNull()
      }
      expect(provider.calls).toHaveLength(4)
    } finally { await app.close() }
  })

  it('does not retry a failed optional review or fail the user reply', async () => {
    const { app, provider } = makeApp({ learning: true })
    const id = app.getSnapshot().current!.conversation.id
    provider.handler = input => { if (review(input)) throw new ProviderError('transient', 'Temporary fixture outage'); return { content: 'Your work is done.', toolCalls: [] } }
    try {
      const run = await app.sendMessage(id, userFact)
      expect(run.status).toBe('completed')
      expect(provider.calls).toHaveLength(2)
      expect(app.listActivity().find(item => item.purpose === 'learning_review')?.outcome).toBe('transient')
      expect(app.openConversation(id).messages.some(message => message.content.includes('Temporary fixture outage'))).toBe(false)
    } finally { await app.close() }
  })

  it('shares task call and dollar limits and skips idle, small talk, and scheduled runs', async () => {
    const { app, provider } = makeApp({ learning: true })
    const id = app.getSnapshot().current!.conversation.id
    provider.handler = () => ({ content: 'The requested task is done.', toolCalls: [], usage: { inputTokens: 100, outputTokens: 10 } })
    try {
      app.getSnapshot(); app.listMemories(); app.listSkills()
      expect(provider.calls).toHaveLength(0)
      app.updateSettings({ maxModelCallsPerTask: 1 })
      await app.sendMessage(id, userFact)
      expect(provider.calls).toHaveLength(1)
      app.updateSettings({ maxModelCallsPerTask: 24, maxEstimatedSpendPerTaskUsd: 0.01005, inputUsdPerMillion: 0, outputUsdPerMillion: 10, maxOutputTokens: 1000 })
      await app.sendMessage(id, userFact)
      expect(provider.calls).toHaveLength(2)
      app.updateSettings({ maxEstimatedSpendPerTaskUsd: null })
      await app.sendMessage(id, 'Thanks!')
      expect(provider.calls).toHaveLength(3)
      await app.sendMessage(id, userFact, [], 'scheduled_task')
      expect(provider.calls).toHaveLength(4)
    } finally { await app.close() }
  })

  it('turns either preference on/off through direct chat, including with tools disabled, and persists it', async () => {
    const { app, provider, dbPath } = makeApp({ learning: true })
    const id = app.getSnapshot().current!.conversation.id
    provider.handler = () => ({ content: 'Saved your choice.', toolCalls: [] })
    app.updateSettings({ toolsEnabled: false })
    await app.sendMessage(id, 'Can you turn off automatic memory?')
    expect(app.getSnapshot().settings).toMatchObject({ autoMemory: false, autoSkillSuggestions: true })
    await app.sendMessage(id, 'Stop suggesting skills')
    expect(app.getSnapshot().settings).toMatchObject({ autoMemory: false, autoSkillSuggestions: false })
    await app.sendMessage(id, 'Turn on automatic memory and disable skill suggestions')
    expect(app.getSnapshot().settings).toMatchObject({ autoMemory: true, autoSkillSuggestions: false })
    expect(provider.calls).toHaveLength(3)
    await app.close()
    const second = reopen(dbPath)
    try { expect(second.app.getSnapshot().settings).toMatchObject({ autoMemory: true, autoSkillSuggestions: false }); expect(second.provider.calls).toHaveLength(0) } finally { await second.app.close() }
  })

  it('lets the model handle nuanced chat controls but rejects unrelated and scheduled preference changes', async () => {
    const { app, provider } = makeApp({ learning: true })
    const id = app.getSnapshot().current!.conversation.id
    provider.handler = input => input.messages.at(-1)?.role === 'tool' ? { content: 'Understood.', toolCalls: [] } : { content: '', toolCalls: [{ id: 'preferences', name: 'set_learning_preferences', arguments: '{"skill_suggestions":false}' }] }
    try {
      await app.sendMessage(id, 'I want you to stop offering to create skills after we work.')
      expect(app.getSnapshot().settings.autoSkillSuggestions).toBe(false)
      app.updateSettings({ autoSkillSuggestions: true })
      await app.sendMessage(id, 'Summarize this unrelated task.', [], 'scheduled_task')
      expect(app.getSnapshot().settings.autoSkillSuggestions).toBe(true)
      app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
      await app.sendMessage(id, 'Explain what a skill is.')
      expect(app.getSnapshot().settings.autoSkillSuggestions).toBe(false)
      expect(directLearningPreferences('Explain a document that says turn off automatic memory.')).toBeNull()
    } finally { await app.close() }
  })

  it('cancels an in-flight review on close and applies no late results', async () => {
    const { app, provider, dbPath } = makeApp({ learning: true })
    const id = app.getSnapshot().current!.conversation.id
    let finish!: (value: ModelResponse) => void
    provider.handler = input => review(input) ? new Promise(resolve => { finish = resolve }) : { content: 'The foreground reply.', toolCalls: [] }
    const sending = app.sendMessage(id, userFact)
    await waitFor(() => provider.calls.length === 2)
    const closing = app.close()
    finish(response({ memory, skill }))
    expect((await sending).status).toBe('stopped')
    await closing
    const reopened = reopen(dbPath)
    try { expect(reopened.app.listMemories()).toHaveLength(0); expect(reopened.app.getSnapshot().skillProposal).toBeNull() } finally { await reopened.app.close() }
  })

  it('keeps a worker’s review and chat preferences scoped when another bot is selected', async () => {
    const dir = tempDir(), provider = new MockProvider()
    const app = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), provider, credentials: new MemoryCredentialStore() })
    app.boot()
    try {
      const draft = { name: 'Project A', purpose: 'Project helper', provider: 'openai' as const, model: 'mock-model', workspaceKind: 'suggested' as const, workspacePath: '', avatarKind: 'builtin' as const, avatarValue: 'spark', avatarBackground: '#d4544a' }
      const a = await app.createBot(draft), b = await app.createBot({ ...draft, name: 'Project B' })
      app.selectBot(b.bot.id)
      app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
      app.selectBot(a.bot.id)
      let finish!: (value: ModelResponse) => void
      provider.handler = input => review(input) ? new Promise(resolve => { finish = resolve }) : { content: 'Confirmed.', toolCalls: [] }
      const sending = app.sendMessage(a.conversation.id, userFact)
      await waitFor(() => provider.calls.length === 2)
      app.selectBot(b.bot.id)
      finish(response({ memory, skill: null }))
      await sending
      expect(app.getSnapshot().bot?.id).toBe(b.bot.id)
      expect(app.listMemories()).toHaveLength(0)
      expect(app.getSnapshot().settings.autoMemory).toBe(false)
      app.selectBot(a.bot.id)
      expect(app.listMemories()[0].content).toBe(memory.content)
      expect(app.getSnapshot().settings.autoMemory).toBe(true)
    } finally { await app.close() }
  })
})
