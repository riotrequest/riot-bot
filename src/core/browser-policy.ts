import { isBlockedHostname, isPrivateAddress, validatePublicUrl } from './web'

export const DEFAULT_SEARCH_TEMPLATE = 'https://search.brave.com/search?q={query}'
export const DUCKDUCKGO_SEARCH_TEMPLATE = 'https://html.duckduckgo.com/html/?q={query}'
export const GOOGLE_SEARCH_TEMPLATE = 'https://www.google.com/search?q={query}&hl=en&gl=us&pws=0'
export const CHROMIUM_DOWNLOAD_NOTE =
  'Riot Bot can use installed Chrome or Edge with a separate bot profile. Chromium is an optional download of a few hundred megabytes. It starts only when you choose Install Chromium and is not a model charge.'

export function googleSearchRequested(text: string): boolean {
  if (/\b(?:forget|skip|avoid|don['’]?t use|instead of)\s+google\b|\b(?:brave|duckduckgo)\s+(?:instead|rather)\b/i.test(text)) return false
  return /\bgoogle\s+(?:search|results?|rank(?:ing)?|position)\b|\b(?:search|on|using|with|use)\s+google\b/i.test(text)
}

export function requestedSearchEngine(text: string): SearchEngine | null {
  if (/\b(?:forget|skip|avoid|don['’]?t use|instead of)\s+google\b/i.test(text)) return /\bduckduckgo\b/i.test(text) ? 'duckduckgo' : 'brave'
  if (googleSearchRequested(text)) return 'google'
  if (/\bbrave\b/i.test(text) && /\b(search|use|using|with|instead)\b/i.test(text)) return 'brave'
  if (/\bduckduckgo\b/i.test(text) && /\b(search|use|using|with|instead)\b/i.test(text)) return 'duckduckgo'
  return null
}

export type SearchEngine = 'google' | 'brave' | 'duckduckgo'

export function searchEngineFor(url: string): SearchEngine | null {
  try {
    const host = new URL(url).hostname
    if (host === 'google.com' || host === 'www.google.com') return 'google'
    if (host === 'search.brave.com') return 'brave'
    if (host === 'html.duckduckgo.com' || host === 'duckduckgo.com') return 'duckduckgo'
  } catch { /* not a search URL */ }
  return null
}

/** Default browser actions per task. Each bot can change it under Bot settings → Limits. */
export const DEFAULT_BROWSER_ACTIONS = 50
export const MIN_BROWSER_ACTIONS = 5
export const MAX_BROWSER_ACTIONS = 200
export const MAX_BROWSER_TABS = 8
export const BROWSER_NAV_TIMEOUT_MS = 20_000
export const BROWSER_ACTION_TIMEOUT_MS = 8_000
export const BROWSER_TEXT_LIMIT = 4_000
/** Local page text kept for read_tool_result. The model request gets a shorter preview. */
export const BROWSER_STORED_TEXT_LIMIT = 20_000
/** Elements a snapshot examines across the page and its frames. */
export const BROWSER_SCAN_LIMIT = 400
/** Elements a snapshot lists. On-screen elements come first; a query reaches the rest. */
export const BROWSER_SNAPSHOT_LIMIT = 80
export const BROWSER_FRAME_LIMIT = 12
export const BROWSER_LINK_LIMIT = 20
export const BROWSER_RESULT_LIMIT = 8
export const BROWSER_WAIT_LIMIT_MS = 20_000
export const BROWSER_DOWNLOAD_TIMEOUT_MS = 60_000

const NAVIGATION_KEYS = ['Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']
const ACTIVATING_KEYS = ['Enter', 'Space', 'Backspace', 'Delete']
const KEY_NAMES = new Map([...NAVIGATION_KEYS, ...ACTIVATING_KEYS].map((key) => [key.toLowerCase(), key]))
for (const [alias, key] of [['esc', 'Escape'], ['return', 'Enter'], ['up', 'ArrowUp'], ['down', 'ArrowDown'], ['left', 'ArrowLeft'], ['right', 'ArrowRight'], ['spacebar', 'Space'], ['del', 'Delete']] as const) KEY_NAMES.set(alias, key)
const MODIFIERS = new Map([['control', 'Control'], ['ctrl', 'Control'], ['shift', 'Shift'], ['alt', 'Alt'], ['meta', 'Meta']])

/**
 * Normalizes a key the model asked to press into Playwright's spelling, or returns null.
 * `activates` is false only for unmodified navigation keys, which move focus or scroll
 * without sending or changing anything on the site.
 */
export function browserKey(value: string): { key: string; activates: boolean } | null {
  const parts = value.trim().split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0 || parts.length > 3) return null
  const last = parts.pop()!
  const modifiers: string[] = []
  for (const part of parts) {
    const modifier = MODIFIERS.get(part.toLowerCase())
    if (!modifier || modifiers.includes(modifier)) return null
    modifiers.push(modifier)
  }
  const named = KEY_NAMES.get(last.toLowerCase())
  const key = named ?? ([...last].length === 1 ? last : null)
  if (!key) return null
  const navigation = NAVIGATION_KEYS.includes(key) && (modifiers.length === 0 || (key === 'Tab' && modifiers.join() === 'Shift'))
  return { key: [...modifiers, key].join('+'), activates: !navigation }
}


export function checkNavigationUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('That web address is not valid.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only public http and https addresses can be opened.')
  }
  if (url.username || url.password) throw new Error('Addresses with a username or password are not allowed.')
  if (isBlockedHostname(url.hostname)) throw new Error('Local and private network addresses are blocked.')
  return url
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '127.0.0.1' || host.startsWith('127.')
}

export function isLoopbackAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip.toLowerCase()
  return mapped === '::1' || mapped === '127.0.0.1' || mapped.startsWith('127.')
}

/** Connection check used by the local browser proxy. allowLoopback is test-only and defaults off. */
export function browserDestinationBlocked(hostname: string, addresses: string[], allowLoopback = false): string | null {
  if (allowLoopback && isLoopbackHost(hostname) && addresses.length > 0 && addresses.every((address) => isLoopbackAddress(address))) return null
  if (isBlockedHostname(hostname)) return 'Local and private network addresses are blocked.'
  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
    return 'That host points at a local or private network address, so it was not opened.'
  }
  return null
}

export function navigationBlocked(value: string): string | null {
  try {
    const url = checkNavigationUrl(value)
    validatePublicUrl(url.toString())
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'That address is blocked.'
  }
}

export function searchPageUrl(template: string, query: string): string {
  const pattern = template.includes('{query}') ? template : DEFAULT_SEARCH_TEMPLATE
  return pattern.replaceAll('{query}', encodeURIComponent(query.trim()))
}

export function searchHost(template: string): string {
  try {
    return new URL(searchPageUrl(template, 'test')).hostname
  } catch {
    return ''
  }
}

export interface SearchHit {
  title: string
  url: string
  snippet: string
  displayUrl?: string
}

/** Google may expose an opaque /goto link; keep that observed link and its displayed URL. */
export function googleResultTarget(href: string): string | null {
  try {
    let target = new URL(href)
    const google = target.hostname === 'google.com' || target.hostname.endsWith('.google.com')
    if (google) {
      if (target.pathname === '/url') {
        const direct = target.searchParams.get('q') || target.searchParams.get('url')
        if (!direct || !/^https?:\/\//i.test(direct)) return null
        target = new URL(direct)
        if (target.hostname === 'google.com' || target.hostname.endsWith('.google.com')) return null
      } else if (target.pathname !== '/goto' || !target.searchParams.get('url')) return null
    }
    return navigationBlocked(target.toString()) ? null : target.toString()
  } catch { return null }
}

export function extractSearchResults(html: string, limit = BROWSER_RESULT_LIMIT): SearchHit[] {
  const hits: SearchHit[] = []
  const pattern = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(pattern)) {
    const url = resultDestination(match[1] ?? '')
    const title = cleanHtml(match[2] ?? '')
    const snippet = cleanHtml(match[3] ?? '')
    if (!url || !title) continue
    if (navigationBlocked(url)) continue
    hits.push({ title: title.slice(0, 180), url, snippet: snippet.slice(0, 220) })
    if (hits.length >= limit) break
  }
  return hits
}

export function looksLikeSearchBlock(title: string, text: string, resultCount: number): boolean {
  if (resultCount > 0) return false
  return /captcha|unusual traffic|are you a robot|verify (?:that )?you are human|access denied|enable javascript|complete the (?:following )?challenge|proof.of.work/i.test(`${title}\n${text.slice(0, 1500)}`)
}

export function clickNeedsApproval(_control: { role: string; name: string; inputType: string }, pageUrl: string, _template: string, trustedSites:string[]=[]): boolean {
  try{return !trustedSites.includes(new URL(pageUrl).origin)}catch{return true}
}

export function cleanHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits)
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function resultDestination(href: string): string {
  const decoded = cleanHtml(href)
  const absolute = decoded.startsWith('//') ? `https:${decoded}` : decoded
  try {
    const url = new URL(absolute)
    const embedded = url.searchParams.get('uddg')
    if (embedded && !navigationBlocked(embedded)) return embedded
    if (navigationBlocked(url.toString())) return ''
    return url.toString()
  } catch {
    return ''
  }
}
