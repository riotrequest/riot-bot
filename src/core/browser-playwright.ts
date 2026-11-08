import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { EventEmitter } from 'node:events'
import type { Dialog, Download, ElementHandle, Frame, Page } from 'playwright-core'
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_FRAME_LIMIT,
  BROWSER_NAV_TIMEOUT_MS,
  checkNavigationUrl,
  googleResultTarget,
  type SearchHit
} from './browser-policy'
import type { ActionPolicy, ActionReport, LaunchedBrowser, LaunchedPage, PageDownload, RawControl, UploadFile, WaitCondition } from './browser'

export interface ChromiumLaunchOptions {
  headless: false
  chromiumSandbox: true
  /** Downloads are accepted by the browser, then kept only when a bot action asked for them. */
  acceptDownloads: true
  proxy: { server: string }
  viewport: null
  args: string[]
}

/** Product launch options. The sandbox stays on, and the window is visible. */
export function chromiumLaunchOptions(proxyUrl: string): ChromiumLaunchOptions {
  // Installed Chromium channels differ in the spelling they honor. Test the network boundary, not just these strings.
  const args = ['--webrtc-ip-handling-policy=disable_non_proxied_udp', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']
  if (args.some((arg) => /no-sandbox|disable-setuid-sandbox/i.test(arg))) {
    throw new Error('Refusing to launch Chromium without its sandbox.')
  }
  return {
    headless: false,
    chromiumSandbox: true,
    acceptDownloads: true,
    proxy: { server: proxyUrl },
    viewport: null,
    args
  }
}

export function playwrightCliPath(): string {
  const resources = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules', 'playwright-core', 'cli.js')
  if (resources && fs.existsSync(unpacked)) return unpacked
  const pkg = require.resolve('playwright-core/package.json')
  const cli = path.join(path.dirname(pkg), 'cli.js')
  if (!fs.existsSync(cli)) throw new Error('The Chromium installer was not found in the app.')
  return cli
}

export function chromiumLooksInstalled(browsersPath: string): boolean {
  return Boolean(bundledChromiumExecutable(browsersPath))
}

export function bundledChromiumExecutable(browsersPath:string):string|null{
  if(!browsersPath||!fs.existsSync(browsersPath))return null
  return findChrome(browsersPath,0)
}

export function installedBrowserChannel(options: {
  platform?: string
  env?: NodeJS.ProcessEnv
  exists?: (file: string) => boolean
} = {}): 'chrome' | 'msedge' | null {
  if ((options.platform ?? process.platform) !== 'win32') return null
  const env = options.env ?? process.env
  const exists = options.exists ?? fs.existsSync
  const roots = [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter((root): root is string => Boolean(root))
  for (const [channel, suffix] of [['chrome', ['Google', 'Chrome', 'Application', 'chrome.exe']], ['msedge', ['Microsoft', 'Edge', 'Application', 'msedge.exe']]] as const) {
    if (roots.some((root) => exists(path.join(root, ...suffix)))) return channel
  }
  return null
}

export function availableBrowserName(browsersPath: string): string | null {
  if (chromiumLooksInstalled(browsersPath)) return 'Chromium'
  const channel = installedBrowserChannel()
  return channel === 'chrome' ? 'Google Chrome' : channel === 'msedge' ? 'Microsoft Edge' : null
}

function findChrome(dir: string, depth: number): string|null {
  if (depth > 4) return null
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return null
  }
  for (const name of entries) {
    const full = path.join(dir, name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (stat.isFile() && (name === 'chrome.exe' || name === 'chrome' || name === 'chromium')) return full
    if (stat.isDirectory()) {const found=findChrome(full,depth+1);if(found)return found}
  }
  return null
}

export async function runBrowserCli(browsersPath: string,args:string[],onLine: (line:string)=>void):Promise<void>{
  fs.mkdirSync(browsersPath, { recursive: true })
  const cli = playwrightCliPath()
  await new Promise<void>((resolve, reject) => {
    const env:NodeJS.ProcessEnv={...process.env,PLAYWRIGHT_BROWSERS_PATH:browsersPath}
    if(process.platform==='win32')env.NODE_USE_SYSTEM_CA='1'
    delete env.ELECTRON_RUN_AS_NODE
    const electron=require('electron') as typeof import('electron')
    // Utility processes keep installation working with the RunAsNode fuse disabled.
    const child=electron.utilityProcess
      ?electron.utilityProcess.fork(path.join(electron.app.getAppPath(),'out/main/browser-installer.js'),[cli,...args],{env,stdio:'pipe',serviceName:'Riot browser setup'})
      :!process.versions.electron?spawn(process.execPath,[cli,...args],{env,windowsHide:true}):null
    if(!child){reject(new Error('The secure browser installer is unavailable. Update Riot Bot.'));return}
    const report = (chunk: Buffer): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) onLine(trimmed.slice(0, 240))
      }
    }
    child.stdout?.on('data', report)
    child.stderr?.on('data', report)
    const events=child as EventEmitter
    events.on('error', reject)
    events.on('exit', (code:number|null) => {
      if (code === 0) resolve()
      else reject(new Error('Chromium installation did not finish. Nothing was installed into the app profile.'))
    })
  })
}

