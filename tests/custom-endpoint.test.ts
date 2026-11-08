import fs from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryCredentialStore } from '../src/core/credentials'
import { createCustomEndpointFetch, createCustomEndpointProvider, normalizeCustomBaseUrl, pinnedEndpointTransport, type CustomEndpointRequest } from '../src/core/custom-endpoint'
import { ConfigError, ProviderError } from '../src/core/errors'
import type { ModelCompleteInput } from '../src/core/model'
import { RiotService } from '../src/core/service'
import type { Settings } from '../src/core/settings'
import type { ProviderConnection } from '../src/core/app'
import { MockProvider } from '../src/core/provider'
import { makeApp, reopen, tempDir, waitFor } from './helpers'

const KEY = 'custom-endpoint-key-8f3a91c2'
const PUBLIC = async (): Promise<string[]> => ['93.184.216.34']

function input(overrides: Partial<ModelCompleteInput> = {}): ModelCompleteInput {
  return { model: 'llama3.2', messages: [{ role: 'user', content: 'Hi' }], stream: true, maxOutputTokens: 32, tokenParameter: 'max_completion_tokens', signal: new AbortController().signal, ...overrides }
}

function sse(text = 'Hello', usage: Record<string, unknown> = { prompt_tokens: 4, completion_tokens: 2 }): Response {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\n`,
    'data: [DONE]\n\n'
  ].join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** A transport double: records exactly what would have been put on the wire. */
function recorder(respond: (request: CustomEndpointRequest) => Response = () => sse()) {
  const requests: CustomEndpointRequest[] = []
  return { requests, transport: async (request: CustomEndpointRequest) => { requests.push(request); return respond(request) } }
}

describe('custom endpoint address rules', () => {
  it('accepts loopback http and public https endpoints and normalizes them', () => {
    expect(normalizeCustomBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
    expect(normalizeCustomBaseUrl(' http://localhost:1234/v1/ ')).toBe('http://localhost:1234/v1')
    expect(normalizeCustomBaseUrl('http://127.0.0.1:8000/v1/chat/completions')).toBe('http://127.0.0.1:8000/v1')
    expect(normalizeCustomBaseUrl('http://[::1]:8000/v1')).toBe('http://[::1]:8000/v1')
    expect(normalizeCustomBaseUrl('https://models.example.com/api/v1')).toBe('https://models.example.com/api/v1')
    expect(normalizeCustomBaseUrl('HTTPS://Models.Example.com')).toBe('https://models.example.com')
    expect(normalizeCustomBaseUrl('')).toBe('')
  })

  it('refuses plain http to other hosts, LAN and private addresses, credentials and queries', () => {
    for (const denied of [
      'http://192.168.1.20:11434/v1', // a home Ollama server: plain http off this computer
      'http://models.example.com/v1',
      'http://localhost.example.com/v1',
      'https://192.168.1.20/v1',
      'https://10.0.0.5/v1',
      'https://172.16.4.2/v1',
      'https://[fd00::1]/v1',
      'https://169.254.169.254/latest',
      'https://ollama.local/v1',
      'https://gpu-box.lan/v1',
      'https://metadata.google.internal/v1',
      'ftp://models.example.com/v1',
      'https://user:secret@models.example.com/v1',
      'https://models.example.com/v1?key=abc',
      'not a url'
    ]) expect(() => normalizeCustomBaseUrl(denied), denied).toThrow(ConfigError)
  })
})

describe('custom endpoint requests', () => {
  it('sends the key only to the configured endpoint, over the validated addresses', async () => {
    const wire = recorder(() => sse('Hello', { prompt_tokens: 4, completion_tokens: 2, cost: 0 }))
    const provider = createCustomEndpointProvider({ baseUrl: 'https://models.example.com/v1/', apiKey: KEY, lookupHost: PUBLIC, transport: wire.transport })
    const result = await provider.complete(input())
    expect(provider.name).toBe('custom')
    expect(result.content).toBe('Hello')
    expect(wire.requests).toHaveLength(1)
    const [sent] = wire.requests
    expect(sent.url.toString()).toBe('https://models.example.com/v1/chat/completions')
    expect(sent.addresses).toEqual(['93.184.216.34'])
    expect(sent.method).toBe('POST')
    expect(sent.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(sent.body ?? '{}')).toMatchObject({ model: 'llama3.2', stream: true, max_completion_tokens: 32 })
    // A cost the endpoint reports is not used for budgets; spending comes from the prices you enter.
    expect(result.usage).toMatchObject({ inputTokens: 4, outputTokens: 2 })
    expect(result.usage?.reportedCostUsd).toBeUndefined()
  })

  it('never contacts the endpoint when DNS points it at a private address, and rechecks DNS on every request', async () => {
    for (const address of ['10.0.0.8', '127.0.0.1', '192.168.1.20', '::1', 'fe80::1']) {
      const wire = recorder()
      const provider = createCustomEndpointProvider({ baseUrl: 'https://models.example.com/v1', apiKey: KEY, lookupHost: async () => [address], transport: wire.transport })
      await expect(provider.complete(input())).rejects.toMatchObject({ kind: 'unknown', message: expect.stringMatching(/private network address, so nothing was sent/) })
      expect(wire.requests, address).toHaveLength(0)
    }
    const answers = [['93.184.216.34'], ['192.168.1.20']]
    const wire = recorder()
    const rebinding = createCustomEndpointProvider({ baseUrl: 'https://models.example.com/v1', apiKey: KEY, lookupHost: async () => answers.shift() ?? [], transport: wire.transport })
    await rebinding.complete(input())
    await expect(rebinding.complete(input())).rejects.toBeInstanceOf(ProviderError)
    expect(wire.requests).toHaveLength(1)
    expect(wire.requests[0].addresses).toEqual(['93.184.216.34'])
  })

  it('refuses requests addressed to any other host and does not follow redirects', async () => {
    const wire = recorder()
    const guarded = createCustomEndpointFetch({ baseUrl: 'https://models.example.com/v1', lookupHost: PUBLIC, transport: wire.transport })
    for (const target of ['https://attacker.example/v1/chat/completions', 'http://models.example.com/v1/chat/completions', 'https://models.example.com:8443/v1/chat/completions', 'https://models.example.com/other/chat/completions', 'https://models.example.com/v1/chat/completions?leak=1']) {
      await expect(guarded(target, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: '{}' }), target).rejects.toThrow(/not addressed to the configured endpoint/)
    }
    expect(wire.requests).toHaveLength(0)

    const redirected = recorder(() => new Response(null, { status: 307, headers: { location: 'https://attacker.example/v1/chat/completions' } }))
    const provider = createCustomEndpointProvider({ baseUrl: 'https://models.example.com/v1', apiKey: KEY, lookupHost: PUBLIC, transport: redirected.transport })
    await expect(provider.complete(input())).rejects.toThrow(/does not follow redirects/)
    expect(redirected.requests.map((request) => request.url.host)).toEqual(['models.example.com'])
  })

  it('omits Authorization without a saved key and pins localhost without a DNS lookup', async () => {
    const wire = recorder()
    let lookups = 0
    const provider = createCustomEndpointProvider({ baseUrl: 'http://localhost:11434/v1', lookupHost: async () => { lookups += 1; return ['192.168.1.20'] }, transport: wire.transport })
    await provider.complete(input())
    expect(lookups).toBe(0)
    expect(wire.requests[0].url.toString()).toBe('http://localhost:11434/v1/chat/completions')
    expect(wire.requests[0].addresses).toEqual(['127.0.0.1', '::1'])
    expect(Object.keys(wire.requests[0].headers).map((name) => name.toLowerCase())).not.toContain('authorization')
  })

  it('refuses to build a provider without a saved address instead of choosing another connection', () => {
    expect(() => createCustomEndpointProvider({ baseUrl: '' })).toThrow(/model server address/)
    expect(() => createCustomEndpointProvider({ baseUrl: 'http://192.168.1.20:11434/v1' })).toThrow(ConfigError)
  })
})

describe('custom endpoint in the app', () => {
  const closers: (() => Promise<void>)[] = []
  afterEach(async () => { while (closers.length) await closers.pop()!() })

  function customApp(respond?: (request: CustomEndpointRequest) => Response) {
    const credentials = new MemoryCredentialStore({ encryptionAvailable: true })
    const wire = recorder(respond)
    const built: { provider: string; connection: ProviderConnection }[] = []
    // Mirrors the main-process wiring: only the custom endpoint is available to these tests.
    const createProvider = (settings: Settings, connection: ProviderConnection) => {
      built.push({ provider: settings.provider, connection })
      if (settings.provider !== 'custom') throw new Error(`Unexpected ${settings.provider} connection`)
      return createCustomEndpointProvider({ baseUrl: connection.customBaseUrl, apiKey: credentials.get('custom'), lookupHost: PUBLIC, transport: wire.transport })
    }
    const setup = makeApp({ credentials, createProvider })
    closers.push(() => setup.app.close())
    return { ...setup, wire, built }
  }

  it('keeps the address in settings and the key only in the credential store', async () => {
    const { app, dbPath, credentials } = customApp()
    expect(app.getSnapshot().credentials).toMatchObject({ customConfigured: false, customKeyConfigured: false })
    expect(() => app.updateAppSettings({ provider: 'custom', customBaseUrl: 'http://192.168.1.20:11434/v1' })).toThrow(/Plain http:\/\/ is only allowed/)
    expect(() => app.updateAppSettings({ customBaseUrl: 'https://10.1.2.3/v1' })).toThrow(/local or private network/)
    expect(() => app.updateAppSettings({ customContextTokens: 12 })).toThrow(/1024/)
    expect(app.getAppSettings()).toMatchObject({ provider: 'openai', customBaseUrl: '', customContextTokens: null })
    const saved = app.updateAppSettings({ provider: 'custom', model: 'llama3.2', customBaseUrl: 'http://localhost:11434/v1/', customContextTokens: 8192 })
    expect(saved).toMatchObject({ provider: 'custom', model: 'llama3.2', customBaseUrl: 'http://localhost:11434/v1', customContextTokens: 8192 })
    app.setCredential('custom', KEY)
    expect(credentials.get('custom')).toBe(KEY)
    expect(app.getSnapshot().credentials).toMatchObject({ customConfigured: true, customKeyConfigured: true })
    expect(JSON.stringify(app.getSnapshot())).not.toContain(KEY)
    await app.close()
    closers.length = 0
    expect(fs.readFileSync(dbPath).includes(Buffer.from(KEY))).toBe(false)
    const restarted = reopen(dbPath)
    try {
      expect(restarted.app.getAppSettings()).toMatchObject({ provider: 'custom', customBaseUrl: 'http://localhost:11434/v1', customContextTokens: 8192 })
      expect(restarted.app.getSnapshot().credentials.customKeyConfigured).toBe(false)
    } finally { await restarted.app.close() }
  })

  it('runs a bot on the endpoint with its context length and stops instead of switching when the address is removed', async () => {
    const { app, wire, built } = customApp()
    app.updateAppSettings({ customBaseUrl: 'http://127.0.0.1:1234/v1', customContextTokens: 8192 })
    app.updateSettings({ provider: 'custom', model: 'local-model', toolsEnabled: false })
    const conversation = app.getSnapshot().conversations[0].id
    const run = await app.sendMessage(conversation, 'Hello')
    expect(run.status).toBe('completed')
    expect(wire.requests).toHaveLength(1)
    expect(wire.requests[0].url.toString()).toBe('http://127.0.0.1:1234/v1/chat/completions')
    // The automatic reply allowance is half the connection's context length.
    expect(JSON.parse(wire.requests[0].body ?? '{}')).toMatchObject({ model: 'local-model', max_completion_tokens: 4096 })
    expect(built.every((entry) => entry.provider === 'custom')).toBe(true)
    expect(app.getSnapshot().settings.modelContextTokens).toBeNull()

    app.updateAppSettings({ customBaseUrl: '' })
    expect(app.getSnapshot().credentials.customConfigured).toBe(false)
    await expect(app.sendMessage(conversation, 'Again')).rejects.toThrow(/model server address/)
    expect(wire.requests).toHaveLength(1)
    expect(built.every((entry) => entry.provider === 'custom')).toBe(true)
  })

  it('keeps dollar limits blocked without prices and redacts a key the endpoint echoes back', async () => {
    const { app, wire } = customApp(() => new Response(JSON.stringify({ error: { message: `invalid request for key ${KEY}` } }), { status: 400 }))
    app.updateAppSettings({ customBaseUrl: 'http://localhost:11434/v1' })
    app.setCredential('custom', KEY)
    app.updateSettings({ provider: 'custom', model: 'llama3.2', toolsEnabled: false, botSpendPerDayUsd: 1 })
    expect(app.planProviderCheck().blockedReason).toMatch(/no price/)
    const conversation = app.getSnapshot().conversations[0].id
    const blocked = await app.sendMessage(conversation, 'Hello')
    expect(blocked.status).not.toBe('completed')
    expect(wire.requests).toHaveLength(0)

    app.updateSettings({ botSpendPerDayUsd: null })
    const failed = await app.sendMessage(conversation, 'Hello again')
    expect(failed.status).not.toBe('completed')
    expect(wire.requests).toHaveLength(1)
    expect(wire.requests[0].headers.authorization).toBe(`Bearer ${KEY}`)
    const visible = JSON.stringify({ activity: app.listActivity(), snapshot: app.getSnapshot(), run: failed })
    expect(visible).toContain('[redacted]')
    expect(visible).not.toContain(KEY)
  })

  it('pauses queued work and refuses a change while a job uses the old address', async () => {
    const dir = tempDir(), provider = new MockProvider(), credentials = new MemoryCredentialStore()
    const app = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), provider, credentials })
    app.boot()
    closers.push(() => app.close())
    app.updateAppSettings({ customBaseUrl: 'http://localhost:11434/v1' })
    const bot = await app.createBot({ name: 'Local', purpose: 'Help locally', provider: 'custom', model: 'llama3.2', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
    app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
    provider.handler = (request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new ProviderError('cancelled', 'Stopped.')), { once: true }))
    app.queueMessage(bot.conversation.id, 'Use the local server')
    await waitFor(() => provider.calls.length === 1)
    expect(() => app.updateAppSettings({ customBaseUrl: 'http://localhost:1234/v1' })).toThrow(/Stop jobs/)
    expect(app.updateAppSettings({ customContextTokens: 4096, customBaseUrl: 'http://localhost:11434/v1/' }).customContextTokens).toBe(4096)
    app.stop()
    await waitFor(() => !app.getSnapshot().runningBotIds?.length)
    const queued = app.queueMessage(bot.conversation.id, 'Still meant for Ollama')
    app.updateAppSettings({ customBaseUrl: 'http://localhost:1234/v1' })
    expect(app.listJobs().find((job) => job.id === queued.id)?.status).toBe('paused')
    expect(provider.calls).toHaveLength(1)
  })
})

describe('pinned endpoint transport against local sentinels', () => {
  const servers: http.Server[] = []
  afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })
  })

  async function sentinel(handler: http.RequestListener): Promise<{ port: number; seen: http.IncomingMessage[] }> {
    const seen: http.IncomingMessage[] = []
    const server = http.createServer((request, response) => { seen.push(request); handler(request, response) })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { port: (server.address() as AddressInfo).port, seen }
  }

  const streaming: http.RequestListener = (request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello from ' } }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'this computer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3 } })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  }

  it('streams a reply from a loopback server and sends the key only there', async () => {
    const local = await sentinel(streaming)
    for (const host of ['127.0.0.1', 'localhost']) {
      const provider = createCustomEndpointProvider({ baseUrl: `http://${host}:${local.port}/v1`, apiKey: KEY })
      const deltas: string[] = []
      const result = await provider.complete(input({ onDelta: (text) => deltas.push(text) }))
      expect(result.content, host).toBe('Hello from this computer')
      expect(deltas.join('')).toBe('Hello from this computer')
    }
    expect(local.seen.map((request) => [request.method, request.url, request.headers.authorization])).toEqual([
      ['POST', '/v1/chat/completions', `Bearer ${KEY}`],
      ['POST', '/v1/chat/completions', `Bearer ${KEY}`]
    ])
  })

  it('connects only to the validated addresses and leaves a redirect to another server unfollowed', async () => {
    const other = await sentinel(streaming)
    const redirecting = await sentinel((request, response) => {
      request.resume()
      response.writeHead(307, { location: `http://127.0.0.1:${other.port}/v1/chat/completions` })
      response.end()
    })
    const provider = createCustomEndpointProvider({ baseUrl: `http://127.0.0.1:${redirecting.port}/v1`, apiKey: KEY })
    await expect(provider.complete(input())).rejects.toThrow(/does not follow redirects/)
    expect(redirecting.seen).toHaveLength(1)
    expect(other.seen).toHaveLength(0)

    // The host name does not resolve; the request still reaches only the address Riot validated and pinned.
    const pinned = await sentinel(streaming)
    const response = await pinnedEndpointTransport({ url: new URL(`http://riot-endpoint.invalid:${pinned.port}/v1/chat/completions`), addresses: ['127.0.0.1'], method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: new AbortController().signal })
    expect(response.status).toBe(200)
    await response.text()
    expect(pinned.seen[0].headers.host).toBe(`riot-endpoint.invalid:${pinned.port}`)
  })

  it('reports a stopped model server without retrying forever', async () => {
    const closed = await sentinel(streaming)
    const port = closed.port
    await new Promise<void>((resolve) => { const server = servers.pop()!; server.close(() => resolve()) })
    const provider = createCustomEndpointProvider({ baseUrl: `http://127.0.0.1:${port}/v1` })
    await expect(provider.complete(input())).rejects.toMatchObject({ kind: 'transient', message: expect.stringMatching(/Nothing answered at http:\/\/127\.0\.0\.1/) })
  })
})
