import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { Locator, Page } from 'playwright-core'
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
  const args = ['--disable-features=WebRTC']
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
  if (!browsersPath || !fs.existsSync(browsersPath)) return false
  return findChrome(browsersPath, 0)
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

function findChrome(dir: string, depth: number): boolean {
  if (depth > 4) return false
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return false
  }
  for (const name of entries) {
    const full = path.join(dir, name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (stat.isFile() && (name === 'chrome.exe' || name === 'chrome' || name === 'chromium')) return true
    if (stat.isDirectory() && findChrome(full, depth + 1)) return true
  }
  return false
}

export async function installChromium(browsersPath: string, onLine: (line: string) => void): Promise<void> {
  fs.mkdirSync(browsersPath, { recursive: true })
  const cli = playwrightCliPath()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true
    })
    const report = (chunk: Buffer): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) onLine(trimmed.slice(0, 240))
      }
    }
    child.stdout?.on('data', report)
    child.stderr?.on('data', report)
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error('Chromium installation did not finish. Nothing was installed into the app profile.'))
    })
  })
}

export async function openPlaywrightBrowser(input: { profileDir: string; proxyUrl: string; browsersPath: string }): Promise<LaunchedBrowser> {
  fs.mkdirSync(input.profileDir, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = input.browsersPath
  const { chromium } = await import('playwright-core')
  const executable = chromium.executablePath()
  const channel = fs.existsSync(executable) ? null : installedBrowserChannel()
  if (!fs.existsSync(executable) && !channel) {
    throw new Error('No supported browser is installed. Install Google Chrome or Microsoft Edge, or choose Install Chromium in the bot menu. No model call is needed for that setup.')
  }
  const options = chromiumLaunchOptions(input.proxyUrl)
  // Keep the app's cookies separate from personal profiles and from other browser versions.
  const profileDir = channel ? path.join(input.profileDir, channel) : input.profileDir
  const context = await chromium.launchPersistentContext(profileDir, { ...options, ...(channel ? { channel } : {}) })
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

class PlaywrightPage implements LaunchedPage {
  private locators: Locator[] = []

  constructor(private readonly page: Page) {}

  focus(): Promise<void> {
    return this.page.bringToFront()
  }

  async googleResults(limit: number): Promise<SearchHit[]> {
    await this.page.locator('#rso').waitFor({ state: 'attached', timeout: 3000 }).catch(() => undefined)
    const observed = await this.page.locator('#rso').evaluateAll((roots, max) => {
      const root = roots[0]
      if (!root) return []
      const cards = new Set<Element>()
      const results: { title: string; url: string; snippet: string; displayUrl: string }[] = []
      for (const heading of root.querySelectorAll('h3')) {
        const anchor = heading.closest('a[href]') as HTMLAnchorElement | null
        const card = heading.closest('div.MjjYud, div.g, div[data-sokoban-container]')
        if (!anchor || !card || cards.has(card) || heading.closest('#tads, #bottomads, [data-text-ad], [data-attrid]')) continue
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
    this.locators = []
    const locator = this.page.locator('a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="searchbox"]')
    const count = await locator.count()
    const found: RawControl[] = []
    for (let index = 0; index < count && found.length < limit; index += 1) {
      const item = locator.nth(index)
      if (!(await item.isVisible().catch(() => false))) continue
      const tag = ((await item.evaluate((element) => element.tagName)) as string).toLowerCase()
      const type = ((await item.getAttribute('type')) ?? '').toLowerCase()
      const roleAttr = ((await item.getAttribute('role')) ?? '').toLowerCase()
      const role = roleAttr || roleFromTag(tag, type)
      const name = type === 'password' ? 'password field' : await accessibleName(item)
      const href = tag === 'a' ? ((await item.getAttribute('href')) ?? '') : ''
      this.locators.push(item)
      found.push({ role, name, inputType: type, href })
    }
    return found
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

async function accessibleName(item: Locator): Promise<string> {
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