export async function installChromium(browsersPath: string, onLine: (line: string) => void): Promise<void> {
  return runBrowserCli(browsersPath,['install','chromium'],onLine)
}

export async function openPlaywrightBrowser(input: { profileDir: string; proxyUrl: string; browsersPath: string }): Promise<LaunchedBrowser> {
  fs.mkdirSync(input.profileDir, { recursive: true })
  const { chromium } = await import('playwright-core')
  // Playwright can already be imported by the static checker. Its registry caches
  // environment paths at import time, so choose this app's executable explicitly.
  const executable = bundledChromiumExecutable(input.browsersPath)
  const channel = executable ? null : installedBrowserChannel()
  if (!executable && !channel) {
    throw new Error('No supported browser is installed. Install Google Chrome or Microsoft Edge, or choose Install Chromium in the bot menu. No model call is needed for that setup.')
  }
  const options = chromiumLaunchOptions(input.proxyUrl)
  // Keep the app's cookies separate from personal profiles and from other browser versions.
  const profileDir = channel ? path.join(input.profileDir, channel) : input.profileDir
  const context = await chromium.launchPersistentContext(profileDir, { ...options, ...(executable ? {executablePath:executable} : channel ? { channel } : {}) })
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    if (url === 'about:blank' || url.startsWith('about:')) {
      await route.continue()
      return
    }
    try {
      checkNavigationUrl(url)
      await route.continue()
    } catch {
      await route.abort()
    }
  })
  const pages = new Map<Page, PlaywrightPage>()
  let closed = false
  context.on('close', () => { closed = true })
  let current: PlaywrightPage | null = null
  const wrap = (page: Page): PlaywrightPage => {
    const existing = pages.get(page)
    if (existing) return existing
    const wrapped = new PlaywrightPage(page)
    pages.set(page, wrapped)
    page.on('close', () => {
      pages.delete(page)
      if (current === wrapped) current = [...pages.values()].at(-1) ?? null
    })
    return wrapped
  }
  for (const page of context.pages()) wrap(page)
  current = context.pages()[0] ? wrap(context.pages()[0]) : null
  context.on('page', (page) => {
    current = wrap(page)
  })
  return {
    name: channel === 'chrome' ? 'Google Chrome' : channel === 'msedge' ? 'Microsoft Edge' : 'Chromium',
    isClosed: () => closed,
    focus: () => current?.focus() ?? Promise.resolve(),
    pages: () => [...pages.values()],
    current: () => current,
    select: (page) => {
      current = page as PlaywrightPage
    },
    openPage: async () => {
      const page = await context.newPage()
      current = wrap(page)
      return current
    },
    close: async () => {
      await context.close()
    }
  }
}

const STALE_REFERENCE = 'That element reference is stale or unknown. Take a fresh page snapshot and use one of its references.'
/** Dialogs and downloads often arrive just after the click that caused them. */
const ACTION_SETTLE_MS = 300
/** A download that starts this soon after a click or key press still belongs to it. */
const DOWNLOAD_GRACE_MS = 10_000
const DOWNLOADS_PER_ACTION = 3
const NOTE_LIMIT = 6

