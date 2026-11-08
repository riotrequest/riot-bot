import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BrowserOpener, LaunchedPage } from '../src/core/browser'
import { Database } from '../src/core/db'
import { MemoryCredentialStore } from '../src/core/credentials'
import { MockProvider } from '../src/core/provider'
import { RESEARCH_ATTEMPT_LIMIT, resetResearchState, type ResearchExchange, type ResearchResponse } from '../src/core/research'
import { RiotService } from '../src/core/service'
import { localDay } from '../src/core/settings'
import { openDatabase } from '../src/core/sqlite'
import { makeApp, tempDir, waitFor } from './helpers'

const publicLookup = async (): Promise<string[]> => ['93.184.216.34']
const tavilyHit = { results: [{ title: 'Example', url: 'https://example.com/', content: 'A public example page.', score: 0.4 }] }
const firecrawlHit = { success: true, data: { web: [{ title: 'Example', url: 'https://example.com/fire', description: 'A public Firecrawl snippet.' }] } }

afterEach(() => resetResearchState())

function reply(body: unknown, status = 200, headers: Record<string, string> = {}): ResearchResponse {
  return { status, headers, body: typeof body === 'string' ? body : JSON.stringify(body) }
}

function searchHandler(provider: MockProvider, query = 'public weather'): void {
  provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
    ? { content: 'Noted.', toolCalls: [] }
    : { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: JSON.stringify({ query }) }] }
}

