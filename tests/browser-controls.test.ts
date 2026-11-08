import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { installedBrowserChannel, PlaywrightPage } from '../src/core/browser-playwright'
import { BrowserService, type BrowserActInput, type BrowserAction } from '../src/core/browser'
import { DEFAULT_SEARCH_TEMPLATE } from '../src/core/browser-policy'
import { newId } from '../src/core/ids'

const channel = installedBrowserChannel()
const SITE = 'https://fixture.test'
const WIDGET = 'https://widget.test'

type Reply = { status?: number; headers?: Record<string, string>; contentType?: string; body: string }

// Real Chromium, offline: every request is answered by a local route. No personal profile or network.
describe.skipIf(!channel && !fs.existsSync(chromium.executablePath()))('browser controls in real Chromium', () => {
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let service: BrowserService
  let botId: string
  let routes: Record<string, Reply>
  let approvals: string[]
  let approve: boolean

  beforeAll(async () => {
    browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true, chromiumSandbox: true })
  })
  afterAll(async () => { await browser?.close() })

  beforeEach(async () => {
    routes = {}
    approvals = []
    approve = true
    context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1000, height: 700 } })
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      const reply = routes[url.origin + url.pathname]
      return reply ? route.fulfill(reply) : route.abort()
    })
    page = await context.newPage()
    const wrapper = new PlaywrightPage(page)
    service = new BrowserService({
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'riot-controls-')),
      lookupHost: async () => ['93.184.216.34'],
      opener: async () => ({ pages: () => [wrapper], current: () => wrapper, select() {}, openPage: async () => wrapper, close: async () => {} })
    })
    botId = newId()
  })
  afterEach(async () => {
    await service.closeAll()
    await context.close()
  })

  const act = (action: BrowserAction, extra: Partial<BrowserActInput> = {}): Promise<string> => service.act({
    botId, runId: 'run', signal: new AbortController().signal, action, searchTemplate: DEFAULT_SEARCH_TEMPLATE, maxActions: 200, trustedSites: [SITE],
    confirm: async (_preview, url) => { approvals.push(url); return approve },
    ...extra
  })
  const load = async (html: string): Promise<void> => {
    routes[`${SITE}/`] = { contentType: 'text/html', body: `<!doctype html><meta charset="utf-8">${html}` }
    await page.goto(`${SITE}/`)
  }
  const refFor = (snapshot: string, pattern: RegExp): string => {
    const line = snapshot.split('\n').find((item) => /^e\d+ /.test(item) && pattern.test(item))
    if (!line) throw new Error(`No element matched ${pattern} in:\n${snapshot}`)
    return line.split(' ')[0]
  }
  const value = <T,>(script: string): Promise<T> => page.evaluate(script) as Promise<T>

  it('lists the whole page with on-screen elements first and finds the rest by query, including shadow DOM', async () => {
    const items = Array.from({ length: 120 }, (_, index) => `<button onclick="window.clicked=this.textContent">Item ${index + 1}</button>`).join('')
    await load(`<button>Top button</button><div style="height:3000px"></div>${items}<div id="host"></div>
      <script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow action</button>'</script>`)
    const snapshot = await act({ type: 'snapshot' })
    expect(snapshot).toMatch(/On screen:\ne\d+ button Top button/)
    expect(snapshot).toContain('Elsewhere on the page')
    expect(snapshot).toMatch(/\d+ more elements were not listed/)

    const deep = await act({ type: 'snapshot', query: 'item 120' })
    expect(deep).toContain('Elements matching "item 120": 1.')
    await act({ type: 'click', ref: refFor(deep, /button Item 120$/) })
    expect(await value('window.clicked')).toBe('Item 120')
    expect(await act({ type: 'snapshot', query: 'shadow' })).toMatch(/button Shadow action/)
  })

  it('reads states and text values but never secret field values', async () => {
    await load(`<label>Email <input value="me@example.com"></label>
      <label>Card number <input autocomplete="cc-number" value="4111111111111111"></label>
      <input type="password" aria-label="Password" value="hunter2">
      <label><input type="checkbox" checked> Remember me</label>
      <button disabled>Pay</button>
      <details><summary>More</summary><p>Hidden</p></details>
      <select aria-label="Country"><option>United States</option><option selected>Canada</option><option value="mx">Mexico</option></select>`)
    const snapshot = await act({ type: 'snapshot' })
    expect(snapshot).toContain('textbox Email value="me@example.com"')
    expect(snapshot).toMatch(/textbox Card number \[[^\]]*filled/)
    expect(snapshot).not.toContain('4111')
    expect(snapshot).not.toContain('hunter2')
    expect(snapshot).toContain('checkbox Remember me [checked]')
    expect(snapshot).toContain('button Pay [disabled]')
    expect(snapshot).toContain('button More [collapsed]')
    expect(snapshot).toContain('combobox Country (selected "Canada"; options: "United States", "Canada", "Mexico")')
  })

  it('chooses dropdown options by label or value and lists the choices when nothing matches', async () => {
    await load('<select aria-label="Country"><option>United States</option><option selected>Canada</option><option value="mx">Mexico</option></select>')
    let snapshot = await act({ type: 'snapshot' })
    expect(await act({ type: 'select', ref: refFor(snapshot, /Country/), option: 'mx' })).toContain('Selected "Mexico"')
    expect(await page.inputValue('select')).toBe('mx')
    snapshot = await act({ type: 'snapshot' })
    expect(await act({ type: 'fill', ref: refFor(snapshot, /Country/), value: 'united states' })).toContain('Selected "United States"')
    snapshot = await act({ type: 'snapshot' })
    const missing = await act({ type: 'select', ref: refFor(snapshot, /Country/), option: 'Atlantis' })
    expect(missing).toContain('No option')
    expect(missing).toContain('"Canada"')
    expect(await page.inputValue('select')).toBe('United States')
  })

  it('asks before keys that can submit, not before moving focus, and never types into a password field', async () => {
    await load(`<input aria-label="Search" onkeydown="window.keys = (window.keys || []).concat(event.key)">
      <input type="password" aria-label="Password" onkeydown="window.secret = (window.secret || 0) + 1">`)
    const snapshot = await act({ type: 'snapshot' })
    const search = refFor(snapshot, /Search/)
    approve = false
    expect(await act({ type: 'key', key: 'Enter', ref: search }, { trustedSites: [] })).toContain('not approved')
    expect(approvals).toEqual([`${SITE}/`])
    expect(await value('window.keys')).toBeUndefined()
    await act({ type: 'key', key: 'Tab', ref: search }, { trustedSites: [] })
    expect(approvals).toHaveLength(1)
    expect(await value('window.keys')).toEqual(['Tab'])

    expect(await act({ type: 'key', key: 'a', ref: refFor(snapshot, /password field/) })).toMatch(/Password fields are not filled/)
    await page.focus('input[type=password]')
    expect(await act({ type: 'key', key: 'x' })).toMatch(/not typed into password fields/)
    expect(await value('window.secret')).toBeUndefined()
  })

  it('asks the embedded frame’s own website before acting inside it, even when the page is trusted', async () => {
    routes[`${WIDGET}/pay`] = { contentType: 'text/html', body: '<button onclick="window.paid = true">Pay inside</button>' }
    await load(`<p>Checkout</p><iframe src="${WIDGET}/pay" style="width:400px;height:120px"></iframe>`)
    const snapshot = await act({ type: 'snapshot' })
    const pay = refFor(snapshot, /Pay inside/)
    expect(snapshot).toContain(`button Pay inside (in frame ${WIDGET})`)
    const frame = page.frames().find((item) => item.url().startsWith(WIDGET))!
    approve = false
    expect(await act({ type: 'click', ref: pay })).toContain('not approved')
    expect(approvals).toEqual([WIDGET])
    expect(await frame.evaluate('window.paid')).toBeUndefined()
    approve = true
    expect(await act({ type: 'click', ref: pay })).toContain('Clicked')
    expect(await frame.evaluate('window.paid')).toBe(true)
  })

  it('dismisses confirmation dialogs unless the action accepts them, and reports every dialog', async () => {
    await load(`<button onclick="window.answer = confirm('Delete everything?')">Delete</button>
      <button onclick="alert('Saved'); window.saved = true">Save</button>`)
    let snapshot = await act({ type: 'snapshot' })
    const dismissed = await act({ type: 'click', ref: refFor(snapshot, /Delete/) })
    expect(dismissed).toContain('confirm dialog: "Delete everything?". It was dismissed')
    expect(await value('window.answer')).toBe(false)
    snapshot = await act({ type: 'snapshot' })
    expect(await act({ type: 'click', ref: refFor(snapshot, /Delete/), acceptDialog: true })).toContain('It was accepted')
    expect(await value('window.answer')).toBe(true)
    snapshot = await act({ type: 'snapshot' })
    expect(await act({ type: 'click', ref: refFor(snapshot, /Save/) })).toContain('alert dialog: "Saved". It was acknowledged')
    expect(await value('window.saved')).toBe(true)
  })

  it('saves a download a click started and cancels one the page starts by itself', async () => {
    routes[`${SITE}/report.csv`] = { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"' }, body: 'a,b\n1,2\n' }
    const saved: { name: string; text: string }[] = []
    const saveDownload = (download: { file: string; name: string }): string => {
      saved.push({ name: download.name, text: fs.readFileSync(download.file, 'utf8') })
      return 'Saved it.'
    }
    await load('<a href="/report.csv">Get report</a>')
    const snapshot = await act({ type: 'snapshot' }, { saveDownload })
    expect(await act({ type: 'click', ref: refFor(snapshot, /Get report/) }, { saveDownload })).toContain('Saved it.')
    expect(saved).toEqual([{ name: 'report.csv', text: 'a,b\n1,2\n' }])

    // A fresh tab has no recent click, so a download the page starts on its own is refused.
    const quiet = await context.newPage()
    const wrapper = new PlaywrightPage(quiet)
    const other = new BrowserService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'riot-controls-')), lookupHost: async () => ['93.184.216.34'], opener: async () => ({ pages: () => [wrapper], current: () => wrapper, select() {}, openPage: async () => wrapper, close: async () => {} }) })
    routes[`${SITE}/auto`] = { contentType: 'text/html', body: '<button>Idle</button><script>setTimeout(() => { const a = document.createElement("a"); a.href = "/report.csv"; a.click() }, 50)</script>' }
    try {
      await quiet.goto(`${SITE}/auto`)
      await quiet.waitForTimeout(800)
      const input = { botId: newId(), runId: 'run', signal: new AbortController().signal, searchTemplate: DEFAULT_SEARCH_TEMPLATE, trustedSites: [SITE], confirm: async () => true, saveDownload }
      const idle = await other.act({ ...input, action: { type: 'snapshot' } })
      expect(await other.act({ ...input, action: { type: 'hover', ref: refFor(idle, /Idle/) } })).toContain('was not part of a click or key press, so it was cancelled')
      expect(saved).toHaveLength(1)
    } finally { await other.closeAll() }
  })

  it('uploads a workspace file only after the upload is approved', async () => {
    await load('<label>Resume <input type="file" style="display:none" onchange="window.picked = this.files[0] && this.files[0].name"></label>')
    const requests: { origin: string; path: string }[] = []
    let allowed = false
    const upload = async (request: { path: string; origin: string }) => {
      requests.push({ origin: request.origin, path: request.path })
      return allowed ? { name: 'cv.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') } : 'The upload was not approved, so no file was sent.'
    }
    const snapshot = await act({ type: 'snapshot' }, { upload })
    const chooser = refFor(snapshot, /file chooser/)
    expect(await act({ type: 'click', ref: chooser })).toMatch(/Use upload_file/)
    expect(await act({ type: 'upload', ref: chooser, path: 'cv.txt' }, { upload })).toContain('not approved')
    expect(await value('window.picked')).toBeUndefined()
    allowed = true
    expect(await act({ type: 'upload', ref: chooser, path: 'cv.txt' }, { upload })).toContain('Attached cv.txt')
    expect(await value('window.picked')).toBe('cv.txt')
    expect(requests).toEqual([{ origin: SITE, path: 'cv.txt' }, { origin: SITE, path: 'cv.txt' }])
  })

  it('takes a labelled screenshot for models that can see images and cleans up after itself', async () => {
    await load('<h1>Dashboard</h1><button>Refresh</button>')
    expect(await act({ type: 'screenshot' })).toMatch(/cannot view screenshots/)
    const images: string[] = []
    const result = await act({ type: 'screenshot' }, { capture: (image) => images.push(image.dataUrl) })
    expect(result).toMatch(/e\d+ button Refresh/)
    expect(result).toContain('comes with the next message')
    expect(images).toHaveLength(1)
    expect(images[0]).toMatch(/^data:image\/jpeg;base64,/)
    expect(await value('document.documentElement.children.length')).toBe(2)
  })

  it('waits for content, hovers to reveal menus and drags between items', async () => {
    await load(`<button onclick="setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<p>Done loading</p>'), 300)">Load</button>
      <div onmouseenter="document.getElementById('more').hidden = false"><button>Menu</button><button id="more" hidden>Archive</button></div>
      <div role="button" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', 'card')">Card</div>
      <div role="button" ondragover="event.preventDefault()" ondrop="window.dropped = event.dataTransfer.getData('text/plain')" style="margin-top:40px;padding:20px">Done column</div>`)
    let snapshot = await act({ type: 'snapshot' })
    await act({ type: 'click', ref: refFor(snapshot, /Load/) })
    expect(await act({ type: 'wait', text: 'done loading' })).toContain('Done waiting')
    expect(await act({ type: 'wait', gone: 'Done loading', seconds: 0.5 })).toContain('Stopped waiting after 0.5 seconds')

    snapshot = await act({ type: 'snapshot' })
    expect(snapshot).not.toContain('Archive')
    await act({ type: 'hover', ref: refFor(snapshot, /button Menu/) })
    expect(await act({ type: 'snapshot' })).toContain('button Archive')

    snapshot = await act({ type: 'snapshot' })
    await act({ type: 'drag', ref: refFor(snapshot, /button Card/), toRef: refFor(snapshot, /Done column/) })
    expect(await value('window.dropped')).toBe('card')
  })
})