interface Box { x: number; y: number; width: number; height: number }

/** What the page reports about one element, before frame details are added. */
type Described = Omit<RawControl, 'frame' | 'onScreen'> & { box: Box | null }

interface Entry {
  handle: ElementHandle<Element>
  frame: Frame
  /** Position in the visible page when the snapshot was taken, used to label screenshots. */
  box: Box | null
}

export class PlaywrightPage implements LaunchedPage {
  private entries: Entry[] = []
  private policy: ActionPolicy | null = null
  private graceUntil = 0
  private notes: string[] = []
  private downloads: PageDownload[] = []

  constructor(private readonly page: Page) {
    page.setDefaultTimeout(BROWSER_ACTION_TIMEOUT_MS)
    page.setDefaultNavigationTimeout(BROWSER_NAV_TIMEOUT_MS)
    page.on('dialog', (dialog) => void this.answer(dialog))
    page.on('download', (download) => this.receive(download))
  }

  focus(): Promise<void> {
    return this.page.bringToFront()
  }

  async loaded(timeoutMs: number): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined)
  }

  async googleResults(limit: number): Promise<SearchHit[]> {
    await this.page.locator('#rso h3, #search h3, main h3').first().waitFor({ state: 'attached', timeout: 3000 }).catch(() => undefined)
    const observed = await this.page.evaluate((max) => {
      const root = ['#rso', '#search', 'main'].map((selector) => document.querySelector(selector)).find((element) => element?.querySelector('h3'))
      if (!root) return []
      const cards = new Set<Element>()
      const results: { title: string; url: string; snippet: string; displayUrl: string }[] = []
      for (const heading of root.querySelectorAll('h3')) {
        const anchor = heading.closest('a[href]') as HTMLAnchorElement | null
        const card = heading.closest('div.MjjYud, div.g, div[data-sokoban-container]')
        if (!anchor || !card || cards.has(card) || heading.closest('#tads, #bottomads, [data-text-ad], [data-attrid], [data-ad-client]')) continue
        cards.add(card)
        results.push({ title: heading.textContent?.trim().slice(0, 180) ?? '', url: anchor.href, displayUrl: card.querySelector('cite')?.textContent?.trim().slice(0, 250) ?? '', snippet: (card as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 350) })
        if (results.length >= max * 3) break
      }
      return results
    }, limit)
    return observed.flatMap((hit) => {
      const url = googleResultTarget(hit.url)
      return url ? [{ ...hit, url }] : []
    }).slice(0, limit)
  }

  async braveResults(limit: number): Promise<SearchHit[]> {
    const selector = '.snippet[data-type="web"]'
    await this.page.locator(selector).first().waitFor({ state: 'attached', timeout: 3000 }).catch(() => undefined)
    const observed = await this.page.locator(selector).evaluateAll((cards, max) => cards.flatMap((card) => {
      const title = card.querySelector('.title')
      const anchor = title?.closest('a[href]') as HTMLAnchorElement | null
      if (!title || !anchor || title.closest('.snippet') !== card || card.closest('[data-type="ad"], [data-text-ad], .ad')) return []
      return [{ title: title.textContent?.trim().slice(0, 180) ?? '', url: anchor.href,
        displayUrl: card.querySelector('cite')?.textContent?.trim().slice(0, 250) ?? '',
        snippet: card.querySelector('.generic-snippet .content')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 350) ?? '' }]
    }).slice(0, max), limit)
    return observed.filter((hit) => {
      try { checkNavigationUrl(hit.url); return new URL(hit.url).hostname !== 'search.brave.com' } catch { return false }
    })
  }

  url(): string {
    return this.page.url()
  }

  title(): Promise<string> {
    return this.page.title()
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    await this.page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' })
  }

  async back(timeoutMs: number): Promise<void> {
    const before = this.page.url()
    try {
      await this.page.goBack({ timeout: timeoutMs, waitUntil: 'domcontentloaded' })
    } catch {
      throw new Error('There is no earlier page in this tab.')
    }
    if (this.page.url() === before) throw new Error('There is no earlier page in this tab.')
  }

  async close(): Promise<void> {
    await this.page.close()
  }

  async text(limit: number): Promise<string> {
    const body = await this.page.locator('body').innerText({ timeout: BROWSER_ACTION_TIMEOUT_MS }).catch(() => '')
    return stripPasswordLines(body).slice(0, limit)
  }

  async links(limit: number): Promise<{ text: string; href: string }[]> {
    return this.page.locator('a[href]').evaluateAll((anchors, max) => {
      const links: { text: string; href: string }[] = []
      for (const anchor of anchors) {
        const href = anchor.getAttribute('href') ?? ''
        if (!href || /^javascript:/i.test(href)) continue
        const text = (anchor as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 120)
        links.push({ text: text || href, href })
        if (links.length >= max) break
      }
      return links
    }, limit).catch(() => [])
  }

  async html(limit: number): Promise<string> {
    const html = await this.page.content()
    return html.slice(0, limit)
  }

  /**
   * Lists interactive elements across the page, its open shadow roots and its visible frames.
   * Each frame takes two round trips however many elements it has.
   */
  async observe(limit: number): Promise<RawControl[]> {
    this.release()
    const top = this.page.mainFrame()
    const topOrigin = frameOrigin(top)
    const viewport = await top.evaluate(() => ({ width: innerWidth, height: innerHeight })).catch(() => null)
    const controls: RawControl[] = []
    for (const frame of this.page.frames().slice(0, BROWSER_FRAME_LIMIT)) {
      if (controls.length >= limit) break
      const offset = frame === top ? { x: 0, y: 0 } : await frameBox(frame)
      if (!offset) continue
      const origin = frameOrigin(frame)
      for (const { handle, described } of await this.scan(frame, limit - controls.length).catch(() => [])) {
        const { box: inner, ...control } = described
        const box = inner && { ...inner, x: inner.x + offset.x, y: inner.y + offset.y }
        // Sites usually hide the real file chooser behind a styled button, so it counts as on screen.
        const onScreen = box ? Boolean(viewport && box.x + box.width > 0 && box.y + box.height > 0 && box.x < viewport.width && box.y < viewport.height) : control.inputType === 'file'
        this.entries.push({ handle, frame, box })
        controls.push({ ...control, onScreen, ...(origin !== topOrigin ? { frame: origin } : {}) })
      }
    }
    return controls
  }

  async controlAt(index: number): Promise<RawControl | null> {
    const entry = this.entries[index]
    if (!entry || entry.frame.isDetached()) return null
    try {
      const [described] = await entry.frame.evaluate(describeControls, [entry.handle])
      if (!described) return null
      const { box: _box, ...control } = described
      const origin = frameOrigin(entry.frame)
      return { ...control, ...(origin !== frameOrigin(this.page.mainFrame()) ? { frame: origin } : {}) }
    } catch {
      return null
    }
  }

  async press(index: number, timeoutMs: number): Promise<void> {
    await this.entry(index).handle.click({ timeout: timeoutMs })
  }

  async typeInto(index: number, value: string, timeoutMs: number): Promise<void> {
    await this.entry(index).handle.fill(value, { timeout: timeoutMs })
  }

  async pressKey(index: number | null, key: string, timeoutMs: number): Promise<void> {
    if (index !== null) {
      await this.entry(index).handle.press(key, { timeout: timeoutMs })
      return
    }
    const focus = await this.page.evaluate(focusedField)
    if (focus === 'frame') throw new Error('Focus is inside an embedded frame. Pass the element reference so Riot Bot can check which website receives the key.')
    if (focus === 'password' && [...(key.split('+').at(-1) ?? '')].length === 1) {
      throw new Error('Characters are not typed into password fields from chat. Use a saved login, or take over the browser and type it yourself.')
    }
    await this.page.keyboard.press(key)
  }

  async selectOption(index: number, option: string, timeoutMs: number): Promise<{ chosen: string } | { choices: string[] }> {
    const { handle } = this.entry(index)
    const match = await handle.evaluate(matchOption, option)
    if ('choices' in match) return match
    await handle.selectOption({ index: match.index }, { timeout: timeoutMs })
    return { chosen: match.label }
  }

  async hover(index: number, timeoutMs: number): Promise<void> {
    await this.entry(index).handle.hover({ timeout: timeoutMs })
  }

  async drag(from: number, to: number, timeoutMs: number): Promise<void> {
    const source = this.entry(from).handle
    const target = this.entry(to).handle
    await source.hover({ timeout: timeoutMs })
    await this.page.mouse.down()
    try {
      await target.hover({ timeout: timeoutMs })
    } finally {
      await this.page.mouse.up()
    }
  }

  async waitFor(condition: WaitCondition, timeoutMs: number): Promise<boolean> {
    try {
      if (condition.urlContains) {
        const part = condition.urlContains
        await this.page.waitForURL((url) => url.href.includes(part), { timeout: timeoutMs, waitUntil: 'commit' })
      }
      if (condition.text || condition.gone) {
        const wanted = { text: condition.text?.toLowerCase() ?? '', gone: condition.gone?.toLowerCase() ?? '' }
        await this.page.waitForFunction(pageShows, wanted, { timeout: timeoutMs, polling: 250 })
      }
      if (!condition.urlContains && !condition.text && !condition.gone) await this.page.waitForTimeout(timeoutMs)
      return true
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') return false
      throw error
    }
  }

  async screenshot(labels: { index: number; ref: string }[]): Promise<string> {
    const marks = labels.flatMap(({ index, ref }) => {
      const box = this.entries[index]?.box
      return box ? [{ ref, ...box }] : []
    })
    const overlay = marks.length ? await this.page.mainFrame().evaluateHandle(drawLabels, marks).catch(() => null) : null
    try {
      const image = await this.page.screenshot({ type: 'jpeg', quality: 70, scale: 'css', timeout: BROWSER_ACTION_TIMEOUT_MS })
      return `data:image/jpeg;base64,${image.toString('base64')}`
    } finally {
      await overlay?.evaluate((host) => host.remove()).catch(() => undefined)
      await overlay?.dispose().catch(() => undefined)
    }
  }

  async upload(index: number, file: UploadFile, timeoutMs: number): Promise<void> {
    await this.entry(index).handle.setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer }, { timeout: timeoutMs })
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    await this.page.mouse.wheel(0, direction === 'up' ? -600 : 600)
  }

  async during<T>(policy: ActionPolicy, work: () => Promise<T>): Promise<ActionReport<T>> {
    // Anything that happened since the last action, such as a late download, is reported with this one.
    const carried = { notes: this.notes.splice(0), downloads: this.downloads.splice(0) }
    this.policy = policy
    try {
      const value = await work()
      await this.page.waitForTimeout(ACTION_SETTLE_MS).catch(() => undefined)
      return { value, notes: [...carried.notes, ...this.notes.splice(0)], downloads: [...carried.downloads, ...this.downloads.splice(0)] }
    } catch (error) {
      this.notes.unshift(...carried.notes)
      this.downloads.unshift(...carried.downloads)
      throw error
    } finally {
      if (policy.keepDownloads) this.graceUntil = Date.now() + DOWNLOAD_GRACE_MS
      this.policy = null
    }
  }

  /** Alerts are acknowledged. A dialog that asks for a decision is declined unless the current action allows it. */
  private async answer(dialog: Dialog): Promise<void> {
    const type = dialog.type()
    const accept = type === 'alert' || Boolean(this.policy?.acceptDialogs)
    const answer = type === 'prompt' ? this.policy?.dialogText ?? dialog.defaultValue() : undefined
    try {
      if (accept) await dialog.accept(answer)
      else await dialog.dismiss()
    } catch {
      // The page closed or answered the dialog itself.
    }
    const message = dialog.message().replace(/\s+/g, ' ').trim().slice(0, 300)
    const kind = type === 'beforeunload' ? 'leave-page' : type
    const outcome = type === 'alert' ? 'acknowledged' : accept ? 'accepted' : 'dismissed. To accept it, repeat the action with accept_dialog set to true'
    this.note(`The page showed a ${kind} dialog${message ? `: "${message}"` : ''}. It was ${outcome}.`)
  }

  private receive(download: Download): void {
    const name = download.suggestedFilename()
    const wanted = this.policy ? this.policy.keepDownloads : Date.now() < this.graceUntil
    if (wanted && this.downloads.length < DOWNLOADS_PER_ACTION) {
      this.downloads.push({
        name,
        url: download.url(),
        file: (timeoutMs) => withTimeout(download.path(), timeoutMs, 'The download did not finish in time.'),
        discard: async () => {
          await download.cancel().catch(() => undefined)
          await download.delete().catch(() => undefined)
        }
      })
      return
    }
    void download.cancel().catch(() => undefined)
    this.note(`The page started a download (${name.slice(0, 120)}) that was not part of a click or key press, so it was cancelled.`)
  }

  private note(text: string): void {
    if (this.notes.length < NOTE_LIMIT) this.notes.push(text)
  }

  private entry(index: number): Entry {
    const entry = this.entries[index]
    if (!entry) throw new Error(STALE_REFERENCE)
    return entry
  }

  private async scan(frame: Frame, max: number): Promise<{ handle: ElementHandle<Element>; described: Described }[]> {
    const list = await frame.evaluateHandle(collectControls, max)
    try {
      const described = await frame.evaluate(describeControls, list)
      const properties = await list.getProperties()
      return described.flatMap((item, index) => {
        const handle = properties.get(String(index))?.asElement() as ElementHandle<Element> | null | undefined
        return item && handle ? [{ handle, described: item }] : []
      })
    } finally {
      await list.dispose().catch(() => undefined)
    }
  }

  private release(): void {
    for (const entry of this.entries) void entry.handle.dispose().catch(() => undefined)
    this.entries = []
  }
}

