import http from 'http'
import https from 'https'
import net from 'net'
import tls from 'tls'
import type { LookupAddress, LookupOptions } from 'dns'
import { ConfigError, ProviderError } from './errors'
import type { Logger } from './logger'
import type { ModelProvider } from './model'
import { createOpenAICompatibleProvider } from './provider'
import { defaultLookup, isBlockedHostname, isPrivateAddress } from './web'

/**
 * Hosts that may use plain http. Only this computer qualifies. LAN and private
 * addresses (for example a home Ollama server) are refused until the owner decides
 * how such a connection should be granted.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
/** `localhost` is pinned to these addresses instead of trusting the hosts file. */
const LOCALHOST_ADDRESSES = ['127.0.0.1', '::1']
/** A model reply larger than this is cut off. Streaming replies are far smaller in practice. */
export const CUSTOM_RESPONSE_LIMIT = 32 * 1024 * 1024
const MAX_URL_LENGTH = 500

export type CustomLookup = (hostname: string) => Promise<string[]>

export interface CustomEndpointRequest {
  /** Full request URL. It always has the configured endpoint's origin and path prefix. */
  url: URL
  /** Validated addresses for `url.hostname`. The connection must use only these. */
  addresses: string[]
  method: string
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
}

export type CustomEndpointTransport = (request: CustomEndpointRequest) => Promise<Response>

export function isLoopbackEndpointHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

function isLoopbackAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (net.isIP(value) === 4) return value.split('.')[0] === '127'
  return value === '::1'
}

/**
 * Validates and normalizes a custom endpoint base URL. Returns '' for a blank value.
 * Plain http is accepted only for localhost, 127.0.0.1 and [::1]. Every other address
 * must be https to a public host name or public IP address. DNS is checked separately,
 * immediately before each request.
 */
