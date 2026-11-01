import { describe, expect, it } from 'vitest'
import type { BrowserOpener, LaunchedBrowser, LaunchedPage, RawControl } from '../src/core/browser'
import { buildContext } from '../src/core/context'
import { AUTOMATIC_ASSEMBLY_TARGET, CONSERVATIVE_FALLBACK_CAPACITY, lookupProviderContext, planContext } from '../src/core/context-policy'
import { Database, type MessageRecord } from '../src/core/db'
import { ProviderError } from '../src/core/errors'
import { newId } from '../src/core/ids'
import { actionStatus, completedStatus } from '../src/core/progress'
import { estimateTokens, fitTokens } from '../src/core/settings'
import { makeApp, reopen } from './helpers'

const publicLookup = async (): Promise<string[]> => ['93.184.216.34']

describe('automatic context', () => {
  it('uses a documented window, a configured window, or a labeled fallback without inventing one', async () => {
    const configured = planContext({
      mode: 'automatic',
      contextTokenBudget: 8000,
      maxOutputTokens: 2048,
      configuredCapacity: 64000,
      providerCapacity: 131072
    })
    expect(configured.capacity).toBe(64000)
    expect(configured.source).toBe('configured')
    expect(configured.inputCeiling).toBe(64000 - fitTokens(2048))
    expect(configured.assemblyTarget).toBe(AUTOMATIC_ASSEMBLY_TARGET)

    const documented = planContext({
      mode: 'automatic',
      contextTokenBudget: 8000,
      maxOutputTokens: 2048,
      configuredCapacity: null,
      providerCapacity: 131072
    })
    expect(documented.source).toBe('provider')
    expect(documented.capacity).toBe(131072)
    expect(documented.fallback).toBe(false)

    const fallback = planContext({
      mode: 'automatic',
      contextTokenBudget: 8000,
      maxOutputTokens: 2048,
      configuredCapacity: null,
      providerCapacity: null
    })
    expect(fallback.capacity).toBeNull()
    expect(fallback.source).toBe('fallback')
    expect(fallback.fallback).toBe(true)
    expect(fallback.inputCeiling).toBe(CONSERVATIVE_FALLBACK_CAPACITY - fitTokens(2048))
    expect(fallback.assemblyTarget).toBe(AUTOMATIC_ASSEMBLY_TARGET)
    expect(fallback.inputCeiling).toBeGreaterThan(8000)

    const manual = planContext({
      mode: 'manual',
      contextTokenBudget: 8000,
      maxOutputTokens: 2048,
      configuredCapacity: null,
      providerCapacity: 131072
    })
    expect(manual.inputCeiling).toBe(8000)
    expect(manual.assemblyTarget).toBe(8000)
    expect(manual.source).toBe('manual')

    let fetches = 0
    const found = await lookupProviderContext({
      provider: 'openrouter',
      model: 'vendor/model',
      fetchImpl: async () => {
        fetches += 1
        return new Response(JSON.stringify({ data: [{ id: 'vendor/model', context_length: 131072 }, { id: 'other', context_length: 999 }] }), { status: 200 })
      }
    })
    expect(fetches).toBe(1)
    expect(found).toEqual({ contextTokens: 131072, source: 'provider' })
    const missing = await lookupProviderContext({
      provider: 'openrouter',
      model: 'vendor/missing',
      fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'vendor/model' }] }), { status: 200 })
    })
    expect(missing).toEqual({ contextTokens: null, source: 'unavailable' })
    const openai = await lookupProviderContext({
      provider: 'openai',
      model: 'gpt-test',
      fetchImpl: async () => {
        throw new Error('OpenAI context lookup must not call the network')
      }
    })
    expect(openai.contextTokens).toBeNull()
  })

  it('keeps a continuity record and can send a current turn past the preferred target', () => {
    const summary = `Objective: finish the docs lookup.\n${'LATE-ONLY '.repeat(2000)}`
    const kept = buildContext({
      systemPrompt: 'Stay brief.',
      pinnedInstructions: '',
      pinnedMemories: [],
      retrievedMemories: [],
      summary,
      task: null,
      recent: [stored(newId(), 'Continue', 'user', 1)],
      tokenBudget: 2500,
      packTarget: 2500,
      budgetKind: 'automatic'
    })
    const text = kept.messages.map((message) => message.content).join('\n')
    expect(kept.overBudget).toBe(false)
    expect(text).toContain('Continuity record')
    expect(text).toContain('Objective: finish the docs lookup.')
    expect(text).not.toContain('LATE-ONLY')

    const article = 'PAGE '.repeat(7000)
    const assistantId = newId()
    const toolId = newId()
    const current = buildContext({
      systemPrompt: 'Stay brief.',
      pinnedInstructions: '',
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: [
        stored(newId(), 'Read the page', 'user', 1),
        { ...stored(assistantId, '', 'assistant', 2), toolCallsJson: JSON.stringify([{ id: 'read-1', name: 'read_page', arguments: '{}' }]) },
        { ...stored(toolId, article, 'tool', 3), toolCallId: 'read-1', toolName: 'read_page' }
      ],
      tokenBudget: 40_000,
      packTarget: AUTOMATIC_ASSEMBLY_TARGET,
      budgetKind: 'automatic'
    })
    expect(current.overBudget).toBe(false)
    expect(current.omittedMessageIds).not.toContain(toolId)
    expect(fitTokens(current.estimatedTokens)).toBeGreaterThan(AUTOMATIC_ASSEMBLY_TARGET)
    expect(fitTokens(current.estimatedTokens)).toBeLessThanOrEqual(40_000)
    const previewed = buildContext({
      systemPrompt: 'Stay brief.',
      pinnedInstructions: '',
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: [
        stored(newId(), 'Read the page', 'user', 1),
        { ...stored(assistantId, '', 'assistant', 2), toolCallsJson: JSON.stringify([{ id: 'read-1', name: 'read_page', arguments: '{}' }]) },
        { ...stored(toolId, article, 'tool', 3), toolCallId: 'read-1', toolName: 'read_page' }
      ],
      tokenBudget: 40_000,
      packTarget: AUTOMATIC_ASSEMBLY_TARGET,
      budgetKind: 'automatic',
      toolPreviewChars: 1600
    })
    const preview = previewed.messages.find((message) => message.role === 'tool')
    expect(preview?.content.length).toBeLessThan(2000)
    expect(preview?.content).toContain('stored locally')
    expect(preview?.content).toContain('read-1')
    expect(preview?.toolCallId).toBe('read-1')
  })

  it('names a configuration problem and an oversized message without calling them spending limits', () => {
    const configured = buildContext({
      systemPrompt: 'Stay brief.',
      pinnedInstructions: '',
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: [stored(newId(), 'Hi', 'user', 1)],
      tokenBudget: 1024,
      budgetKind: 'automatic',
      toolTokenReserve: 5000,
      responseAllowance: 2048,
      modelContextTokens: 2000
    })
    expect(configured.hardStop).toBe(true)
    expect(configured.pauseReason ?? '').toMatch(/configuration problem/)
    expect(configured.pauseReason ?? '').toMatch(/not a spending limit/)
    expect(configured.pauseReason ?? '').not.toMatch(/input working budget/)
    expect(configured.pauseReason ?? '').not.toMatch(/shorten/i)

    const huge = buildContext({
      systemPrompt: 'Stay brief.',
      pinnedInstructions: '',
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: [stored(newId(), 'QUESTION '.repeat(8000), 'user', 1)],
      tokenBudget: 2000,
      budgetKind: 'fallback'
    })
    expect(huge.pauseReason ?? '').toMatch(/Split it into smaller messages/)
    expect(huge.pauseReason ?? '').toMatch(/workspace file/)
    expect(huge.pauseReason ?? '').toMatch(/not a spending limit/)
    expect(huge.pauseReason ?? '').toMatch(/conservative working limit/)
    expect(huge.pauseReason ?? '').not.toMatch(/input working budget/)
  })

  it('searches, opens a source, and answers from a stored section without using the 8000 budget as a ceiling', async () => {
    const article = `${'Playwright documentation paragraph. '.repeat(180)}PLAYWRIGHT_DOC_MARKER${' end of the article.'.repeat(40)}`
    expect(article.length).toBeGreaterThan(5000)
    const fetches: string[] = []
    const { app, provider } = makeApp({
      lookupHost: publicLookup,
      browserOpener: docsBrowser(article),
      fetchImpl: async (url) => {
        fetches.push(String(url))
        throw new Error('The browser fixture should not fetch the catalog or the page')
      }
    })
    const conversationId = app.getSnapshot().current?.conversation.id ?? ''
    app.getSnapshot()
    expect(provider.calls).toHaveLength(0)
    expect(fetches).toHaveLength(0)
    expect(app.getSnapshot().settings.contextTokenBudget).toBe(8000)
    expect(app.getSnapshot().settings.contextMode).toBe('automatic')

    provider.handler = (input) => {
      const last = [...input.messages].reverse().find((message) => message.role === 'tool')
      if (last?.name === 'read_tool_result') return { content: 'The Playwright source includes PLAYWRIGHT_DOC_MARKER.', toolCalls: [] }
      if (last?.name === 'read_page') {
        return { content: '', toolCalls: [{ id: 'section-1', name: 'read_tool_result', arguments: JSON.stringify({ id: last.toolCallId, query: 'PLAYWRIGHT_DOC_MARKER' }) }] }
      }
      if (last?.name === 'open_url') return { content: '', toolCalls: [{ id: 'read-1', name: 'read_page', arguments: '{}' }] }
      if (last?.name === 'web_search') {
        return { content: '', toolCalls: [{ id: 'open-1', name: 'open_url', arguments: JSON.stringify({ url: 'https://playwright.dev/docs/browser-contexts' }) }] }
      }
      const names = input.tools?.map((tool) => tool.name) ?? []
      expect(names).toContain('web_search')
      expect(names).toContain('open_url')
      expect(names).toContain('read_tool_result')
      expect(names).not.toContain('list_files')
      return { content: '', toolCalls: [{ id: 'search-1', name: 'web_search', arguments: JSON.stringify({ query: 'playwright browser contexts' }) }] }
    }

    const run = await app.sendMessage(conversationId, 'Search Playwright documentation and open a result')
    expect(run.status).toBe('completed')
    expect(run.note).toBe('')
    expect(fetches).toHaveLength(0)
    const detail = app.openConversation(conversationId)
    const counts = countTools(detail.messages)
    expect(counts).toEqual({ web_search: 1, open_url: 1, read_page: 1, read_tool_result: 1 })
    expect(paired(detail.messages)).toBe(true)
    const stored = detail.messages.find((message) => message.toolName === 'read_page')
    expect(stored?.content).toContain('PLAYWRIGHT_DOC_MARKER')
    expect(stored?.content.length).toBeGreaterThan(5000)
    const previewCall = provider.calls.find((call) => call.messages.some((message) => message.name === 'read_page'))
    const preview = previewCall?.messages.find((message) => message.name === 'read_page')
    expect(preview?.content).toContain('stored locally')
    expect(preview?.content).not.toContain('PLAYWRIGHT_DOC_MARKER')
    expect(preview?.content.length).toBeLessThan(2000)
    expect(preview?.toolCallId).toBe('read-1')
    const section = detail.messages.find((message) => message.toolName === 'read_tool_result')
    expect(section?.content).toContain('PLAYWRIGHT_DOC_MARKER')
    const answer = detail.messages.filter((message) => message.role === 'assistant').at(-1)
    expect(answer?.content).toContain('PLAYWRIGHT_DOC_MARKER')
    const plan = planContext({ mode: 'automatic', contextTokenBudget: 8000, maxOutputTokens: 2048, configuredCapacity: null, providerCapacity: null })
    const activity = app.listActivity()
    expect(activity.some((entry) => entry.purpose === 'compaction')).toBe(false)
    expect(activity.length).toBeGreaterThan(0)
    for (const entry of activity) {
      expect(entry.context?.contextLimit).toBe(plan.inputCeiling)
      expect(entry.context?.capacitySource).toBe('fallback')
      expect(entry.context?.modelContextTokens ?? null).toBeNull()
      expect(entry.context?.assemblyTarget).toBe(AUTOMATIC_ASSEMBLY_TARGET)
      expect(fitTokens(entry.context?.estimatedInputTokens ?? 0)).toBeLessThanOrEqual(plan.inputCeiling)
    }
    await app.close()
  })

  it('compacts an old conversation once, keeps the transcript, and does not compact the same messages again', async () => {
    const first = makeApp()
    const conversationId = first.app.getSnapshot().current?.conversation.id ?? ''
    first.app.updateSettings({ toolsEnabled: false, maxModelCallsPerTask: 8 })
    const dbPath = first.dbPath
    await first.app.close()
    const db = new Database(dbPath)
    db.migrate()
    for (let index = 0; index < 4; index += 1) {
      db.addMessage(stored(newId(), `OLD-TOPIC-${index} ${'history '.repeat(1100)}`, 'user', index + 1, conversationId))
    }
    db.close()
    const second = reopen(dbPath)
    const compactedIds: string[][] = []
    second.provider.handler = (input) => {
      const blob = input.messages.map((message) => message.content).join('\n')
      if (blob.includes('Summarize the earlier conversation')) {
        compactedIds.push([...blob.matchAll(/\[message ([0-9a-f-]+)/g)].map((match) => match[1]))
        return { content: 'Objective: continue the topic.\nDecisions: none.\nConstraints: none.\nUnfinished: read the source.', toolCalls: [] }
      }
      return { content: 'Continuing.', toolCalls: [] }
    }
    const run = await second.app.sendMessage(conversationId, 'Continue the work')
    expect(run.status).toBe('completed')
    expect(compactedIds.length).toBeGreaterThan(0)
    const seen = new Set<string>()
    for (const batch of compactedIds) {
      expect(batch.length).toBeGreaterThan(0)
      for (const id of batch) {
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
    }
    const chat = second.provider.calls.find((call) => !call.messages.some((message) => message.content.includes('Summarize the earlier conversation')))
    const chatText = chat?.messages.map((message) => message.content).join('\n') ?? ''
    expect(chatText).not.toContain('OLD-TOPIC-0')
    expect(chatText).toMatch(/Objective: continue the topic|Continuity record/)
    const saved = new Database(dbPath)
    saved.migrate()
    expect(saved.listMessages(conversationId).some((message) => message.content.includes('OLD-TOPIC-0'))).toBe(true)
    expect(saved.conversationForBot(saved.listBots()[0].id, conversationId)?.summary).toContain('Objective:')
    saved.close()
    const again = await second.app.sendMessage(conversationId, 'Status check')
    expect(again.status).toBe('completed')
    const activity = second.app.listActivity()
    expect(activity.filter((entry) => entry.purpose === 'compaction')).toHaveLength(compactedIds.length)
    const largest = Math.max(...activity.map((entry) => entry.context?.estimatedInputTokens ?? 0))
    expect(fitTokens(largest)).toBeGreaterThan(8000)
    expect(second.app.getSnapshot().settings.contextTokenBudget).toBe(8000)
    expect(activity.every((entry) => (entry.context?.contextLimit ?? 0) > 8000)).toBe(true)
    await second.app.close()
  })

  it('retries one real context rejection with a smaller request and does not repeat the tool', async () => {
    const body = `${'alpha '.repeat(1200)}PLAYWRIGHT_DOC_MARKER ${'omega '.repeat(400)}`
    let pageFetches = 0
    const { app, provider } = makeApp({
      lookupHost: publicLookup,
      fetchImpl: async (url) => {
        pageFetches += 1
        expect(String(url)).toBe('https://example.com/docs')
        return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } })
      }
    })
    const conversationId = app.getSnapshot().current?.conversation.id ?? ''
    const toolLengths: number[] = []
    provider.handler = (input) => {
      const tool = input.messages.find((message) => message.role === 'tool' && message.name === 'fetch_url')
      if (!tool) return { content: '', toolCalls: [{ id: 'fetch-1', name: 'fetch_url', arguments: JSON.stringify({ url: 'https://example.com/docs' }) }] }
      toolLengths.push(tool.content.length)
      if (toolLengths.length === 1) throw new ProviderError('context_limit', 'maximum context length exceeded')
      expect(input.messages.some((message) => message.toolCalls?.some((call) => call.id === 'fetch-1'))).toBe(true)
      expect(tool.toolCallId).toBe('fetch-1')
      return { content: 'Fetched the docs once.', toolCalls: [] }
    }
    const run = await app.sendMessage(conversationId, 'Open the docs page')
    expect(run.status).toBe('completed')
    expect(pageFetches).toBe(1)
    expect(toolLengths).toHaveLength(2)
    expect(toolLengths[1]).toBeLessThan(toolLengths[0])
    expect(toolLengths[1]).toBeLessThan(900)
    const detail = app.openConversation(conversationId)
    expect(detail.messages.filter((message) => message.toolName === 'fetch_url')).toHaveLength(1)
    expect(detail.messages.find((message) => message.toolName === 'fetch_url')?.content).toContain('PLAYWRIGHT_DOC_MARKER')
    expect(paired(detail.messages)).toBe(true)
    expect(detail.run?.status).toBe('completed')
    await app.close()

    let otherFetches = 0
    const failed = makeApp({
      lookupHost: publicLookup,
      fetchImpl: async () => {
        otherFetches += 1
        return new Response('short page', { status: 200, headers: { 'content-type': 'text/plain' } })
      }
    })
    failed.provider.handler = (input) => {
      if (input.messages.some((message) => message.role === 'tool')) throw new ProviderError('unknown', 'The provider returned an unrelated error.')
      return { content: '', toolCalls: [{ id: 'fetch-2', name: 'fetch_url', arguments: JSON.stringify({ url: 'https://example.com/once' }) }] }
    }
    const broken = await failed.app.sendMessage(failed.app.getSnapshot().current?.conversation.id ?? '', 'Open the docs page')
    expect(broken.status).toBe('failed')
    expect(otherFetches).toBe(1)
    expect(failed.provider.calls).toHaveLength(2)
    await failed.app.close()
  })

  it('keeps a spending block distinct from context, and does not fetch a catalog on idle or for every turn', async () => {
    const blocked = makeApp()
    blocked.app.updateSettings({ inputUsdPerMillion: 3, outputUsdPerMillion: 12, maxEstimatedSpendPerTaskUsd: 0, maxOutputTokens: 200 })
    blocked.provider.handler = () => ({ content: 'should not run', toolCalls: [] })
    const paused = await blocked.app.sendMessage(blocked.app.getSnapshot().current?.conversation.id ?? '', 'Hello')
    expect(paused.status).toBe('paused')
    expect(paused.note.toLowerCase()).toContain('spend')
    expect(paused.note).not.toMatch(/input working budget/)
    expect(blocked.provider.calls).toHaveLength(0)
    expect(blocked.app.getSnapshot().settings.maxEstimatedSpendPerTaskUsd).toBe(0)
    await blocked.app.close()

    let now = 1_700_000_000_000
    let catalogFetches = 0
    const cached = makeApp({
      now: () => now,
      fetchImpl: async (url) => {
        catalogFetches += 1
        expect(String(url)).toBe('https://openrouter.ai/api/v1/models')
        return new Response(JSON.stringify({ data: [{ id: 'vendor/model', context_length: 131072 }] }), { status: 200 })
      }
    })
    cached.app.getSnapshot()
    cached.app.listActivity()
    expect(catalogFetches).toBe(0)
    expect(cached.provider.calls).toHaveLength(0)
    cached.app.updateSettings({ provider: 'openrouter', model: 'vendor/model' })
    cached.provider.handler = () => ({ content: 'ok', toolCalls: [] })
    const conversationId = cached.app.getSnapshot().current?.conversation.id ?? ''
    await cached.app.sendMessage(conversationId, 'Hello')
    await cached.app.sendMessage(conversationId, 'Hello again')
    expect(catalogFetches).toBe(1)
    const documented = cached.app.listActivity().find((entry) => entry.purpose === 'chat')
    expect(documented?.context?.capacitySource).toBe('provider')
    expect(documented?.context?.modelContextTokens).toBe(131072)
    expect(documented?.context?.contextLimit).toBe(131072 - fitTokens(2048))
    now += 8 * 24 * 60 * 60 * 1000
    await cached.app.sendMessage(conversationId, 'Hello later')
    expect(catalogFetches).toBe(2)
    await cached.app.close()
  })

  it('loads a requested tool group on the next step and keeps core tools available', async () => {
    const { app, provider } = makeApp()
    let step = 0
    provider.handler = (input) => {
      const names = input.tools?.map((tool) => tool.name) ?? []
      if (step === 0) {
        step = 1
        expect(names).toContain('describe_tools')
        expect(names).toContain('web_search')
        expect(names).not.toContain('list_files')
        expect(names).not.toContain('run_terminal')
        return { content: '', toolCalls: [{ id: 'group-1', name: 'describe_tools', arguments: JSON.stringify({ group: 'files' }) }] }
      }
      expect(names).toContain('list_files')
      expect(names).toContain('read_file')
      expect(names).toContain('web_search')
      return { content: 'File tools are ready.', toolCalls: [] }
    }
    const run = await app.sendMessage(app.getSnapshot().current?.conversation.id ?? '', 'Hello there')
    expect(run.status).toBe('completed')
    expect(step).toBe(1)
    await app.close()
  })

  it('labels completed, failed, paused, and interrupted runs separately', () => {
    expect(completedStatus(2)).toBe('Completed · 2 actions · View details')
    expect(actionStatus(2, 'completed')).toBe('Completed · 2 actions · View details')
    expect(actionStatus(1, 'paused')).toBe('Paused · 1 action finished · View details')
    expect(actionStatus(2, 'failed')).toBe('Failed · 2 actions finished · View details')
    expect(actionStatus(2, 'stopped')).toBe('Interrupted · 2 actions finished · View details')
    expect(actionStatus(2, 'interrupted')).toBe('Interrupted · 2 actions finished · View details')
    expect(estimateTokens('x')).toBeGreaterThan(0)
  })
})