/** The origin a frame's content belongs to. about:, data: and srcdoc frames belong to their parent. */
function frameOrigin(frame: Frame): string {
  for (let current: Frame | null = frame; current; current = current.parentFrame()) {
    try {
      const origin = new URL(current.url()).origin
      if (origin !== 'null') return origin
    } catch {
      // Keep looking at the parent.
    }
  }
  return 'null'
}

/** Where a child frame sits in the visible page, or null when it is too small to use. */
async function frameBox(frame: Frame): Promise<{ x: number; y: number } | null> {
  try {
    const element = await frame.frameElement()
    try {
      const box = await element.boundingBox()
      return box && box.width > 1 && box.height > 1 ? box : null
    } finally {
      await element.dispose()
    }
  } catch {
    return null
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

function stripPasswordLines(value: string): string {
  return value
    .split('\n')
    .filter((line) => !/password\s*[:=]/i.test(line))
    .join('\n')
}

// The functions below run inside the page. They must not use anything from this module's scope.

/** Interactive elements in one frame, in document order, including open shadow roots. */
function collectControls(max: number): Element[] {
  const selector = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'textarea', 'select', 'summary', '[contenteditable=""]', '[contenteditable="true"]',
    ...['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'treeitem'].map((role) => `[role="${role}"]`)
  ].join(',')
  const found: Element[] = []
  const pointer = (element: Element | null): boolean => Boolean(element) && getComputedStyle(element as Element).cursor === 'pointer'
  const visible = (element: Element): boolean => {
    if (element instanceof HTMLInputElement && element.type === 'file') return true
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(element)
    return style.visibility !== 'hidden' && style.visibility !== 'collapse'
  }
  // Script-driven controls without a role: the outermost element showing a pointer cursor, or one with a click handler.
  const clickable = (element: Element): boolean => {
    if (['HTML', 'BODY', 'LABEL'].includes(element.tagName)) return false
    const handled = element.hasAttribute('onclick') || (element.hasAttribute('tabindex') && (element as HTMLElement).tabIndex >= 0)
    if (!handled && !(pointer(element) && !pointer(element.parentElement))) return false
    return !element.querySelector(selector)
  }
  const visit = (root: Document | ShadowRoot): void => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node && found.length < max; node = walker.nextNode()) {
      const element = node as Element
      if ((element.matches(selector) || clickable(element)) && visible(element)) found.push(element)
      if (element.shadowRoot) visit(element.shadowRoot)
    }
  }
  visit(document)
  return found
}