export function normalizeCustomBaseUrl(value: unknown): string {
  if (value == null) return ''
  if (typeof value !== 'string') throw new ConfigError('Enter the endpoint address as text.')
  const text = value.trim()
  if (!text) return ''
  if (text.length > MAX_URL_LENGTH || /[\s\0]/.test(text)) throw new ConfigError('Enter one endpoint address, such as http://localhost:11434/v1.')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new ConfigError('That endpoint address is not valid. Include http:// or https://, for example http://localhost:11434/v1.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigError('Use an http:// or https:// endpoint address.')
  if (url.username || url.password) throw new ConfigError('Remove the username or password from the endpoint address. Save an API key separately instead.')
  if (url.search || url.hash || text.includes('?') || text.includes('#')) throw new ConfigError('Remove the ? or # part from the endpoint address. Save an API key separately instead.')
  const loopback = isLoopbackEndpointHost(url.hostname)
  if (url.protocol === 'http:' && !loopback) {
    throw new ConfigError('Plain http:// is only allowed for a model server on this computer (localhost, 127.0.0.1 or [::1]). Use https:// for any other server. Servers on your home or office network are not supported yet.')
  }
  if (!loopback && isBlockedHostname(url.hostname)) {
    throw new ConfigError('That endpoint is on a local or private network. Riot Bot connects only to a model server on this computer or to a public https:// address.')
  }
  // A pasted full chat URL is reduced to its base; Riot adds /chat/completions itself.
  const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${path}`
}

/**
 * Builds the provider for a saved custom endpoint. The key is optional; when present it is sent
 * only to that endpoint, as an Authorization header, after the address and DNS checks pass.
 */
export function createCustomEndpointProvider(options: { baseUrl: string; apiKey?: string | null; lookupHost?: CustomLookup; transport?: CustomEndpointTransport; logger?: Logger }): ModelProvider {
  const baseUrl = normalizeCustomBaseUrl(options.baseUrl)
  if (!baseUrl) throw new ConfigError('Enter your model server address in app Settings → Connections. Riot Bot does not choose another connection for you.')
  return createOpenAICompatibleProvider({
    name: 'custom',
    baseUrl,
    apiKey: options.apiKey,
    logger: options.logger,
    fetchImpl: createCustomEndpointFetch({ baseUrl, lookupHost: options.lookupHost, transport: options.transport })
  })
}

/** Resolves the addresses a request may connect to. Throws without contacting the endpoint when they are not allowed. */
export async function resolveCustomEndpoint(url: URL, lookupHost: CustomLookup = defaultLookup): Promise<string[]> {
  const hostname = url.hostname.toLowerCase()
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (isLoopbackEndpointHost(hostname)) {
    if (hostname === 'localhost') return [...LOCALHOST_ADDRESSES]
    if (!isLoopbackAddress(bare)) throw refusal('That endpoint is not on this computer, so nothing was sent.')
    return [bare]
  }
  if (url.protocol !== 'https:') throw refusal('Plain http:// is only allowed for a model server on this computer, so nothing was sent.')
  if (isBlockedHostname(hostname)) throw refusal('That endpoint is on a local or private network, so nothing was sent.')
  let addresses: string[]
  if (net.isIP(bare)) addresses = [bare]
  else {
    try {
      addresses = await lookupHost(bare)
    } catch {
      throw new ProviderError('transient', 'The endpoint address could not be resolved, so nothing was sent. Check the address and your internet connection.')
    }
  }
  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
    throw refusal('That endpoint resolves to a local or private network address, so nothing was sent. Only a server on this computer or a public https:// address can be used.')
  }
  return addresses
}

function refusal(message: string): ProviderError {
  return new ProviderError('unknown', message)
}

/**
 * A fetch function that can reach only the configured endpoint. It refuses any other origin
 * or path, rechecks the address and DNS before every request, never follows redirects, and
 * hands the transport only the validated addresses.
 */
export function createCustomEndpointFetch(options: { baseUrl: string; lookupHost?: CustomLookup; transport?: CustomEndpointTransport }): typeof fetch {
  const normalized = normalizeCustomBaseUrl(options.baseUrl)
  if (!normalized) throw new ConfigError('Enter your model server address in app Settings.')
  const base = new URL(normalized)
  const basePath = base.pathname.replace(/\/+$/, '')
  const lookupHost = options.lookupHost ?? defaultLookup
  const transport = options.transport ?? pinnedEndpointTransport
  const guarded = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (typeof input !== 'string' && !(input instanceof URL)) throw refusal('The model request was not addressed to the configured endpoint, so nothing was sent.')
    let target: URL
    try {
      target = new URL(String(input))
    } catch {
      throw refusal('The model request address was not valid, so nothing was sent.')
    }
    const insideBase = target.pathname === basePath || target.pathname.startsWith(`${basePath}/`)
    if (target.origin !== base.origin || !insideBase || target.username || target.password || target.search || target.hash) {
      throw refusal('The model request was not addressed to the configured endpoint, so nothing was sent.')
    }
    const signal = init?.signal ?? new AbortController().signal
    if (signal.aborted) throw new ProviderError('cancelled', 'Stopped before the request was sent.')
    const body = init?.body
    if (body != null && typeof body !== 'string') throw refusal('The model request body was not text, so nothing was sent.')
    const addresses = await resolveCustomEndpoint(target, lookupHost)
    if (signal.aborted) throw new ProviderError('cancelled', 'Stopped before the request was sent.')
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value })
    return transport({ url: target, addresses, method: init?.method ?? 'GET', headers, body: body ?? undefined, signal })
  }
  return guarded as typeof fetch
}

function caCertificates(): string[] | undefined {
  return typeof tls.getCACertificates === 'function' ? [...tls.getCACertificates('default'), ...tls.getCACertificates('system')] : undefined
}

function pinnedLookup(addresses: string[]) {
  const entries: LookupAddress[] = addresses.map((address) => ({ address, family: net.isIP(address) === 6 ? 6 : 4 }))
  return (_hostname: string, options: LookupOptions, callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void): void => {
    const family = options?.family === 6 || options?.family === 'IPv6' ? 6 : options?.family === 4 || options?.family === 'IPv4' ? 4 : 0
    const allowed = family ? entries.filter((entry) => entry.family === family) : entries
    if (allowed.length === 0) {
      const error: NodeJS.ErrnoException = new Error('No validated address is available for the endpoint.')
      error.code = 'ENOTFOUND'
      callback(error, '')
      return
    }
    if (options?.all) callback(null, allowed)
    else callback(null, allowed[0].address, allowed[0].family)
  }
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

/**
 * Sends one request over Node's http/https stack to the validated addresses only.
 * TLS still verifies the configured host name. Redirects are returned, never followed.
 */
export const pinnedEndpointTransport: CustomEndpointTransport = (request) => {
  const secure = request.url.protocol === 'https:'
  const hostname = request.url.hostname.replace(/^\[|\]$/g, '')
  const port = request.url.port ? Number(request.url.port) : secure ? 443 : 80
  const headers: Record<string, string> = { 'User-Agent': 'RiotBot/0.1', ...request.headers }
  if (request.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(request.body))
  return new Promise<Response>((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    const options: https.RequestOptions = {
      hostname,
      port,
      method: request.method,
      path: `${request.url.pathname || '/'}`,
      headers,
      agent: false,
      // Node tries each validated address in turn (autoSelectFamily is on by default), so
      // localhost reaches a server bound to either 127.0.0.1 or ::1 and nothing else.
      lookup: pinnedLookup(request.addresses) as unknown as https.RequestOptions['lookup'],
      ...(secure ? { rejectUnauthorized: true, ca: caCertificates() } : {})
    }
    const req = (secure ? https : http).request(options, (res) => {
      const status = res.statusCode ?? 0
      if (status < 200 || status > 599) {
        res.destroy()
        fail(new ProviderError('unknown', `The model server sent an unexpected status (${status}).`, status))
        return
      }
      const responseHeaders = new Headers()
      for (let index = 0; index + 1 < res.rawHeaders.length; index += 2) {
        try { responseHeaders.append(res.rawHeaders[index], res.rawHeaders[index + 1]) } catch { /* skip a header the Fetch API cannot represent */ }
      }
      if (NULL_BODY_STATUS.has(status)) {
        res.resume()
        settled = true
        resolve(new Response(null, { status, headers: responseHeaders }))
        return
      }
      let total = 0
      let closed = false
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const finish = (error?: Error): void => {
            if (closed) return
            closed = true
            if (error) controller.error(error)
            else controller.close()
          }
          res.on('data', (chunk: Buffer) => {
            if (closed) return
            total += chunk.length
            if (total > CUSTOM_RESPONSE_LIMIT) {
              finish(new ProviderError('unknown', 'The model server reply exceeded the size limit and was cut off.'))
              res.destroy()
              return
            }
            controller.enqueue(new Uint8Array(chunk))
            if ((controller.desiredSize ?? 1) <= 0) res.pause()
          })
          res.on('end', () => finish())
          res.on('error', (error) => finish(error))
          res.on('close', () => finish(res.complete ? undefined : new Error('The model server closed the connection before the reply finished.')))
        },
        pull() { res.resume() },
        cancel() { closed = true; res.destroy() }
      })
      settled = true
      resolve(new Response(body, { status, headers: responseHeaders }))
    })
    const onAbort = (): void => {
      req.destroy(new Error('Stopped.'))
      fail(new ProviderError('cancelled', 'Stopped.'))
    }
    if (request.signal.aborted) {
      req.destroy()
      fail(new ProviderError('cancelled', 'Stopped before the request was sent.'))
      return
    }
    request.signal.addEventListener('abort', onAbort, { once: true })
    req.on('close', () => request.signal.removeEventListener('abort', onAbort))
    req.on('error', (error: NodeJS.ErrnoException) => fail(connectionError(error, request.url)))
    req.end(request.body)
  })
}

function connectionError(error: NodeJS.ErrnoException, url: URL): Error {
  const where = `${url.protocol}//${url.host}`
  if (error.code === 'ECONNREFUSED') return new ProviderError('transient', `Nothing answered at ${where}. Start your model server (for example Ollama or LM Studio) and try again.`)
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'EPIPE') return new ProviderError('transient', `The connection to ${where} was interrupted.`)
  if (typeof error.code === 'string' && (error.code.startsWith('ERR_TLS') || error.code.includes('CERT') || error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT')) {
    return new ProviderError('unknown', `The TLS certificate for ${where} could not be verified, so nothing was sent.`)
  }
  return new ProviderError('transient', `The model server at ${where} could not be reached.`)
}
