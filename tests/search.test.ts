import path from 'path'
import { describe, expect, it } from 'vitest'
import type { BrowserOpener, LaunchedPage } from '../src/core/browser'
import { installedBrowserChannel } from '../src/core/browser-playwright'
import { googleResultTarget, googleSearchRequested } from '../src/core/browser-policy'
import { DEFAULT_SEARCH_TEMPLATE, DUCKDUCKGO_SEARCH_TEMPLATE, requestedSearchEngine } from '../src/core/browser-policy'
import { openDatabase } from '../src/core/sqlite'
import { Database } from '../src/core/db'
import { makeApp } from './helpers'

describe('free web search', () => {
  it('keeps observed opaque Google links and unwraps only explicit destinations', () => {
    expect(googleResultTarget('https://www.google.com/goto?url=opaque-token')).toBe('https://www.google.com/goto?url=opaque-token')
    expect(googleResultTarget('https://www.google.com/url?q=https%3A%2F%2Fangelicpedia.com%2F')).toBe('https://angelicpedia.com/')
    expect(googleResultTarget('https://www.google.com/search?q=other')).toBeNull()
    expect(googleResultTarget('https://www.google.com/url?q=http%3A%2F%2F127.0.0.1%2F')).toBeNull()
    expect(googleResultTarget('javascript:alert(1)')).toBeNull()
  })
  it('detects installed Chrome and Edge without requiring bundled Chromium', () => {
    const env = { ProgramFiles: 'C:\\Apps', 'ProgramFiles(x86)': 'C:\\Apps32' }
    const chrome = path.join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')
    const edge = path.join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    expect(installedBrowserChannel({ platform: 'win32', env, exists: (file) => file === chrome })).toBe('chrome')
    expect(installedBrowserChannel({ platform: 'win32', env, exists: (file) => file === edge })).toBe('msedge')
    expect(installedBrowserChannel({ platform: 'win32', env, exists: () => false })).toBeNull()
    expect(installedBrowserChannel({ platform: 'linux', env, exists: () => true })).toBeNull()
    expect(googleSearchRequested('run a google search for angelicpedia.com and tell me its position')).toBe(true)
    expect(googleSearchRequested('search with Google')).toBe(true)
    expect(googleSearchRequested('use Brave instead of Google')).toBe(false)
    expect(requestedSearchEngine('Search Google instead of Brave')).toBe('google')
    expect(requestedSearchEngine('okay forget google. search the same question for me')).toBe('brave')
    expect(requestedSearchEngine('use DuckDuckGo instead of Google')).toBe('duckduckgo')
  })

  it('uses Brave by default and respects a user switch away from a stale Google tool argument', async () => {
    const page = new SearchPage()
    const { app, provider } = makeApp({ browserOpener: opener(page), lookupHost: async () => ['93.184.216.34'] })
    try {
      expect(app.getSnapshot().settings.searchUrlTemplate).toBe(DEFAULT_SEARCH_TEMPLATE)
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool' ? { content: 'The first Brave result is Angelicpedia.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com","engine":"google"}' }] }
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Forget Google. Search the same question.')
      expect(run.status).toBe('completed')
      expect(new URL(page.navigations[0]).hostname).toBe('search.brave.com')
      expect(app.getSnapshot().current!.messages.find((item) => item.toolName === 'web_search')!.content).toContain('Search engine: Brave')
    } finally { await app.close() }
  })

  it('updates the old saved default on startup while preserving a custom template and other settings', async () => {
    const { app, dbPath } = makeApp()
    const botId = app.getSnapshot().bot!.id
    await app.close()
    const raw = openDatabase(dbPath)
    raw.prepare(`UPDATE bots SET settings_json = json_set(settings_json, '$.searchUrlTemplate', ?, '$.model', 'keep-this-model') WHERE id = ?`).run(DUCKDUCKGO_SEARCH_TEMPLATE, botId)
    raw.exec('PRAGMA user_version = 5')
    raw.close()
    const restarted = new Database(dbPath)
    try {
      restarted.migrate()
      expect(restarted.getSettings().searchUrlTemplate).toBe(DEFAULT_SEARCH_TEMPLATE)
      expect(restarted.getSettings().model).toBe('keep-this-model')
      const custom = 'https://example.com/search?q={query}'
      restarted.saveSettings({ ...restarted.getSettings(), searchUrlTemplate: custom })
      const inspect = openDatabase(dbPath)
      expect(JSON.parse((inspect.prepare('SELECT settings_json FROM bots WHERE id = ?').get(botId) as { settings_json: string }).settings_json).model).toBe('keep-this-model')
      inspect.exec('PRAGMA user_version = 5')
      inspect.close()
    } finally { restarted.close() }
    const customRestart = new Database(dbPath)
    try { customRestart.migrate(); expect(customRestart.getSettings().searchUrlTemplate).toBe('https://example.com/search?q={query}') } finally { customRestart.close() }
  })

  it.each(['read_page', 'web_search', 'web_search default'])('reads the cleared Google page on %s without navigating through verification again', async (mode) => {
    const tool = mode === 'read_page' ? 'read_page' : 'web_search'
    const page = new SearchPage()
    page.challenge = true
    const { app, provider } = makeApp({ browserOpener: opener(page), lookupHost: async () => ['93.184.216.34'] })
    try {
      provider.handler = () => ({ content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com","engine":"google"}' }] })
      const cid = app.getSnapshot().ongoingConversationId!
      expect((await app.sendMessage(cid, 'Search Google for angelicpedia.com')).status).toBe('paused')
      page.challenge = false
      if (mode === 'web_search default') app.resumeBrowser()
      provider.handler = input => input.messages.at(-1)?.role === 'tool' ? { content: 'Observed first organic result.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'retry', name: tool, arguments: tool === 'read_page' ? '{}' : JSON.stringify({ query: 'angelicpedia.com', ...(mode === 'web_search' ? { engine: 'google' } : {}) }) }] }
      const run = await app.sendMessage(cid, 'I cleared it for you. Check now.')
      expect(run.status).toBe('completed')
      expect(page.navigations).toHaveLength(1)
      expect(app.getSnapshot().browser.takeover).toBe(false)
      const result = app.getSnapshot().current!.messages.filter((item) => item.toolName === tool).at(-1)!.content
      expect(result).toContain('Search engine: Google')
      expect(result).toContain('1. List of Angels')
    } finally { await app.close() }
  })

  it('keeps a reader failure separate from human takeover and permits a different engine', async () => {
    const page = new SearchPage()
    page.hits = []
    const { app, provider } = makeApp({ browserOpener: opener(page), lookupHost: async () => ['93.184.216.34'] })
    try {
      provider.handler = () => ({ content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com","engine":"google"}' }] })
      const cid = app.getSnapshot().ongoingConversationId!
      const paused = await app.sendMessage(cid, 'Search Google for angelicpedia.com')
      expect(paused.status).toBe('paused')
      expect(paused.note).toContain('result-reader limitation')
      expect(paused.note).not.toContain('Take over the browser')
      expect(app.getSnapshot().browser.takeover).toBe(false)
      page.hits = [{ title: 'Homepage', url: 'https://angelicpedia.com/', snippet: 'Observed home page' }]
      provider.handler = input => input.messages.at(-1)?.role === 'tool' ? { content: 'Brave first result.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'next', name: 'web_search', arguments: '{"query":"angelicpedia.com"}' }] }
      expect((await app.sendMessage(cid, 'Forget Google. Use Brave instead.')).status).toBe('completed')
      expect(new URL(page.navigations.at(-1)!).hostname).toBe('search.brave.com')
    } finally { await app.close() }
  })

  it('retains the Google URL when a read_page reader failure is retried with the default engine argument', async () => {
    const page = new SearchPage()
    page.navigations.push('https://www.google.com/search?q=angelicpedia.com&hl=en&gl=us&pws=0')
    page.hits = []
    const { app, provider } = makeApp({ browserOpener: opener(page), lookupHost: async () => ['93.184.216.34'] })
    try {
      provider.handler = () => ({ content: '', toolCalls: [{ id: 'read', name: 'read_page', arguments: '{}' }] })
      const cid = app.getSnapshot().ongoingConversationId!
      expect((await app.sendMessage(cid, 'Read the existing results.')).status).toBe('paused')
      page.hits = [{ title: 'Homepage', url: 'https://angelicpedia.com/', snippet: 'Home page' }]
      provider.handler = input => input.messages.at(-1)?.role === 'tool' ? { content: 'Google first result.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'retry', name: 'web_search', arguments: '{"query":"angelicpedia.com"}' }] }
      expect((await app.sendMessage(cid, 'Try reading it again.')).status).toBe('completed')
      expect(page.navigations).toHaveLength(1)
      expect(app.getSnapshot().current!.messages.find(item => item.toolName === 'web_search')!.content).toContain('Search engine: Google')
    } finally { await app.close() }
  })

  it('honors DuckDuckGo explicitly and pauses its text-only challenge before another model call', async () => {
    const page = new SearchPage()
    page.text = async () => 'DuckDuckGo. Please complete the following challenge to confirm this search was made by a human.'
    const { app, provider } = makeApp({ browserOpener: opener(page), lookupHost: async () => ['93.184.216.34'] })
    try {
      provider.handler = () => ({ content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com"}' }] })
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search using DuckDuckGo for angelicpedia.com.')
      expect(run.status).toBe('paused')
      expect(new URL(page.navigations[0]).hostname).toBe('html.duckduckgo.com')
      expect(run.note).toContain('DuckDuckGo asked for human verification')
      expect(provider.calls).toHaveLength(1)
    } finally { await app.close() }
  })

  it('pauses immediately when a window closes mid-action and reopens on the next request', async () => {
    let opens = 0
    const page = new SearchPage()
    const original = page.goto.bind(page)
    page.goto = async url => { if (opens === 1) throw new Error('Target page, context or browser has been closed'); await original(url) }
    const { app, provider } = makeApp({ browserOpener: async input => { opens++; return opener(page)(input) }, lookupHost: async () => ['93.184.216.34'] })
    try {
      app.updateAppSettings({ webResearch: 'browser' })
      provider.handler = input => input.messages.at(-1)?.role === 'tool' ? { content: 'Found.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com"}' }] }
      const cid = app.getSnapshot().ongoingConversationId!
      const paused = await app.sendMessage(cid, 'Search for angelicpedia.com')
      expect(paused.status).toBe('paused')
      expect(paused.note).toContain('window was closed')
      expect(provider.calls).toHaveLength(1)
      expect(app.getSnapshot().browser.open).toBe(false)
      expect((await app.sendMessage(cid, 'Try that search again.')).status).toBe('completed')
      expect(opens).toBe(2)
    } finally { await app.close() }
  })

  it('discards a closed context before reporting browser state or reopening, without a model call', async () => {
    let closed = false
    let opens = 0
    const page = new SearchPage()
    const { app, provider } = makeApp({ browserOpener: async input => {
      closed = false
      opens++
      return { ...await opener(page)(input), isClosed: () => closed }
    } })
    try {
      await app.openBrowser()
      closed = true
      expect(app.getSnapshot().browser.open).toBe(false)
      await app.openBrowser()
      expect(app.getSnapshot().browser.open).toBe(true)
      expect(opens).toBe(2)
      expect(provider.calls).toHaveLength(0)
    } finally { await app.close() }
  })

  it.each(['explicit Google request', 'explicit Google tool argument'])(
    'preserves the query and Google source for an %s', async (mode) => {
      const page = new SearchPage()
      const { app, provider } = makeApp({ browserOpener: opener(page), lookupHost: async () => ['93.184.216.34'] })
      try {
        provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
          ? { content: 'The first observed Google result is Angelicpedia.', toolCalls: [] }
          : { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: JSON.stringify({ query: 'angelicpedia.com', ...(mode === 'explicit Google tool argument' ? { engine: 'google' } : {}) }) }] }
        const id = app.getSnapshot().ongoingConversationId!
        const run = await app.sendMessage(id, mode === 'explicit Google request' ? 'Run a Google search for angelicpedia.com and tell me its position' : 'Look up angelicpedia.com')
        expect(run.status).toBe('completed')
        const url = new URL(page.navigations[0])
        expect(url.hostname).toBe('www.google.com')
        expect(url.searchParams.get('q')).toBe('angelicpedia.com')
        expect(url.searchParams.get('pws')).toBe('0')
        const result = app.openConversation(id).messages.find((message) => message.toolName === 'web_search')!.content
        expect(result).toContain('Search engine: Google')
        expect(result).toContain('Exact query: "angelicpedia.com"')
        expect(result).toContain('1. List of Angels - Angelicpedia')
        expect(result).toContain('only to this query and page')
        expect(page.htmlReads).toBe(0)
      } finally { await app.close() }
    }
  )

  it('pauses a Google challenge without extra model calls, alternate URLs, or a proxy rank', async () => {
    const page = new SearchPage()
    page.challenge = true
    const { app, provider } = makeApp({ browserOpener: opener(page), lookupHost: async () => ['93.184.216.34'] })
    try {
      provider.handler = () => ({ content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com"}' }] })
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Run a Google search for angelicpedia.com')
      expect(run.status).toBe('paused')
      expect(run.note).toContain('No Google position was verified')
      expect(run.note).toContain('Take over the browser')
      expect(provider.calls).toHaveLength(1)
      expect(page.navigations).toHaveLength(1)
      expect(app.getSnapshot().browser.takeover).toBe(true)
      expect(app.listActivity()[0].tools[0].outcome).toBe('failed')
      app.resumeBrowser()
      expect(provider.calls).toHaveLength(1)
    } finally { await app.close() }
  })

  it('does not claim a position when Google result cards cannot be read', async () => {
    const page = new SearchPage()
    page.hits = []
    const { app, provider } = makeApp({ browserOpener: opener(page), lookupHost: async () => ['93.184.216.34'] })
    try {
      provider.handler = () => ({ content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com","engine":"google"}' }] })
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Check the position')
      expect(run.status).toBe('paused')
      expect(run.note).toContain('No Google position was verified')
      expect(provider.calls).toHaveLength(1)
    } finally { await app.close() }
  })

  it('can search for CAPTCHA as a topic when real result cards are present', async () => {
    const page = new SearchPage()
    page.text = async () => 'Google Search results for CAPTCHA and unusual traffic'
    const { app, provider } = makeApp({ browserOpener: opener(page), lookupHost: async () => ['93.184.216.34'] })
    try {
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
        ? { content: 'Found the article.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"CAPTCHA unusual traffic","engine":"google"}' }] }
      expect((await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Search on Google for CAPTCHA unusual traffic')).status).toBe('completed')
      expect(app.getSnapshot().browser.takeover).toBe(false)
    } finally { await app.close() }
  })

  it('does not move a different Automatic query onto a pending browser search', async () => {
    const page = new SearchPage()
    page.challenge = true
    const calls: string[] = []
    const { app, provider } = makeApp({
      browserOpener: opener(page),
      lookupHost: async () => ['93.184.216.34'],
      researchTransport: async (exchange) => {
        calls.push(exchange.url)
        return { status: 200, headers: {}, body: JSON.stringify({ results: [{ title: 'Example', url: 'https://example.com/', content: 'A public example.' }] }) }
      }
    })
    try {
      provider.handler = () => ({ content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com","engine":"google"}' }] })
      const cid = app.getSnapshot().ongoingConversationId!
      expect((await app.sendMessage(cid, 'Search Google for angelicpedia.com')).status).toBe('paused')
      expect(page.navigations).toHaveLength(1)
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
        ? { content: 'Noted.', toolCalls: [] }
        : { content: '', toolCalls: [{ id: 'weather', name: 'web_search', arguments: '{"query":"public weather"}' }] }
      const run = await app.sendMessage(cid, 'Find a public weather page.')
      expect(run.status).toBe('completed')
      expect(calls).toEqual(['https://api.tavily.com/search'])
      expect(page.navigations).toHaveLength(1)
      expect(app.getSnapshot().current!.messages.some((item) => item.content.includes('Web search via Tavily'))).toBe(true)
    } finally { await app.close() }
  })

  it('pauses after one call if no browser can open', async () => {
    const { app, provider } = makeApp({ browserOpener: async () => { throw new Error('No supported browser is installed. Choose Install Chromium.') } })
    try {
      provider.handler = () => ({ content: '', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{"query":"angelicpedia.com"}' }] })
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Run a Google search for angelicpedia.com')
      expect(run.status).toBe('paused')
      expect(run.note).toContain('No supported browser')
      expect(provider.calls).toHaveLength(1)
    } finally { await app.close() }
  })
})

class SearchPage implements LaunchedPage {
  navigations: string[] = []
  challenge = false
  htmlReads = 0
  hits = [{ title: 'List of Angels - Angelicpedia', url: 'https://angelicpedia.com/', snippet: 'List of angels.' }]
  url(): string { return this.challenge ? 'https://www.google.com/sorry/index' : this.navigations.at(-1) ?? 'about:blank' }
  async title(): Promise<string> { return 'Google' }
  async goto(url: string): Promise<void> { this.navigations.push(url) }
  async text(): Promise<string> { return this.challenge ? 'Our systems have detected unusual traffic from your computer network.' : 'Google Search results' }
  async googleResults() { return this.hits }
  async braveResults() { return this.hits }
  async html(): Promise<string> { this.htmlReads += 1; return '' }
  async links() { return [] }
  async observe() { return [] }
  async back(): Promise<void> {}
  async close(): Promise<void> {}
  async press(): Promise<void> {}
  async typeInto(): Promise<void> {}
  async scroll(): Promise<void> {}
}

function opener(page: SearchPage): BrowserOpener {
  return async () => ({ name: 'Google Chrome', pages: () => [page], current: () => page, select: () => undefined, openPage: async () => page, close: async () => undefined })
}