/** Role, name, state and position of each element. Returns null for an element that left the page. */
function describeControls(elements: Element[]): (Described | null)[] {
  const clean = (text: string | null | undefined, max = 80): string => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const buttonTypes = ['button', 'submit', 'reset', 'image']
  const inputRoles: Record<string, string> = { button: 'button', submit: 'button', reset: 'button', image: 'button', checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox', file: 'upload' }
  const valueTypes = ['text', 'search', 'email', 'url', 'tel', 'number', 'date', 'datetime-local', 'month', 'week', 'time', 'color', 'range']
  let focused = document.activeElement
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement
  return elements.map((element) => {
    if (!element.isConnected) return null
    const html = element as HTMLElement
    const tag = element.tagName.toLowerCase()
    const input = element instanceof HTMLInputElement ? element : null
    const select = element instanceof HTMLSelectElement ? element : null
    const textarea = element instanceof HTMLTextAreaElement ? element : null
    const field = input ?? select ?? textarea
    const type = input ? input.type.toLowerCase() : ''
    const attr = (name: string): string => element.getAttribute(name) ?? ''
    const aria = (name: string): string => attr(`aria-${name}`).toLowerCase()
    const role = attr('role').trim().split(/\s+/)[0].toLowerCase() || (
      tag === 'a' ? 'link'
        : tag === 'button' || tag === 'summary' ? 'button'
          : select ? (select.multiple || select.size > 1 ? 'listbox' : 'combobox')
            : textarea ? 'textbox'
              : input ? inputRoles[type] ?? 'textbox'
                : html.isContentEditable ? 'textbox'
                  : 'clickable')
    // Text-entry elements are not named by their contents, which change as text is typed.
    const entry = Boolean(textarea || select || html.isContentEditable || (input && !buttonTypes.includes(type) && !['checkbox', 'radio', 'file'].includes(type)) || ['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider'].includes(role))
    const root = element.getRootNode() as Document | ShadowRoot
    const labelledBy = attr('aria-labelledby').split(/\s+/).filter(Boolean).map((id) => root.getElementById(id)?.textContent ?? '').join(' ')
    const labels = field?.labels ? [...field.labels].map((label) => label.innerText).join(' ') : ''
    const name = type === 'password' ? 'password field' : clean(attr('aria-label')) || clean(labelledBy) || clean(labels)
      || (entry ? '' : clean(html.innerText))
      || clean(attr('placeholder')) || clean(attr('title'))
      || (input && buttonTypes.includes(type) ? clean(input.value) : '')
      || clean(attr('alt')) || clean(element.querySelector('img[alt]')?.getAttribute('alt')) || clean(element.querySelector('svg title')?.textContent)
      || clean(attr('name'))
    const href = element instanceof HTMLAnchorElement && /^https?:/i.test(element.href) ? element.href.slice(0, 300) : ''
    const states: string[] = []
    if (input && (type === 'checkbox' || type === 'radio')) states.push(input.indeterminate ? 'partly checked' : input.checked ? 'checked' : 'not checked')
    else if (aria('checked')) states.push(aria('checked') === 'true' ? 'checked' : aria('checked') === 'mixed' ? 'partly checked' : 'not checked')
    if (aria('pressed')) states.push(aria('pressed') === 'true' ? 'pressed' : 'not pressed')
    if (aria('selected') === 'true') states.push('selected')
    const expanded = tag === 'summary' && element.parentElement instanceof HTMLDetailsElement ? String(element.parentElement.open) : aria('expanded')
    if (expanded) states.push(expanded === 'true' ? 'expanded' : 'collapsed')
    if (element.matches(':disabled') || aria('disabled') === 'true') states.push('disabled')
    if ((input ?? textarea)?.readOnly || aria('readonly') === 'true') states.push('read-only')
    if (field?.required || aria('required') === 'true') states.push('required')
    let invalid = aria('invalid') === 'true'
    try { invalid ||= element.matches(':user-invalid') } catch { /* Older engines do not know :user-invalid. */ }
    if (invalid) states.push('invalid')
    if (aria('current') && aria('current') !== 'false') states.push('current')
    if (focused === element) states.push('focused')
    // Values of password, payment and one-time-code fields stay out of the model's view.
    const hint = `${attr('autocomplete')} ${attr('name')} ${element.id} ${name}`.toLowerCase()
    const secret = type === 'password' || /cc-|one-time-code|password|card.?(?:number|num|no)|cvc|cvv|security.?code|\bpin\b|otp|ssn|social.?security/.test(hint)
    let value = ''
    if (secret) {
      if ((input ?? textarea)?.value) states.push('filled')
    } else if (input && valueTypes.includes(type)) value = input.value
    else if (textarea) value = textarea.value
    else if (html.isContentEditable && role === 'textbox') value = html.innerText
    else value = attr('aria-valuetext') || attr('aria-valuenow')
    value = clean(value, 120)
    const options = select ? {
      labels: [...select.options].slice(0, 300).map((option) => clean(option.label || option.text, 60)),
      selected: [...select.selectedOptions].map((option) => clean(option.label || option.text, 60)),
      total: select.options.length
    } : undefined
    const rect = element.getBoundingClientRect()
    const box = rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
    return { role, name, inputType: type, href, states, ...(value ? { value } : {}), ...(options ? { options } : {}), box }
  })
}

/** The best option for a requested label or value: exact label, exact value, then partial label. */
function matchOption(element: Element, wanted: string): { index: number; label: string } | { choices: string[] } {
  const options = element instanceof HTMLSelectElement ? [...element.options] : []
  const clean = (text: string): string => text.replace(/\s+/g, ' ').trim()
  const goal = clean(wanted).toLowerCase()
  const label = (option: HTMLOptionElement): string => clean(option.label || option.text)
  const index = goal ? [
    options.findIndex((option) => label(option).toLowerCase() === goal),
    options.findIndex((option) => clean(option.value).toLowerCase() === goal),
    options.findIndex((option) => label(option).toLowerCase().includes(goal))
  ].find((found) => found >= 0 && !options[found].disabled) : undefined
  if (index === undefined) return { choices: options.filter((option) => !option.disabled).slice(0, 25).map(label) }
  return { index, label: label(options[index]) }
}

/** What has keyboard focus, as far as a key press is concerned. */
function focusedField(): 'frame' | 'password' | 'other' {
  let focused = document.activeElement
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement
  if (focused instanceof HTMLIFrameElement || focused?.tagName === 'FRAME') return 'frame'
  return focused instanceof HTMLInputElement && focused.type === 'password' ? 'password' : 'other'
}

function pageShows(wanted: { text: string; gone: string }): boolean {
  const body = (document.body?.innerText ?? '').toLowerCase()
  return (!wanted.text || body.includes(wanted.text)) && (!wanted.gone || !body.includes(wanted.gone))
}

/** Outlines each element and tags it with its reference, in a layer the page's own styles cannot reach. */
function drawLabels(marks: { ref: string; x: number; y: number; width: number; height: number }[]): HTMLElement {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  const layer = host.attachShadow({ mode: 'closed' })
  for (const mark of marks) {
    const outline = document.createElement('div')
    outline.style.cssText = `position:fixed;left:${mark.x}px;top:${mark.y}px;width:${mark.width}px;height:${mark.height}px;outline:2px solid rgba(214,51,132,.9);outline-offset:-1px`
    const tag = document.createElement('span')
    tag.textContent = mark.ref
    tag.style.cssText = `position:absolute;left:-2px;top:${mark.y < 16 ? 0 : -16}px;padding:0 3px;font:600 11px/15px system-ui,sans-serif;color:#fff;background:rgba(214,51,132,.95);border-radius:3px;white-space:nowrap`
    outline.append(tag)
    layer.append(outline)
  }
  document.documentElement.append(host)
  return host
}
