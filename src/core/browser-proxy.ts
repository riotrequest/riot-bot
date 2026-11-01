import http from 'http'
import net from 'net'
import type { Duplex } from 'stream'
import { browserDestinationBlocked } from './browser-policy'
import { defaultLookup } from './web'

export interface BrowserProxy {
  url: string
  close: () => Promise<void>
}

/**
 * Local proxy for browser HTTP(S). It resolves each destination and connects only when every address is public.
 * allowLoopback is for tests. The app does not pass true, and there is no setting that turns it on.
 */
export function startBrowserProxy(options?: {
  allowLoopback?: boolean
  lookupHost?: (hostname: string) => Promise<string[]>
}): Promise<BrowserProxy> {
  const allowLoopback = options?.allowLoopback === true
  const lookupHost = options?.lookupHost ?? defaultLookup
  const server = http.createServer((request, response) => {
    quiet(request.socket)
    quiet(response)
    void proxyHttp(request, response, allowLoopback, lookupHost).catch(() => {
      if (!response.headersSent) response.writeHead(403)
      response.end('Blocked')
    })
  })
  server.on('clientError', (_error, socket) => {
    socket.destroy()
  })
  server.on('connect', (request, socket, head) => {
    quiet(socket)
    void proxyConnect(request.url ?? '', socket, head, allowLoopback, lookupHost)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
          })
      })
    })
  })
}

export async function resolveDestination(hostname: string, lookupHost: (hostname: string) => Promise<string[]>, allowLoopback: boolean): Promise<string> {
  const addresses = net.isIP(hostname) ? [hostname] : await lookupHost(hostname)
  const reason = browserDestinationBlocked(hostname, addresses, allowLoopback)
  if (reason) throw new Error(reason)
  const address = addresses[0]
  if (!address) throw new Error('The address could not be resolved, so it was not opened.')
  return address
}

async function proxyHttp(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  allowLoopback: boolean,
  lookupHost: (hostname: string) => Promise<string[]>
): Promise<void> {
  let target: URL
  try {
    target = new URL(request.url ?? '')
  } catch {
    response.writeHead(403)
    response.end('Blocked')
    return
  }
  if (target.protocol !== 'http:') {
    response.writeHead(403)
    response.end('Blocked')
    return
  }
  let address = ''
  try {
    address = await resolveDestination(target.hostname, lookupHost, allowLoopback)
  } catch {
    response.writeHead(403)
    response.end('Blocked')
    return
  }
  const port = target.port ? Number(target.port) : 80
  const headers = { ...request.headers, host: target.host }
  const outbound = http.request(
    {
      host: address,
      port,
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers
    },
    (incoming) => {
      quiet(incoming)
      response.writeHead(incoming.statusCode ?? 502, incoming.headers)
      incoming.pipe(response)
    }
  )
  outbound.on('error', () => {
    if (!response.headersSent) response.writeHead(502)
    response.end('The page could not be opened.')
  })
  request.pipe(outbound)
}

async function proxyConnect(
  hostport: string,
  socket: Duplex,
  head: Buffer,
  allowLoopback: boolean,
  lookupHost: (hostname: string) => Promise<string[]>
): Promise<void> {
  const parsed = splitHostPort(hostport)
  if (!parsed) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    return
  }
  try {
    const address = await resolveDestination(parsed.host, lookupHost, allowLoopback)
    const target = net.connect(parsed.port, address, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) target.write(head)
      target.pipe(socket)
      socket.pipe(target)
    })
    quiet(target)
    target.on('error', () => socket.destroy())
    target.on('close', () => socket.destroy())
    socket.on('error', () => target.destroy())
    socket.on('close', () => target.destroy())
  } catch {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  }
}

function quiet(stream: { on(event: 'error', listener: () => void): unknown }): void {
  stream.on('error', () => undefined)
}

function splitHostPort(value: string): { host: string; port: number } | null {
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end < 0) return null
    const host = value.slice(1, end)
    const port = Number(value.slice(end + 2) || '443')
    if (!host || !Number.isInteger(port)) return null
    return { host, port }
  }
  const colon = value.lastIndexOf(':')
  if (colon <= 0) return null
  const host = value.slice(0, colon)
  const port = Number(value.slice(colon + 1))
  if (!host || !Number.isInteger(port)) return null
  return { host, port }
}
