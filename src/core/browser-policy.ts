import { isBlockedHostname, isPrivateAddress, validatePublicUrl } from './web'

export const DEFAULT_SEARCH_TEMPLATE = 'https://html.duckduckgo.com/html/?q={query}'
export const GOOGLE_SEARCH_TEMPLATE = 'https://www.google.com/search?q={query}&hl=en&gl=us&pws=0'
export const CHROMIUM_DOWNLOAD_NOTE =
  'Riot Bot can use installed Chrome or Edge with a separate bot profile. Chromium is an optional download of a few hundred megabytes. It starts only when you choose Install Chromium and is not a model charge.'

export function googleSearchRequested(text: string): boolean {
  return /\bgoogle\s+(?:search|results?|rank(?:ing)?|position)\b|\b(?:on|using|with)\s+google\b/i.test(text)
}

export const MAX_BROWSER_ACTIONS = 12
export const MAX_BROWSER_TABS = 5
export const BROWSER_NAV_TIMEOUT_MS = 20_000
export const BROWSER_ACTION_TIMEOUT_MS = 8_000
export const BROWSER_TEXT_LIMIT = 4_000
/** Local page text kept for read_tool_result. The model request gets a shorter preview. */
export const BROWSER_STORED_TEXT_LIMIT = 20_000
export const BROWSER_SNAPSHOT_LIMIT = 40
export const BROWSER_LINK_LIMIT = 8
export const BROWSER_RESULT_LIMIT = 8

const CONSEQUENTIAL = /\b(send|submit|pay|buy|purchase|delete|remove|publish|post|order|confirm|upload|checkout|subscribe|transfer|log out|sign out)\b/i

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
  return /captcha|unusual traffic|are you a robot|verify you are human|access denied|enable javascript/i.test(`${title}\n${text.slice(0, 1500)}`)
}

export function clickNeedsApproval(control: { role: string; name: string; inputType: string }, pageUrl: string, template: string): boolean {
  if (control.inputType === 'file' || control.inputType === 'password') return false
  const name = control.name || ''
  let pageHost = ''
  try {
    pageHost = new URL(pageUrl).hostname
  } catch {
    pageHost = ''
  }
  const host = searchHost(template)
  if (host && pageHost === host && /\b(search|find|submit)\b/i.test(name) && !/\b(delete|pay|buy|purchase|publish|post|order)\b/i.test(name)) return false
  // A generic button can submit a form even when its label says "Continue".
  return CONSEQUENTIAL.test(name) || (control.role !== 'link' && control.role !== 'textbox' && control.role !== 'searchbox')
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