describe('keyless web research', () => {
  it('searches with Tavily and no key, browser, Authorization header, or extra model call', async () => {
    const calls: ResearchExchange[] = []
    const provider = new MockProvider()
    const { app, credentials } = makeApp({
      provider,
      lookupHost: publicLookup,
      browserOpener: async () => { throw new Error('browser should not launch') },
      researchTransport: async (exchange) => { calls.push(exchange); return reply(tavilyHit) }
    })
    try {
      credentials.set('research-tavily', 'tvly-test-secret-value')
      expect(app.getAppSettings().webResearch).toBe('automatic')
      searchHandler(provider)
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Find a public page about the weather.')
      expect(run.status).toBe('completed')
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://api.tavily.com/search')
      expect(calls[0].headers.Authorization).toBeUndefined()
      expect(calls[0].headers.Cookie).toBeUndefined()
      expect(calls[0].headers['X-Tavily-Access-Mode']).toBe('keyless')
      expect(JSON.parse(calls[0].body)).toMatchObject({ query: 'public weather', search_depth: 'basic' })
      expect(calls[0].body).not.toContain('tvly-test-secret-value')
      expect(provider.calls).toHaveLength(2)
      expect(provider.calls.every(call => call.model === 'mock-model')).toBe(true)
      const text = app.getSnapshot().current!.messages.find(item => item.toolName === 'web_search')!.content
      expect(text).toContain('Web search via Tavily')
      expect(text).toContain('https://example.com/')
      expect(text).toContain('not a Google ranking')
      expect(text).not.toContain('tvly-test-secret-value')
      expect(provider.calls.some(call => JSON.stringify(call.messages).includes('tvly-test-secret-value'))).toBe(false)
    } finally { await app.close() }
  })

  it('keeps an empty Tavily result and drops a private result URL', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    let mode: 'empty' | 'long' = 'empty'
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        if (mode === 'empty') return reply({ results: [] })
        return reply({ results: [{ title: 'Long', url: 'https://example.com/long', content: 'x'.repeat(900) }, { title: 'Bad', url: 'http://127.0.0.1/secret', content: 'no' }] })
      }
    })
    try {
      const id = app.getSnapshot().ongoingConversationId!
      searchHandler(provider, 'empty query')
      await app.sendMessage(id, 'Search for empty query')
      expect(calls).toEqual(['https://api.tavily.com/search'])
      expect(app.getSnapshot().current!.messages.find(item => item.toolName === 'web_search')!.content).toContain('No public results')
      mode = 'long'
      searchHandler(provider, 'long query')
      await app.sendMessage(id, 'Search for long query')
      const long = app.getSnapshot().current!.messages.filter(item => item.toolName === 'web_search').at(-1)!.content
      expect(long).toContain('[Truncated]')
      expect(long).toContain('https://example.com/long')
      expect(long).not.toContain('127.0.0.1')
      expect(calls).toHaveLength(2)
    } finally { await app.close() }
  })

  it('falls back once after a Tavily 429 and does not fan out on a valid empty result', async () => {
    const calls: ResearchExchange[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => {
        calls.push(exchange)
        if (exchange.url.includes('tavily')) return reply({ error: 'See https://evil.example/steal' }, 429, { 'retry-after': '30' })
        return reply(firecrawlHit)
      }
    })
    try {
      searchHandler(provider)
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Find a public page.')
      expect(run.status).toBe('completed')
      expect(calls.map(call => call.url)).toEqual(['https://api.tavily.com/search', 'https://api.firecrawl.dev/v2/search'])
      const text = app.getSnapshot().current!.messages.find(item => item.toolName === 'web_search')!.content
      expect(text).toContain('Web search via Firecrawl')
      expect(text).toContain('Tavily was unavailable')
      expect(text).not.toContain('evil.example')
      expect(text).not.toContain('429')
    } finally { await app.close() }
  })

  it('stops after both services fail and a repeat during cooldown makes no request', async () => {
    let now = Date.parse('2026-11-04T15:00:00Z')
    const calls: string[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      now: () => now,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => { calls.push(exchange.url); return reply({ error: 'https://evil.example/again' }, 503) }
    })
    try {
      const id = app.getSnapshot().ongoingConversationId!
      provider.handler = (input) => {
        const searches = input.messages.filter(message => message.role === 'tool' && message.name === 'web_search')
        if (searches.length >= 2) return { content: 'Stopped retrying.', toolCalls: [] }
        return { content: '', toolCalls: [{ id: `search-${searches.length}`, name: 'web_search', arguments: '{"query":"same question"}' }] }
      }
      const run = await app.sendMessage(id, 'Search the same question.')
      expect(run.status).toBe('completed')
      expect(calls).toEqual(['https://api.tavily.com/search', 'https://api.firecrawl.dev/v2/search'])
      const text = app.getSnapshot().current!.messages.filter(item => item.toolName === 'web_search').at(-1)!.content
      expect(text).toContain("didn't finish")
      expect(text).toContain('Settings → Web search')
      expect(text).not.toContain('evil.example')
      expect(text).not.toContain('503')
    } finally { await app.close() }
  })

  it('reads a normal page directly, rejects a verification screen, and still reads an article that mentions CAPTCHA', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    let page = 'article'
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      fetchImpl: async () => new Response(page === 'article'
        ? `${'This article explains how a CAPTCHA works in general. '.repeat(30)}The readable sentence is about the topic.`
        : page === 'direct'
          ? 'Example Domain is available for anyone to use in examples and documents.'
          : '<html>Just a moment. Please verify you are human.</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        return reply({ results: [{ url: 'https://example.com/story', raw_content: 'Extracted article text from the reading service.' }] })
      }
    })
    try {
      const id = app.getSnapshot().ongoingConversationId!
      const ask = (url: string) => {
        provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
          ? { content: 'Noted.', toolCalls: [] }
          : { content: '', toolCalls: [{ id: 'read', name: 'fetch_url', arguments: JSON.stringify({ url }) }] }
      }
      ask('https://example.com/article')
      await app.sendMessage(id, 'Read https://example.com/article')
      const article = app.getSnapshot().current!.messages.find(item => item.toolName === 'fetch_url')!.content
      expect(article).toContain('direct fetch')
      expect(article).toContain('CAPTCHA')
      expect(calls).toEqual([])
      page = 'direct'
      ask('https://example.com/')
      await app.sendMessage(id, 'Read https://example.com/')
      expect(app.getSnapshot().current!.messages.filter(item => item.toolName === 'fetch_url').at(-1)!.content).toContain('direct fetch')
      expect(calls).toEqual([])
      page = 'challenge'
      ask('https://example.com/blocked')
      await app.sendMessage(id, 'Read https://example.com/blocked')
      const extracted = app.getSnapshot().current!.messages.filter(item => item.toolName === 'fetch_url').at(-1)!.content
      expect(extracted).toContain('Read https://example.com/blocked via Tavily')
      expect(extracted).toContain('Extracted article text')
      expect(extracted).not.toContain('Just a moment')
      expect(calls).toEqual(['https://api.tavily.com/extract'])
    } finally { await app.close() }
  })

  it('does not send a private, signed, or provider-private address', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      lookupHost: async (host) => host.endsWith('tavily.com') || host.endsWith('firecrawl.dev') ? ['127.0.0.1'] : ['93.184.216.34'],
      fetchImpl: async () => new Response('missing', { status: 403 }),
      researchTransport: async (exchange) => { calls.push(exchange.url); return reply(tavilyHit) }
    })
    try {
      const id = app.getSnapshot().ongoingConversationId!
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
        ? { content: 'Done.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'bad', name: 'fetch_url', arguments: '{"url":"http://127.0.0.1/secret"}' }] }
      await app.sendMessage(id, 'Read the local page')
      expect(calls).toEqual([])
      expect(app.getSnapshot().current!.messages.some(item => item.toolName === 'fetch_url' && /private|not valid|blocked/i.test(item.content))).toBe(true)
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
        ? { content: 'Noted.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'signed', name: 'fetch_url', arguments: '{"url":"https://example.com/file?token=secret"}' }] }
      await app.sendMessage(id, 'Read https://example.com/file?token=secret')
      expect(app.getSnapshot().current!.messages.filter(item => item.toolName === 'fetch_url').at(-1)!.content).toContain('not sent to a reading service')
      expect(calls).toEqual([])
      searchHandler(provider, 'public weather')
      await app.sendMessage(id, 'Search for public weather')
      expect(calls).toEqual([])
      expect(app.getSnapshot().current!.messages.filter(item => item.toolName === 'web_search').at(-1)!.content).toContain('not contacted')
    } finally { await app.close() }
  })

  it('requires a separate approval for private context and for the fallback service', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        return reply({ error: 'down' }, exchange.url.includes('tavily') ? 503 : 200)
      }
    })
    const id = app.getSnapshot().ongoingConversationId!
    app.onEvent(event => { if (event.type === 'approval' && event.approval) app.resolveApproval(event.approval.id, false) })
    provider.handler = (input) => {
      const last = input.messages.at(-1)
      if (last?.role === 'tool' && last.name === 'list_memories') return { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"private follow up"}' }] }
      if (last?.role === 'tool') return { content: 'Done.', toolCalls: [] }
      return { content: '', toolCalls: [{ id: 'mem', name: 'list_memories', arguments: '{}' }] }
    }
    try {
      await app.sendMessage(id, 'What do you remember?')
      expect(calls).toEqual([])
      expect(app.getSnapshot().current!.messages.some(item => item.content.includes('was not approved'))).toBe(true)
    } finally { await app.close() }
  })

  it('allows the first service and refuses the fallback after the failure', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => { calls.push(exchange.url); return reply({}, 503) }
    })
    const id = app.getSnapshot().ongoingConversationId!
    let seen = 0
    app.onEvent(event => {
      if (event.type === 'approval' && event.approval) {
        seen += 1
        app.resolveApproval(event.approval.id, seen === 1)
      }
    })
    provider.handler = (input) => {
      const last = input.messages.at(-1)
      if (last?.role === 'tool' && last.name === 'list_memories') return { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"private follow up"}' }] }
      if (last?.role === 'tool') return { content: 'Done.', toolCalls: [] }
      return { content: '', toolCalls: [{ id: 'mem', name: 'list_memories', arguments: '{}' }] }
    }
    try {
      await app.sendMessage(id, 'What do you remember?')
      expect(calls).toEqual(['https://api.tavily.com/search'])
      expect(seen).toBe(2)
    } finally { await app.close() }
  })

  it('sends nothing when tools are turned off while access is waiting', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app } = makeApp({ provider, lookupHost: publicLookup, researchTransport: async (exchange) => { calls.push(exchange.url); return reply(tavilyHit) } })
    const id = app.getSnapshot().ongoingConversationId!
    app.onEvent(event => {
      if (event.type === 'approval' && event.approval) {
        app.updateSettings({ toolsEnabled: false })
        app.resolveApproval(event.approval.id, true)
      }
    })
    provider.handler = (input) => {
      const last = input.messages.at(-1)
      if (last?.role === 'tool' && last.name === 'list_memories') return { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"private follow up"}' }] }
      if (last?.role === 'tool') return { content: 'Done.', toolCalls: [] }
      return { content: '', toolCalls: [{ id: 'mem', name: 'list_memories', arguments: '{}' }] }
    }
    try {
      const run = await app.sendMessage(id, 'What do you remember?')
      expect(calls).toEqual([])
      expect(run.status).toBe('paused')
    } finally { await app.close() }
  })

  it('drops a late provider success when Stop arrives during the request', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    let appStop: (() => void) | null = null
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        appStop?.()
        return reply({ results: [{ title: 'Late', url: 'https://example.com/late', content: 'LATE_SNIPPET' }] })
      }
    })
    appStop = () => app.stop()
    searchHandler(provider)
    try {
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search for a public page.')
      expect(calls).toEqual(['https://api.tavily.com/search'])
      expect(run.status).toBe('stopped')
      expect(JSON.stringify(app.getSnapshot().current!.messages)).not.toContain('LATE_SNIPPET')
    } finally { await app.close() }
  })

  it('keeps a saved key out of keyless calls and off the wrong host', async () => {
    const calls: ResearchExchange[] = []
    const provider = new MockProvider()
    const credentials = new MemoryCredentialStore({ encryptionAvailable: true })
    let accountMode = false
    const { app } = makeApp({
      provider,
      credentials,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => {
        calls.push(exchange)
        if (!accountMode || !exchange.url.includes('tavily')) return reply(exchange.url.includes('firecrawl') ? firecrawlHit : tavilyHit)
        return reply({}, 503)
      }
    })
    try {
      const saved = app.setResearchKey('tavily', 'tvly-test-secret-value')
      app.setResearchKey('firecrawl', 'fc-test-secret-value')
      app.setCredential('openai', 'sk-openai-test-value')
      expect(saved.persistent).toBe(true)
      expect(app.getAppSettings().webResearch).toBe('automatic')
      searchHandler(provider, 'keyless query')
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search for keyless query')
      expect(calls[0].headers.Authorization).toBeUndefined()
      expect(calls[0].headers['X-Tavily-Access-Mode']).toBe('keyless')
      accountMode = true
      app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchFirecrawl: true, researchDailyCap: 5 })
      calls.length = 0
      searchHandler(provider, 'account query')
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search for account query')
      expect(calls[0].url).toContain('tavily.com')
      expect(calls[0].headers.Authorization).toBe('Bearer tvly-test-secret-value')
      expect(calls[0].headers['X-Tavily-Access-Mode']).toBeUndefined()
      expect(calls[1].url).toContain('firecrawl.dev')
      expect(calls[1].headers.Authorization).toBe('Bearer fc-test-secret-value')
      expect(calls[1].headers.Authorization).not.toContain('tvly')
      const status = app.clearResearchKey('tavily')
      expect(status.tavilyConfigured).toBe(false)
      expect(status.firecrawlConfigured).toBe(true)
      expect(status.openaiConfigured).toBe(true)
      expect(JSON.stringify(app.getSnapshot())).not.toContain('tvly-test-secret-value')
    } finally { await app.close() }
  })

  it('does not let concurrent account reservations pass a one-request cap', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app, dbPath } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => { calls.push(exchange.url); return reply(tavilyHit) }
    })
    const database = new Database(dbPath)
    const other = new Database(dbPath)
    try {
      app.setResearchKey('tavily', 'tvly-test-secret-value')
      app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchDailyCap: 1 })
      const day = localDay(Date.now())
      const results = await Promise.all([database.reserveResearchUse('account', day, 1), other.reserveResearchUse('account', day, 1)])
      expect(results.filter(Boolean)).toHaveLength(1)
      searchHandler(provider, 'account query')
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search for account query')
      expect(calls).toEqual([])
      expect(app.getSnapshot().current!.messages.find(item => item.toolName === 'web_search')!.content).toContain('daily request cap')
    } finally {
      database.close()
      other.close()
      await app.close()
    }
  })

  it('uses the browser for an explicit Google search and keeps a custom template on migration', async () => {
    const calls: string[] = []
    const navigations: string[] = []
    const page: LaunchedPage = {
      url: () => navigations.at(-1) ?? 'about:blank',
      title: async () => 'Google',
      goto: async (url) => { navigations.push(url) },
      back: async () => undefined,
      close: async () => undefined,
      text: async () => 'Google Search results',
      links: async () => [],
      html: async () => '',
      observe: async () => [],
      press: async () => undefined,
      typeInto: async () => undefined,
      scroll: async () => undefined,
      googleResults: async () => [{ title: 'List of Angels', url: 'https://angelicpedia.com/', snippet: 'Observed.' }]
    }
    const opener: BrowserOpener = async () => ({ name: 'Google Chrome', pages: () => [page], current: () => page, select: () => undefined, openPage: async () => page, close: async () => undefined })
    const provider = new MockProvider()
    const { app, dbPath } = makeApp({ provider, browserOpener: opener, lookupHost: publicLookup, researchTransport: async (exchange) => { calls.push(exchange.url); return reply(tavilyHit) } })
    try {
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
        ? { content: 'The first observed result is Angelicpedia.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com","engine":"google"}' }] }
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Look up angelicpedia.com')
      expect(run.status).toBe('completed')
      expect(calls).toEqual([])
      expect(new URL(navigations[0]).hostname).toBe('www.google.com')
      expect(app.getSnapshot().current!.messages.find(item => item.toolName === 'web_search')!.content).toContain('Search engine: Google')
    } finally { await app.close() }
    const raw = openDatabase(dbPath)
    const botId = (raw.prepare('SELECT id FROM bots').get() as { id: string }).id
    raw.prepare(`UPDATE bots SET settings_json = json_set(settings_json, '$.searchUrlTemplate', ?) WHERE id = ?`).run('https://example.com/search?q={query}', botId)
    const appRow = raw.prepare(`SELECT value FROM settings WHERE key = 'app'`).get() as { value: string }
    const stored = JSON.parse(appRow.value) as Record<string, unknown>
    delete stored.webResearch
    raw.prepare(`UPDATE settings SET value = ? WHERE key = 'app'`).run(JSON.stringify(stored))
    raw.exec('PRAGMA user_version = 14')
    raw.close()
    const restarted = new Database(dbPath)
    try {
      restarted.migrate()
      expect(restarted.appConfig().webResearch).toBe('browser')
      expect(restarted.getSettings().searchUrlTemplate).toBe('https://example.com/search?q={query}')
    } finally { restarted.close() }
  })

  it('runs scheduled work with the owning bot’s tools off even if another bot is selected', async () => {
    const calls: string[] = []
    let now = Date.parse('2026-11-03T08:59:30-05:00')
    const dir = tempDir()
    const provider = new MockProvider()
    const app = new RiotService({
      dbPath: path.join(dir, 'riot.sqlite'),
      workspaceRoot: path.join(dir, 'workspaces'),
      provider,
      credentials: new MemoryCredentialStore(),
      now: () => now,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => { calls.push(exchange.url); return reply(tavilyHit) }
    })
    app.boot()
    try {
      app.updateSettings({ model: 'owner-model', toolsEnabled: false, autoMemory: false, autoSkillSuggestions: false })
      app.saveSchedule({ kind: 'task', title: 'Weather', instructions: 'Search the public weather.', startAt: '2026-11-03T09:00:00-05:00', repeat: 'once', timezone: 'America/New_York' })
      await app.createBot({ name: 'Other', purpose: 'Separate', provider: 'openai', model: 'selected-model', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#445566' })
      app.updateSettings({ toolsEnabled: true, model: 'selected-model' })
      provider.handler = (input) => {
        if (input.tools?.some(tool => tool.name === 'web_search')) return { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"weather"}' }] }
        return { content: 'Done.', toolCalls: [] }
      }
      now += 60_000
      app.checkSchedules()
      await waitFor(() => app.listJobs('app').some(job => job.status === 'completed' || job.status === 'paused' || job.status === 'failed'))
      expect(calls).toEqual([])
      expect(provider.calls.at(-1)?.model).toBe('owner-model')
    } finally { await app.close() }
  })

  it('does not send a generated address to a reading service without approval', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      fetchImpl: async () => new Response('no', { status: 403 }),
      researchTransport: async (exchange) => { calls.push(exchange.url); return reply({ results: [{ url: 'https://example.com/generated', raw_content: 'should not be used' }] }) }
    })
    let step = 0
    app.onEvent(event => {
      if (event.type === 'approval' && event.approval) {
        step += 1
        app.resolveApproval(event.approval.id, step === 1)
      }
    })
    provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
      ? { content: 'Done.', toolCalls: [] }
      : { content: '', toolCalls: [{ id: 'read', name: 'fetch_url', arguments: '{"url":"https://example.com/generated"}' }] }
    try {
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Read the page it found')
      expect(calls).toEqual([])
      expect(step).toBe(2)
      expect(app.getSnapshot().current!.messages.some(item => item.content.includes('was not approved'))).toBe(true)
    } finally { await app.close() }
  })

  it('asks before sending a link seen only in the bot’s browser to a reading service', async () => {
    const shared = 'https://portal.example.com/share/private-token-123'
    const navigations: string[] = []
    const page: LaunchedPage = {
      url: () => navigations.at(-1) ?? 'about:blank',
      title: async () => 'Portal',
      goto: async (url) => { navigations.push(url) },
      back: async () => undefined,
      close: async () => undefined,
      text: async () => 'Signed-in dashboard.',
      links: async () => [{ text: 'Shared report', href: shared }],
      html: async () => '',
      observe: async () => [],
      press: async () => undefined,
      typeInto: async () => undefined,
      scroll: async () => undefined,
      googleResults: async () => []
    }
    const opener: BrowserOpener = async () => ({ name: 'Google Chrome', pages: () => [page], current: () => page, select: () => undefined, openPage: async () => page, close: async () => undefined })
    const calls: ResearchExchange[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      browserOpener: opener,
      lookupHost: publicLookup,
      fetchImpl: async () => new Response('no', { status: 403 }),
      researchTransport: async (exchange) => { calls.push(exchange); return reply({ results: [{ url: shared, raw_content: 'Report text from the reading service.' }] }) }
    })
    const cards: string[] = []
    let approve = false
    app.onEvent(event => {
      if (event.type === 'approval' && event.approval) {
        cards.push(event.approval.command)
        app.resolveApproval(event.approval.id, approve)
      }
    })
    const script = () => {
      let step = 0
      provider.handler = () => {
        step += 1
        if (step === 1) return { content: '', toolCalls: [{ id: 'open', name: 'open_url', arguments: JSON.stringify({ url: 'https://portal.example.com/dashboard' }) }] }
        if (step === 2) return { content: '', toolCalls: [{ id: 'read', name: 'read_page', arguments: '{}' }] }
        if (step === 3) return { content: '', toolCalls: [{ id: 'fetch', name: 'fetch_url', arguments: JSON.stringify({ url: shared }) }] }
        return { content: 'Done.', toolCalls: [] }
      }
    }
    try {
      const id = app.getSnapshot().ongoingConversationId!
      script()
      await app.sendMessage(id, 'Open https://portal.example.com/dashboard and read the shared report')
      expect(calls).toEqual([])
      expect(cards).toHaveLength(1)
      expect(cards[0]).toContain('api.tavily.com')
      expect(cards[0]).toContain('bot’s browser')
      expect(app.getSnapshot().current!.messages.some(item => item.content.includes('was not approved'))).toBe(true)

      approve = true
      resetResearchState()
      script()
      await app.sendMessage(id, 'Open https://portal.example.com/dashboard and read the shared report')
      expect(calls.map(item => item.url)).toEqual(['https://api.tavily.com/extract'])
      expect(JSON.parse(calls[0]!.body)).toEqual({ urls: [shared] })
      expect(app.getSnapshot().current!.messages.filter(item => item.toolName === 'fetch_url').at(-1)!.content).toContain('Report text from the reading service.')
    } finally { await app.close() }
  })

  it('fills the shared attempt cap and then makes no further request', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app, dbPath } = makeApp({ provider, lookupHost: publicLookup, researchTransport: async (exchange) => { calls.push(exchange.url); return reply(tavilyHit) } })
    const database = new Database(dbPath)
    const botId = app.getSnapshot().bot!.id
    try {
      for (let count = 0; count < RESEARCH_ATTEMPT_LIMIT; count += 1) expect(database.reserveResearchUse(`bot:${botId}`, localDay(Date.now()), RESEARCH_ATTEMPT_LIMIT)).toBe(true)
      searchHandler(provider)
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search once more')
      expect(calls).toEqual([])
      expect(app.getSnapshot().current!.messages.find(item => item.toolName === 'web_search')!.content).toContain('daily web request limit')
    } finally {
      database.close()
      await app.close()
    }
  })
})

