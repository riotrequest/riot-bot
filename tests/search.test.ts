import path from 'path'
import { describe, expect, it } from 'vitest'
import type { BrowserOpener, LaunchedPage } from '../src/core/browser'
import { installedBrowserChannel } from '../src/core/browser-playwright'
import { googleResultTarget, googleSearchRequested } from '../src/core/browser-policy'
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