function docsBrowser(article: string): BrowserOpener {
  return async () => new DocsBrowser(article)
}

class DocsBrowser implements LaunchedBrowser {
  private readonly page: DocsPage
  constructor(article: string) {
    this.page = new DocsPage(article)
  }
  pages(): LaunchedPage[] {
    return [this.page]
  }
  current(): LaunchedPage | null {
    return this.page
  }
  select(): void {}
  async openPage(): Promise<LaunchedPage> {
    return this.page
  }
  async close(): Promise<void> {}
}

class DocsPage implements LaunchedPage {
  private urlValue = 'about:blank'
  constructor(private readonly article: string) {}
  url(): string {
    return this.urlValue
  }
  async title(): Promise<string> {
    return this.urlValue.includes('playwright.dev') ? 'Playwright Library | Playwright' : 'Search'
  }
  async goto(url: string): Promise<void> {
    this.urlValue = url
  }
  async back(): Promise<void> {}
  async close(): Promise<void> {}
  async text(limit: number): Promise<string> {
    return this.article.slice(0, limit)
  }
  async links(): Promise<{ text: string; href: string }[]> {
    return [{ text: 'Browser contexts', href: 'https://playwright.dev/docs/browser-contexts' }]
  }
  async html(): Promise<string> {
    return '<a class="result__a" href="https://playwright.dev/docs/browser-contexts">Browser contexts</a><a class="result__snippet" href="https://playwright.dev/docs/browser-contexts">Contexts isolate cookies.</a>'
  }
  async observe(): Promise<RawControl[]> {
    return [{ role: 'link', name: 'Browser contexts', inputType: '', href: 'https://playwright.dev/docs/browser-contexts' }]
  }
  async press(): Promise<void> {}
  async typeInto(): Promise<void> {}
  async scroll(): Promise<void> {}
}

function stored(id: string, content: string, role: MessageRecord['role'], createdAt: number, conversationId = 'conversation'): MessageRecord {
  return {
    id,
    conversationId,
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

function countTools(messages: { toolName?: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const message of messages) {
    if (!message.toolName) continue
    counts[message.toolName] = (counts[message.toolName] ?? 0) + 1
  }
  return counts
}

function paired(messages: { role: string; toolCalls?: { id: string }[]; toolCallId?: string | null }[]): boolean {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue
    const ids = new Set(message.toolCalls.map((call) => call.id))
    for (let next = index + 1; next < messages.length && messages[next].role === 'tool'; next += 1) {
      if (messages[next].toolCallId) ids.delete(messages[next].toolCallId as string)
    }
    if (ids.size > 0) return false
  }
  return true
}