const awsSigned = 'https://example.com/download?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=SYNTHETIC&X-Amz-Signature=synthetic-proof'
const googleSigned = 'https://storage.googleapis.com/bucket/object?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=synthetic&X-Goog-Signature=syntheticproof'
const harmlessUrl = 'https://example.com/guide?q=weather&page=2&utm_source=newsletter'
const walmartHtml = '<html><h1>Robot or human?</h1><p>Activate and hold the button to confirm that you are human. Thank You!</p><button>PRESS &amp; HOLD</button><p>Please try again</p></html>'

function storedTool(dbPath: string, toolName: string): string {
  const database = openDatabase(dbPath)
  try {
    const rows = database.prepare(`SELECT content FROM messages WHERE tool_name = ? ORDER BY rowid`).all(toolName) as { content: string }[]
    return rows.map((row) => row.content).join('\n')
  } finally { database.close() }
}

function usageCount(dbPath: string, scope: string): number {
  const database = openDatabase(dbPath)
  try {
    const found = database.prepare(`SELECT "count" AS total FROM research_usage WHERE scope = ?`).get(scope) as { total: number } | undefined
    return found ? Number(found.total) : 0
  } finally { database.close() }
}

describe('research authority, reading, and caps', () => {
  const revocations = [
    ['tools off', 1, 'tools'],
    ['tools off', 2, 'tools'],
    ['key removed', 1, 'key'],
    ['key removed', 2, 'key'],
    ['provider deselected', 1, 'provider'],
    ['provider deselected', 2, 'provider'],
    ['mode changed to the browser', 1, 'browser'],
    ['mode changed to the browser', 2, 'browser'],
    ['mode changed to a saved connection', 1, 'connection'],
    ['mode changed to a saved connection', 2, 'connection'],
    ['grant revoked', 1, 'grant'],
    ['grant revoked', 2, 'grant'],
    ['limit lowered', 1, 'limit'],
    ['limit lowered', 2, 'limit']
  ] as const

  it.each(revocations)('%s during DNS lookup %i makes no provider request', async (_label, phase, action) => {
    let seen = 0
    const calls: ResearchExchange[] = []
    let approvals = 0
    const provider = new MockProvider()
    const { app, dbPath } = makeApp({
      provider,
      lookupHost: async (host) => {
        if (host === 'api.tavily.com') {
          seen += 1
          if (seen === phase) {
            if (action === 'tools') app.updateSettings({ toolsEnabled: false })
            if (action === 'key') app.clearResearchKey('tavily')
            if (action === 'provider') app.updateAppSettings({ researchTavily: false })
            if (action === 'browser') app.updateAppSettings({ webResearch: 'browser' })
            if (action === 'connection') app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchFirecrawl: true })
            if (action === 'grant') app.updateSettings({ trustedSites: [] })
            if (action === 'limit') app.updateAppSettings({ researchDailyCap: 1 })
          }
        }
        return ['93.184.216.34']
      },
      researchTransport: async (exchange) => {
        calls.push(exchange)
        return reply(exchange.url.includes('firecrawl') ? firecrawlHit : tavilyHit)
      }
    })
    const database = new Database(dbPath)
    try {
      app.onEvent((event) => { if (event.type === 'approval' && event.approval) { approvals += 1; app.resolveApproval(event.approval.id, false) } })
      if (action === 'key' || action === 'provider' || action === 'limit' || action === 'connection') {
        app.setResearchKey('tavily', 'tvly-synthetic-revoked-key')
        app.setResearchKey('firecrawl', 'fc-synthetic-revoked-key')
      }
      if (action === 'key' || action === 'provider' || action === 'limit') {
        app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchFirecrawl: true, researchDailyCap: 100 })
      }
      if (action === 'limit') database.reserveResearchUse('account', localDay(Date.now()), 100)
      if (action === 'grant') {
        app.updateSettings({ trustedSites: ['https://api.tavily.com'] })
        provider.handler = (input) => {
          const last = input.messages.at(-1)
          if (last?.role === 'tool' && last.name === 'list_memories') return { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"private follow up"}' }] }
          if (last?.role === 'tool') return { content: 'Done.', toolCalls: [] }
          return { content: '', toolCalls: [{ id: 'mem', name: 'list_memories', arguments: '{}' }] }
        }
      } else searchHandler(provider)
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Find a public example.')
      expect(calls).toEqual([])
      expect(approvals).toBe(0)
      expect(JSON.stringify(app.getSnapshot())).not.toContain('tvly-synthetic-revoked-key')
      if (action === 'tools' || action === 'browser') expect(run.status).toBe('paused')
      else {
        expect(run.status).toBe('completed')
        const text = app.getSnapshot().current!.messages.filter((item) => item.toolName === 'web_search').at(-1)?.content ?? ''
        expect(text).toContain(action === 'limit' ? 'daily request cap' : 'Nothing was sent')
        expect(text).not.toContain('Web search via')
      }
      if (action === 'limit') {
        expect(usageCount(dbPath, 'account')).toBe(1)
        expect(usageCount(dbPath, `bot:${app.getSnapshot().bot!.id}`)).toBe(0)
      }
    } finally {
      database.close()
      await app.close()
    }
  })

  it('does not submit AWS or Google signed URLs to either extractor, including the fallback path', async () => {
    const calls: ResearchExchange[] = []
    const fetched: string[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      fetchImpl: async (url) => { fetched.push(String(url)); return new Response('Blocked', { status: 403 }) },
      researchTransport: async (exchange) => { calls.push(exchange); return reply(exchange.url.includes('firecrawl') ? { success: true, data: { markdown: 'should not be used', metadata: { url: harmlessUrl } } } : { results: [{ url: harmlessUrl, raw_content: 'should not be used' }] }) }
    })
    try {
      const id = app.getSnapshot().ongoingConversationId!
      for (const url of [awsSigned, googleSigned]) {
        provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
          ? { content: 'Noted.', toolCalls: [] }
          : { content: '', toolCalls: [{ id: 'read', name: 'fetch_url', arguments: JSON.stringify({ url }) }] }
        await app.sendMessage(id, `Read ${url}`)
        const text = app.getSnapshot().current!.messages.filter((item) => item.toolName === 'fetch_url').at(-1)!.content
        expect(text).toContain('not sent to a reading service')
        expect(text).not.toContain('should not be used')
      }
      expect(fetched.length).toBeGreaterThan(0)
      expect(calls).toEqual([])
      app.setResearchKey('tavily', 'tvly-synthetic-signed-key')
      app.setResearchKey('firecrawl', 'fc-synthetic-signed-key')
      app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchFirecrawl: true, researchDailyCap: 20 })
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
        ? { content: 'Noted.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'read', name: 'fetch_url', arguments: JSON.stringify({ url: googleSigned }) }] }
      await app.sendMessage(id, `Read ${googleSigned}`)
      expect(calls).toEqual([])
      expect(JSON.stringify(app.getSnapshot())).not.toContain('tvly-synthetic-signed-key')
      app.updateAppSettings({ webResearch: 'automatic' })
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
        ? { content: 'Noted.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'read', name: 'fetch_url', arguments: JSON.stringify({ url: harmlessUrl }) }] }
      await app.sendMessage(id, `Read ${harmlessUrl}`)
      expect(calls.map((call) => call.url)).toEqual(['https://api.tavily.com/extract'])
      expect(calls[0].body).toContain(harmlessUrl)
      expect(calls[0].body).not.toContain('X-Amz-')
      expect(calls[0].body).not.toContain('X-Goog-')
      expect(app.getSnapshot().current!.messages.filter((item) => item.toolName === 'fetch_url').at(-1)!.content).toContain('should not be used')
    } finally { await app.close() }
  })

  it('drops signed result links and keeps an ordinary query string', async () => {
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async () => reply({ results: [
        { title: 'Guide', url: harmlessUrl, content: 'A normal public guide.' },
        { title: 'Signed', url: awsSigned, content: 'SECRET_SIGNED_SNIPPET' },
        { title: 'Cloud', url: googleSigned, content: 'SECRET_GOOGLE_SNIPPET' }
      ] })
    })
    try {
      searchHandler(provider, 'public guide')
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search for a public guide')
      const text = app.getSnapshot().current!.messages.find((item) => item.toolName === 'web_search')!.content
      expect(text).toContain(harmlessUrl)
      expect(text).toContain('A normal public guide.')
      expect(text).not.toContain('SECRET_SIGNED_SNIPPET')
      expect(text).not.toContain('SECRET_GOOGLE_SNIPPET')
      expect(text).not.toContain('X-Amz-')
      expect(text).not.toContain('X-Goog-')
    } finally { await app.close() }
  })

  it('treats a provider deadline as one fallback and discards a late primary response', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        if (exchange.url.includes('tavily')) {
          await new Promise((resolve) => setTimeout(resolve, 1300))
          return reply({ results: [{ title: 'Late', url: 'https://example.com/late', content: 'LATE_TAVILY_SNIPPET' }] })
        }
        return reply(firecrawlHit)
      }
    })
    try {
      app.updateSettings({ webFetchTimeoutMs: 1000 })
      searchHandler(provider)
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Find a public page.')
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(run.status).toBe('completed')
      expect(calls).toEqual(['https://api.tavily.com/search', 'https://api.firecrawl.dev/v2/search'])
      const text = app.getSnapshot().current!.messages.find((item) => item.toolName === 'web_search')!.content
      expect(text).toContain('Web search via Firecrawl')
      expect(text).not.toContain('LATE_TAVILY_SNIPPET')
      expect(JSON.stringify(app.getSnapshot().current!.messages)).not.toContain('LATE_TAVILY_SNIPPET')
    } finally { await app.close() }
  }, 15000)

  it('treats an aborted provider request as a fallback and Stop as a cancellation', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    let mode: 'deadline' | 'stop' = 'deadline'
    let appStop: (() => void) | null = null
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        if (exchange.url.includes('tavily')) {
          await new Promise((_resolve, reject) => {
            exchange.signal.addEventListener('abort', () => reject(new Error('Request aborted at the service deadline')), { once: true })
          })
        }
        if (mode === 'stop') {
          appStop?.()
          return reply({ success: true, data: { web: [{ title: 'Late', url: 'https://example.com/late', description: 'LATE_FIRECRAWL' }] } })
        }
        return reply(firecrawlHit)
      }
    })
    appStop = () => app.stop()
    try {
      app.updateSettings({ webFetchTimeoutMs: 1000 })
      searchHandler(provider, 'deadline query')
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Find a deadline query.')
      expect(run.status).toBe('completed')
      expect(calls).toEqual(['https://api.tavily.com/search', 'https://api.firecrawl.dev/v2/search'])
      expect(app.getSnapshot().current!.messages.find((item) => item.toolName === 'web_search')!.content).toContain('Firecrawl')
      resetResearchState()
      mode = 'stop'
      calls.length = 0
      searchHandler(provider, 'stop query')
      const stopped = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Find a stop query.')
      expect(stopped.status).toBe('stopped')
      expect(calls).toEqual(['https://api.tavily.com/search', 'https://api.firecrawl.dev/v2/search'])
      expect(JSON.stringify(app.getSnapshot().current!.messages)).not.toContain('LATE_FIRECRAWL')
    } finally { await app.close() }
  }, 15000)

  it('extracts an oversized public page within bounds and does not treat a verification screen as the article', async () => {
    const calls: ResearchExchange[] = []
    const provider = new MockProvider()
    let page: 'over' | 'walmart' | 'challenge' = 'over'
    const { app, dbPath } = makeApp({
      provider,
      lookupHost: publicLookup,
      fetchImpl: async () => page === 'over'
        ? new Response('x'.repeat(600_000), { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response(walmartHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
      researchTransport: async (exchange) => {
        calls.push(exchange)
        if (page === 'challenge') return reply(exchange.url.includes('firecrawl')
          ? { success: true, data: { markdown: 'Robot or human? Activate and hold. PRESS & HOLD', metadata: { sourceURL: 'https://example.com/challenge', url: 'https://example.com/challenge' } } }
          : { results: [{ url: 'https://example.com/challenge', raw_content: 'Robot or human? Activate and hold the button. PRESS & HOLD' }] })
        return reply({ results: [{ url: 'https://example.com/product', raw_content: `${'Usable product details. '.repeat(20)}${'y'.repeat(20_000)}` }] })
      }
    })
    try {
      const id = app.getSnapshot().ongoingConversationId!
      const ask = (url: string) => {
        provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
          ? { content: 'Noted.', toolCalls: [] }
          : { content: '', toolCalls: [{ id: 'read', name: 'fetch_url', arguments: JSON.stringify({ url }) }] }
      }
      ask('https://example.com/product')
      await app.sendMessage(id, 'Read https://example.com/product')
      const oversized = app.getSnapshot().current!.messages.find((item) => item.toolName === 'fetch_url')!.content
      const stored = storedTool(dbPath, 'fetch_url')
      expect(calls.map((call) => call.url)).toEqual(['https://api.tavily.com/extract'])
      expect(calls[0].body).toContain('https://example.com/product')
      expect(stored).toContain('Usable product details.')
      expect(stored).toContain('[Truncated]')
      expect(stored.length).toBeLessThan(16_000)
      expect(stored).not.toContain('x'.repeat(1000))
      expect(stored).not.toContain('y'.repeat(13_000))
      expect(oversized).not.toContain('x'.repeat(1000))
      expect(oversized).not.toContain('byte limit')
      page = 'walmart'
      calls.length = 0
      ask('https://example.com/challenge')
      await app.sendMessage(id, 'Read https://example.com/challenge')
      const article = app.getSnapshot().current!.messages.filter((item) => item.toolName === 'fetch_url').at(-1)!.content
      expect(calls.map((call) => call.url)).toEqual(['https://api.tavily.com/extract'])
      expect(article).toContain('Usable product details.')
      expect(article).not.toContain('Robot or human?')
      expect(article).not.toContain('PRESS & HOLD')
      expect(article).not.toContain('Activate and hold')
      page = 'challenge'
      calls.length = 0
      let reads = 0
      provider.handler = (input) => {
        if (input.messages.at(-1)?.role === 'tool') reads += 1
        if (reads >= 2) return { content: 'Noted.', toolCalls: [] }
        return { content: '', toolCalls: [{ id: `read-${reads}`, name: 'fetch_url', arguments: JSON.stringify({ url: 'https://example.com/hold' }) }] }
      }
      await app.sendMessage(id, 'Read https://example.com/hold')
      const failed = app.getSnapshot().current!.messages.filter((item) => item.toolName === 'fetch_url').map((item) => item.content).join('\n')
      expect(calls.map((call) => call.url)).toEqual(['https://api.tavily.com/extract', 'https://api.firecrawl.dev/v2/scrape'])
      expect(failed).toContain('could not be read')
      expect(failed).not.toContain('Robot or human?')
      expect(failed).not.toContain('PRESS & HOLD')
      expect(failed).not.toContain('Activate and hold')
    } finally { await app.close() }
  })

  it('rejects private, malformed, and signed extraction destinations without relabeling them', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    let mode = 'private'
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      fetchImpl: async () => new Response('no', { status: 403 }),
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        if (exchange.url.includes('tavily')) {
          if (mode === 'private') return reply({ results: [{ url: 'http://127.0.0.1/private-admin', raw_content: 'UNVERIFIED_PRIVATE_FINAL_SENTINEL' }] })
          if (mode === 'malformed') return reply({ results: [{ url: 'not a url', raw_content: 'MALFORMED_SENTINEL' }] })
          if (mode === 'signed') return reply({ results: [{ url: awsSigned, raw_content: 'SIGNED_DESTINATION_SENTINEL' }] })
          if (mode === 'mixed') return reply({ results: [{ url: 'http://127.0.0.1/private-admin', raw_content: 'UNVERIFIED_PRIVATE_FINAL_SENTINEL' }, { url: 'https://example.com/article', raw_content: 'Public paragraph from the article.' }] })
          if (mode === 'omitted') return reply({ results: [{ raw_content: 'Unlabelled public paragraph.' }] })
          if (mode === 'valid') return reply({ results: [{ url: 'https://example.com/article', raw_content: 'Confirmed public paragraph.' }] })
          return reply({ error: 'down' }, 503)
        }
        if (mode === 'firecrawl-private') return reply({ success: true, data: { markdown: 'LAUNDERED_SOURCE', metadata: { url: 'https://example.com/article', sourceURL: 'http://192.168.0.8/admin' } } })
        if (mode === 'firecrawl-omitted') return reply({ success: true, data: { markdown: 'Firecrawl paragraph without a final address.' } })
        if (mode === 'firecrawl-valid') return reply({ success: true, data: { markdown: 'Firecrawl confirmed paragraph.', metadata: { sourceURL: 'https://example.com/article', url: 'https://example.com/article' } } })
        return reply({ success: true, data: { markdown: 'SECOND_SENTINEL', metadata: { url: 'http://127.0.0.1/private-admin' } } })
      }
    })
    try {
      const id = app.getSnapshot().ongoingConversationId!
      const read = async (url: string) => {
        resetResearchState()
        provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
          ? { content: 'Noted.', toolCalls: [] }
          : { content: '', toolCalls: [{ id: 'read', name: 'fetch_url', arguments: JSON.stringify({ url }) }] }
        await app.sendMessage(id, `Read ${url}`)
        return app.getSnapshot().current!.messages.filter((item) => item.toolName === 'fetch_url').at(-1)!.content
      }
      let text = await read('https://example.com/article')
      expect(text).not.toContain('UNVERIFIED_PRIVATE_FINAL_SENTINEL')
      expect(text).not.toContain('SECOND_SENTINEL')
      expect(text).not.toContain('Final address:')
      expect(text).not.toContain('127.0.0.1')
      mode = 'malformed'
      text = await read('https://example.com/malformed')
      expect(text).not.toContain('MALFORMED_SENTINEL')
      mode = 'signed'
      text = await read('https://example.com/signed-destination')
      expect(text).not.toContain('SIGNED_DESTINATION_SENTINEL')
      expect(text).not.toContain('X-Amz-Signature')
      mode = 'mixed'
      text = await read('https://example.com/mixed')
      expect(text).toContain('Public paragraph from the article.')
      expect(text).not.toContain('UNVERIFIED_PRIVATE_FINAL_SENTINEL')
      expect(text).not.toContain('127.0.0.1')
      expect(text).toContain('https://example.com/article')
      mode = 'omitted'
      text = await read('https://example.com/omitted')
      expect(text).toContain('Unlabelled public paragraph.')
      expect(text).toContain('did not report')
      expect(text).not.toContain('Final address:')
      mode = 'valid'
      text = await read('https://example.com/valid')
      expect(text).toContain('Confirmed public paragraph.')
      expect(text).toContain('extracted from https://example.com/article')
      mode = 'firecrawl-private'
      text = await read('https://example.com/firecrawl-private')
      expect(text).not.toContain('LAUNDERED_SOURCE')
      expect(text).not.toContain('192.168.0.8')
      mode = 'firecrawl-omitted'
      text = await read('https://example.com/firecrawl-omitted')
      expect(text).toContain('Firecrawl paragraph without a final address.')
      expect(text).toContain('did not report a source or final address')
      mode = 'firecrawl-valid'
      text = await read('https://example.com/firecrawl-valid')
      expect(text).toContain('Firecrawl confirmed paragraph.')
      expect(text).toContain('reported the final address as https://example.com/article')
      expect(text).toContain('did not follow')
      expect(calls.length).toBeGreaterThan(0)
    } finally { await app.close() }
  })

  it('enforces the bot cap in account mode without spending the other counter', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app, dbPath } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        if (exchange.url.includes('tavily')) return reply({ error: 'down' }, 503)
        return reply(firecrawlHit)
      }
    })
    const database = new Database(dbPath)
    const botId = app.getSnapshot().bot!.id
    try {
      app.setResearchKey('tavily', 'tvly-synthetic-account-key')
      app.setResearchKey('firecrawl', 'fc-synthetic-account-key')
      app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchFirecrawl: true, researchDailyCap: 100 })
      for (let count = 0; count < RESEARCH_ATTEMPT_LIMIT; count += 1) expect(database.reserveResearchUse(`bot:${botId}`, localDay(Date.now()), RESEARCH_ATTEMPT_LIMIT)).toBe(true)
      searchHandler(provider, 'capped query')
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search for capped query')
      expect(calls).toEqual([])
      expect(app.getSnapshot().current!.messages.find((item) => item.toolName === 'web_search')!.content).toContain('daily web request limit')
      expect(usageCount(dbPath, 'account')).toBe(0)
      expect(usageCount(dbPath, `bot:${botId}`)).toBe(RESEARCH_ATTEMPT_LIMIT)
      expect(database.reserveResearchUse('account', localDay(Date.now()), 100)).toBe(true)
      app.updateAppSettings({ researchDailyCap: 1 })
      calls.length = 0
      const fresh = openDatabase(dbPath)
      fresh.prepare(`DELETE FROM research_usage WHERE scope = ?`).run(`bot:${botId}`)
      fresh.close()
      searchHandler(provider, 'account capped')
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search for account capped')
      expect(calls).toEqual([])
      expect(app.getSnapshot().current!.messages.filter((item) => item.toolName === 'web_search').at(-1)!.content).toContain('daily request cap')
      expect(usageCount(dbPath, `bot:${botId}`)).toBe(0)
      expect(usageCount(dbPath, 'account')).toBe(1)
    } finally {
      database.close()
      await app.close()
    }
  })

  it('counts a fallback toward both caps and lets only one concurrent reservation win', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app, dbPath } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        if (exchange.url.includes('tavily')) return reply({ error: 'down' }, 503)
        return reply(firecrawlHit)
      }
    })
    const database = new Database(dbPath)
    const other = new Database(dbPath)
    const botId = app.getSnapshot().bot!.id
    const day = localDay(Date.now())
    try {
      app.setResearchKey('tavily', 'tvly-synthetic-account-key')
      app.setResearchKey('firecrawl', 'fc-synthetic-account-key')
      app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchFirecrawl: true, researchDailyCap: 20 })
      for (let count = 0; count < 38; count += 1) expect(database.reserveResearchUse(`bot:${botId}`, day, RESEARCH_ATTEMPT_LIMIT)).toBe(true)
      searchHandler(provider, 'fallback query')
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search for fallback query')
      expect(calls).toEqual(['https://api.tavily.com/search', 'https://api.firecrawl.dev/v2/search'])
      expect(usageCount(dbPath, `bot:${botId}`)).toBe(40)
      expect(usageCount(dbPath, 'account')).toBe(2)
      calls.length = 0
      searchHandler(provider, 'after cap')
      await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search after cap')
      expect(calls).toEqual([])
      expect(usageCount(dbPath, 'account')).toBe(2)
      const entries = [{ scope: `bot:race-${botId}`, limit: 1 }, { scope: 'account-race', limit: 1 }]
      const raced = await Promise.all([database.reserveResearchUses(entries, day), other.reserveResearchUses(entries, day)])
      expect(raced.filter((item) => item === true)).toHaveLength(1)
      expect(raced.some((item) => item !== true)).toBe(true)
      expect(usageCount(dbPath, `bot:race-${botId}`)).toBe(1)
      expect(usageCount(dbPath, 'account-race')).toBe(1)
      expect(usageCount(dbPath, `bot:${botId}`)).toBe(40)
      expect(usageCount(dbPath, 'account')).toBe(2)
    } finally {
      database.close()
      other.close()
      await app.close()
    }
  })

  it('does not send a key removed while access is waiting', async () => {
    const calls: ResearchExchange[] = []
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => { calls.push(exchange); return reply(tavilyHit) }
    })
    try {
      app.setResearchKey('tavily', 'tvly-synthetic-waiting-key')
      app.setResearchKey('firecrawl', 'fc-synthetic-waiting-key')
      app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchFirecrawl: true, researchDailyCap: 20 })
      app.onEvent((event) => {
        if (event.type === 'approval' && event.approval) {
          app.clearResearchKey('tavily')
          app.resolveApproval(event.approval.id, true)
        }
      })
      provider.handler = (input) => {
        const last = input.messages.at(-1)
        if (last?.role === 'tool' && last.name === 'list_memories') return { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"private follow up"}' }] }
        if (last?.role === 'tool') return { content: 'Done.', toolCalls: [] }
        return { content: '', toolCalls: [{ id: 'mem', name: 'list_memories', arguments: '{}' }] }
      }
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'What do you remember?')
      expect(run.status).toBe('completed')
      expect(calls).toEqual([])
      const text = app.getSnapshot().current!.messages.filter((item) => item.toolName === 'web_search').at(-1)?.content ?? ''
      expect(text).toContain('saved key was removed')
      expect(text).toContain('Nothing was sent')
      expect(JSON.stringify(app.getSnapshot())).not.toContain('tvly-synthetic-waiting-key')
      expect(app.getSnapshot().credentials.tavilyConfigured).toBe(false)
      expect(app.getSnapshot().credentials.firecrawlConfigured).toBe(true)
    } finally { await app.close() }
  })

  it('uses the cap changed during approval and does not send after it', async () => {
    const calls: string[] = []
    const provider = new MockProvider()
    const { app, dbPath } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => { calls.push(exchange.url); return reply(tavilyHit) }
    })
    const database = new Database(dbPath)
    try {
      app.setResearchKey('tavily', 'tvly-synthetic-account-key')
      app.setResearchKey('firecrawl', 'fc-synthetic-account-key')
      app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchFirecrawl: true, researchDailyCap: 5 })
      expect(database.reserveResearchUse('account', localDay(Date.now()), 5)).toBe(true)
      app.onEvent((event) => {
        if (event.type === 'approval' && event.approval) {
          app.updateAppSettings({ researchDailyCap: 1 })
          app.resolveApproval(event.approval.id, true)
        }
      })
      provider.handler = (input) => {
        const last = input.messages.at(-1)
        if (last?.role === 'tool' && last.name === 'list_memories') return { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"private follow up"}' }] }
        if (last?.role === 'tool') return { content: 'Done.', toolCalls: [] }
        return { content: '', toolCalls: [{ id: 'mem', name: 'list_memories', arguments: '{}' }] }
      }
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'What do you remember?')
      expect(run.status).toBe('completed')
      expect(calls).toEqual([])
      expect(app.getSnapshot().current!.messages.some((item) => item.content.includes('daily request cap'))).toBe(true)
      expect(usageCount(dbPath, 'account')).toBe(1)
      expect(usageCount(dbPath, `bot:${app.getSnapshot().bot!.id}`)).toBe(0)
    } finally {
      database.close()
      await app.close()
    }
  })

  it('counts a connection check and stops it at the bot cap', async () => {
    const calls: ResearchExchange[] = []
    const provider = new MockProvider()
    const { app, dbPath } = makeApp({
      provider,
      lookupHost: publicLookup,
      researchTransport: async (exchange) => { calls.push(exchange); return reply(tavilyHit) }
    })
    const database = new Database(dbPath)
    const botId = app.getSnapshot().bot!.id
    try {
      app.setResearchKey('tavily', 'tvly-synthetic-account-key')
      app.updateAppSettings({ webResearch: 'connection', researchTavily: true, researchFirecrawl: false, researchDailyCap: 5 })
      const checked = await app.checkResearchKey('tavily')
      expect(checked.ok).toBe(true)
      expect(checked.message).toContain('counted')
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://api.tavily.com/search')
      expect(calls[0].body).toContain('example')
      expect(calls[0].headers.Authorization).toBe('Bearer tvly-synthetic-account-key')
      expect(usageCount(dbPath, `bot:${botId}`)).toBe(1)
      expect(usageCount(dbPath, 'account')).toBe(1)
      for (let count = 1; count < RESEARCH_ATTEMPT_LIMIT; count += 1) expect(database.reserveResearchUse(`bot:${botId}`, localDay(Date.now()), RESEARCH_ATTEMPT_LIMIT)).toBe(true)
      calls.length = 0
      const blocked = await app.checkResearchKey('tavily')
      expect(blocked.ok).toBe(false)
      expect(blocked.message).toContain('daily web request limit')
      expect(calls).toEqual([])
      expect(usageCount(dbPath, 'account')).toBe(1)
    } finally {
      database.close()
      await app.close()
    }
  })

  it('keeps an unrelated open browser from replacing Automatic search', async () => {
    const navigations: string[] = []
    const calls: string[] = []
    const page: LaunchedPage = {
      url: () => navigations.at(-1) ?? 'about:blank',
      title: async () => 'Public page',
      goto: async (url) => { navigations.push(url) },
      back: async () => undefined,
      close: async () => undefined,
      text: async () => 'A public page.',
      links: async () => [],
      html: async () => '',
      observe: async () => [],
      press: async () => undefined,
      typeInto: async () => undefined,
      scroll: async () => undefined,
      braveResults: async () => [{ title: 'Example', url: 'https://example.com/', snippet: 'Observed browser result.' }]
    }
    const provider = new MockProvider()
    const { app } = makeApp({
      provider,
      browserOpener: async () => ({ name: 'Fixture browser', pages: () => [page], current: () => page, select: () => undefined, openPage: async () => page, close: async () => undefined }),
      lookupHost: publicLookup,
      researchTransport: async (exchange) => { calls.push(exchange.url); return reply(tavilyHit) }
    })
    try {
      await app.openBrowser()
      expect(app.getSnapshot().browser.open).toBe(true)
      expect(app.getAppSettings().webResearch).toBe('automatic')
      searchHandler(provider)
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Find a public example.')
      expect(run.status).toBe('completed')
      expect(calls).toEqual(['https://api.tavily.com/search'])
      expect(navigations).toEqual([])
      expect(app.getSnapshot().current!.messages.find((item) => item.toolName === 'web_search')!.content).toContain('Web search via Tavily')
    } finally { await app.close() }
  })
})
