import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { EventEmitter } from 'node:events'
import type { ElementHandle, Page } from 'playwright-core'
import { BROWSER_ACTION_TIMEOUT_MS, BROWSER_NAV_TIMEOUT_MS, checkNavigationUrl, googleResultTarget, type SearchHit } from './browser-policy'
import type { LaunchedBrowser, LaunchedPage, RawControl } from './browser'

export interface ChromiumLaunchOptions {
  headless: false
  chromiumSandbox: true
  acceptDownloads: false
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
    acceptDownloads: false,
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
    watch(page)
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

function watch(page: Page): void {
  page.setDefaultTimeout(BROWSER_ACTION_TIMEOUT_MS)
  page.setDefaultNavigationTimeout(BROWSER_NAV_TIMEOUT_MS)
  page.on('download', (download) => {
    void download.cancel()
  })
  page.on('dialog', (dialog) => {
    void dialog.dismiss()
  })
}

export class PlaywrightPage implements LaunchedPage {
  private locators: ElementHandle[] = []

  constructor(private readonly page: Page) {}

  focus(): Promise<void> {
    return this.page.bringToFront()
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
    const anchors = this.page.locator('a[href]')
    const count = Math.min(await anchors.count(), limit * 3)
    const links: { text: string; href: string }[] = []
    for (let index = 0; index < count && links.length < limit; index += 1) {
      const item = anchors.nth(index)
      const href = (await item.getAttribute('href')) ?? ''
      const text = (await item.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!href || href.startsWith('javascript:')) continue
      links.push({ text: text || href, href })
    }
    return links
  }

  async html(limit: number): Promise<string> {
    const html = await this.page.content()
    return html.slice(0, limit)
  }

  async observe(limit: number): Promise<RawControl[]> {
    for(const handle of this.locators)void handle.dispose().catch(()=>undefined)
    this.locators = []
    const locator = this.page.locator('a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="searchbox"]')
    const count = await locator.count()
    const found: RawControl[] = []
    for (let index = 0; index < count && found.length < limit; index += 1) {
      const item = await locator.nth(index).elementHandle()
      if(!item)continue
      if (!(await item.isVisible().catch(() => false))) {void item.dispose();continue}
      this.locators.push(item)
      const control=await this.controlAt(this.locators.length-1)
      if(control)found.push(control)
      else{this.locators.pop();void item.dispose()}
    }
    return found
  }

  async controlAt(index:number):Promise<RawControl|null>{
    const item=this.locators[index]
    if(!item||!await item.evaluate(element=>element.isConnected).catch(()=>false))return null
    const tag=(await item.evaluate(element=>(element as Element).tagName)).toLowerCase()
    const type=((await item.getAttribute('type'))??'').toLowerCase()
    const role=((await item.getAttribute('role'))??'').toLowerCase()||roleFromTag(tag,type)
    return {role,name:type==='password'?'password field':await accessibleName(item),inputType:type,href:tag==='a'?((await item.getAttribute('href'))??''):''}
  }

  async press(index: number, timeoutMs: number): Promise<void> {
    const locator = this.locators[index]
    if (!locator) throw new Error('That element reference is stale or unknown. Take a fresh page snapshot and use one of its references.')
    await locator.click({ timeout: timeoutMs })
  }

  async typeInto(index: number, value: string, timeoutMs: number): Promise<void> {
    const locator = this.locators[index]
    if (!locator) throw new Error('That element reference is stale or unknown. Take a fresh page snapshot and use one of its references.')
    await locator.fill(value, { timeout: timeoutMs })
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    await this.page.mouse.wheel(0, direction === 'up' ? -600 : 600)
  }
}

function roleFromTag(tag: string, type: string): string {
  if (tag === 'a') return 'link'
  if (tag === 'button' || type === 'submit' || type === 'button') return 'button'
  if (tag === 'textarea' || tag === 'select') return 'textbox'
  if (tag === 'input') return 'textbox'
  return tag || 'element'
}

async function accessibleName(item: ElementHandle): Promise<string> {
  const label = (await item.getAttribute('aria-label')) || (await item.getAttribute('placeholder')) || (await item.getAttribute('title')) || ''
  const text = label || (await item.innerText().catch(() => '')) || (await item.getAttribute('name')) || ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function stripPasswordLines(value: string): string {
  return value
    .split('\n')
    .filter((line) => !/password\s*[:=]/i.test(line))
    .join('\n')
}

