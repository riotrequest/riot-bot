import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'
import type { CodexStatus } from '../shared/types'
import { ConfigError, PauseError, StopError } from './errors'
import { publicErrorMessage } from './redact'
import { LEARNING_SCHEMA } from './learning'

type Obj = Record<string, any>
export interface CodexUsage { inputTokens: number; outputTokens: number; cachedInputTokens: number }
export interface CodexTurnInput {
  threadId?: string
  model: string
  cwd: string
  editing: boolean
  tools: boolean
  instructions: string
  input: Obj[]
  signal: AbortSignal
  onThread: (id: string) => void
  onDelta: (id: string, text: string) => void
  onItem: (item: Obj, completed: boolean) => void
  approve: (kind: 'command' | 'file', command: string, cwd: string) => Promise<boolean>
  tool: (name: string, args: Obj) => Promise<string>
  dynamicTools: Obj[]
  /** A disposable, tool-free assessment, separate from the user's native conversation. */
  review?: boolean
}
export interface CodexTurnResult { status: string; error: string; usage: CodexUsage | null }

/** Find the native executable; never launch a workspace script or a shell-built command. */
export function findCodexExecutable(env = process.env): string | null {
  const target = process.platform === 'win32' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
    : process.platform === 'darwin' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
      : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`
  const platformPackage = `@openai/codex-${process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch}`
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex'
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter((entry) => path.isAbsolute(entry))) {
    const direct = path.join(dir, executable)
    if (fs.existsSync(direct) && (process.platform === 'win32' || fs.readFileSync(direct).subarray(0, 2).toString() !== '#!')) return direct
    const pkg = path.join(dir, 'node_modules', '@openai', 'codex', 'package.json')
    if (!fs.existsSync(pkg)) continue
    let vendor = path.join(path.dirname(pkg), 'vendor')
    try { vendor = path.join(path.dirname(createRequire(pkg).resolve(`${platformPackage}/package.json`)), 'vendor') } catch { /* older npm layout */ }
    const binary = path.join(vendor, target, 'bin', executable)
    if (fs.existsSync(binary)) return binary
  }
  return null
}

export class CodexService {
  private process: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private closing: Promise<void> | null = null
  private sequence = 0
  private pending = new Map<number, { resolve: (value: Obj) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private buffer = ''
  private loginId: string | null = null
  private active: { input: CodexTurnInput; threadId: string; turnId: string | null; resolve: (result: CodexTurnResult) => void; reject: (error: Error) => void; usage: CodexUsage | null; error: string; finished: boolean } | null = null
  private readonly command: string | null
  private connection: string
  private state: CodexStatus

  constructor(private readonly options: { home: string; openLink?: (url: string) => void; changed?: (status: CodexStatus) => void; command?: string; prefixArgs?: string[] }) {
    this.command = options.command ?? findCodexExecutable()
    const marker = path.join(options.home, 'connection-id')
    this.connection = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : randomUUID()
    this.state = { installed: Boolean(this.command), connected: false, plan: null, email: null, loginPending: false, models: [], limits: [], note: this.command ? 'Connect Codex in Settings. Status checks do not start a model turn.' : 'Install the official Codex CLI, then restart Riot Bot.' }
  }

  status(): CodexStatus { return structuredClone(this.state) }
  sessionKey(): string {
    const marker = path.join(this.options.home,'connection-id')
    if (fs.existsSync(marker)) this.connection = fs.readFileSync(marker,'utf8').trim() || this.connection
    return this.connection
  }

  private publish(patch: Partial<CodexStatus>): CodexStatus {
    this.state = { ...this.state, ...patch }
    this.options.changed?.(this.status())
    return this.status()
  }

  private async start(): Promise<void> {
    if (this.closing) await this.closing
    if (this.starting) return this.starting
    if (this.process) return
    if (!this.command) throw new ConfigError('The official Codex CLI was not found. Install Codex and restart Riot Bot.')
    this.starting = this.launch()
    try { await this.starting } catch (error) { await this.close(); throw error } finally { this.starting = null }
  }

  private async launch(): Promise<void> {
    fs.mkdirSync(this.options.home, { recursive: true })
    fs.writeFileSync(path.join(this.options.home, 'connection-id'), this.connection, { mode: 0o600 })
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: this.options.home }
    for (const key of Object.keys(env)) if (/^(OPENAI_|CODEX_(?:API_KEY|ACCESS_TOKEN|REMOTE|AUTH)|ANTHROPIC_)/i.test(key)) delete env[key]
    const child = spawn(this.command!, [...(this.options.prefixArgs ?? []), 'app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"', '-c', 'analytics.enabled=false', '-c', 'features.multi_agent=false', ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="unelevated"'] : [])], { env, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' })
    this.process = child
    child.stdin.on('error', () => this.lost(child, 'Codex closed its connection. Unfinished work was not repeated.'))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.receive(chunk))
    // Raw server diagnostics can contain account data. Only protocol errors are shown after redaction.
    child.stderr.on('data', () => undefined)
    child.on('error', () => this.lost(child, 'Codex could not start. Check that the official CLI is installed.'))
    child.on('exit', () => this.lost(child, 'Codex disconnected. Unfinished work was not repeated.'))
    await this.request('initialize', { clientInfo: { name: 'riot_bot', title: 'Riot Bot', version: '0.1.0' }, capabilities: { experimentalApi: true } })
    this.send({ method: 'initialized', params: {} })
  }

  private lost(child: ChildProcessWithoutNullStreams, message: string): void {
    if (this.process !== child) return
    this.process = null
    this.buffer = ''
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new PauseError(message)) }
    this.pending.clear()
    this.active?.reject(new PauseError(message))
    this.loginId = null
    this.publish({ connected: false, loginPending: false, note: message })
  }

  private send(message: Obj): void {
    if (!this.process?.stdin.writable) throw new PauseError('Codex is disconnected.')
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private request(method: string, params: Obj = {}): Promise<Obj> {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new PauseError(`Codex did not respond to ${method}. No request was retried.`)) }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ id, method, params }) } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > 16_000_000) { void this.close(); return }
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      let message: Obj
      try { message = JSON.parse(line) } catch { void this.close(); return }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { void this.close(); return }
      if (message.method && message.id != null) { void this.serverRequest(message).catch(() => { try { this.send({ id: message.id, error: { code: -32603, message: 'Riot Bot declined the request.' } }) } catch { /* closing */ } }); continue }
      if (!message.method && message.id != null) {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        clearTimeout(pending.timer); this.pending.delete(message.id)
        if (message.error) pending.reject(new PauseError(publicErrorMessage(new Error(String(message.error.message || 'Codex request failed.')), [])))
        else pending.resolve(message.result ?? {})
        continue
      }
      try { this.notification(message.method, message.params ?? {}) } catch { void this.close() }
    }
  }

  private notification(method: string, params: Obj): void {
    if (method === 'account/login/completed') {
      if (params.loginId && params.loginId !== this.loginId) return
      this.loginId = null
      if (params.success) {
        this.connection = randomUUID()
        fs.writeFileSync(path.join(this.options.home, 'connection-id'), this.connection, { mode: 0o600 })
      }
      this.publish({ loginPending: false, note: params.success ? 'Signed in. Checking the Codex account…' : 'Codex sign-in was cancelled or did not complete.' })
      if (params.success) void this.refresh().catch(() => undefined)
    }
    if (method === 'account/rateLimits/updated') this.updateLimits(params)
    const active = this.active
    const turnId = params.turnId ?? params.turn?.id
    if (!active || active.finished || params.threadId !== active.threadId || (active.turnId && turnId && turnId !== active.turnId)) return
    if (method === 'turn/started') active.turnId = params.turn?.id ?? active.turnId
    if (method === 'item/agentMessage/delta') active.input.onDelta(String(params.itemId), String(params.delta ?? ''))
    if (method === 'item/started' || method === 'item/completed') active.input.onItem(params.item ?? {}, method === 'item/completed')
    if (method === 'thread/tokenUsage/updated' && params.tokenUsage?.total) {
      const usage = params.tokenUsage.total
      active.usage = { inputTokens: Number(usage.inputTokens || 0), outputTokens: Number(usage.outputTokens || 0), cachedInputTokens: Number(usage.cachedInputTokens || 0) }
    }
    if (method === 'error') active.error = publicErrorMessage(new Error(String(params.error?.message ?? 'Codex turn failed.')), [])
    if (method === 'turn/completed') {
      active.finished = true
      active.resolve({ status: String(params.turn?.status ?? 'failed'), error: active.error || publicErrorMessage(new Error(String(params.turn?.error?.message ?? '')), []), usage: active.usage })
    }
  }

  private updateLimits(params: Obj): void {
    const entries = params.rateLimitsByLimitId ? Object.values(params.rateLimitsByLimitId) as Obj[] : [params.rateLimits ?? params]
    const limits = entries.flatMap(entry => ['primary', 'secondary'].flatMap(key => {
      const value = entry?.[key]
      return value && Number.isFinite(value.usedPercent) ? [{ name: `${entry.limitName || entry.limitId || 'Codex'} ${key}`, usedPercent: value.usedPercent, resetsAt: typeof value.resetsAt === 'number' ? value.resetsAt : null }] : []
    }))
    this.publish({ limits })
  }

  async refresh(): Promise<CodexStatus> {
    await this.start()
    const result = await this.request('account/read', { refreshToken: false })
    const account = result.account
    const connected = account?.type === 'chatgpt'
    this.publish({ connected, email: connected ? account.email ?? null : null, plan: connected ? account.planType ?? null : null, ...(!connected ? { models: [], limits: [] } : {}), note: connected ? 'Connected through Codex. Native turns use this account; Riot Bot will not switch to an API key.' : 'Sign in with ChatGPT to connect this Riot Bot Codex profile.' })
    if (connected) {
      try { const catalog = await this.request('model/list', { limit: 100 }); this.publish({ models: (catalog.data ?? []).filter((model: Obj) => !model.hidden).map((model: Obj) => ({ id: model.model || model.id, name: model.displayName || model.model || model.id })) }) } catch { /* catalog is optional, not an entitlement check */ }
      try { this.updateLimits(await this.request('account/rateLimits/read')) } catch { this.publish({ limits: [] }) }
    }
    return this.status()
  }

  async login(): Promise<CodexStatus> {
    if (this.active) throw new ConfigError('Stop the Codex task before changing its account.')
    await this.start()
    if (this.loginId) return this.status()
    const result = await this.request('account/login/start', { type: 'chatgpt' })
    let url: URL
    try {
      url = new URL(result.authUrl)
      if (url.protocol !== 'https:' || url.username || url.password || !['auth.openai.com', 'chatgpt.com'].includes(url.hostname) || typeof result.loginId !== 'string') throw new Error()
    } catch {
      if (result.loginId) await this.request('account/login/cancel', { loginId: result.loginId })
      throw new ConfigError('Codex returned an unexpected sign-in address.')
    }
    if (!this.options.openLink) { await this.request('account/login/cancel', { loginId: result.loginId }); throw new ConfigError('Sign-in needs the desktop app to open your browser.') }
    this.loginId = result.loginId
    this.publish({ loginPending: true, note: 'Finish signing in in your browser. No agent turn has started.' })
    this.options.openLink(url.toString())
    return this.status()
  }

  async cancelLogin(): Promise<CodexStatus> {
    if (this.loginId) await this.request('account/login/cancel', { loginId: this.loginId })
    this.loginId = null
    return this.publish({ loginPending: false, note: 'Codex sign-in cancelled.' })
  }

  async logout(): Promise<CodexStatus> {
    if (this.active) throw new ConfigError('Stop the Codex task before disconnecting.')
    await this.start()
    await this.cancelLogin()
    await this.request('account/logout')
    this.connection = randomUUID()
    fs.writeFileSync(path.join(this.options.home, 'connection-id'), this.connection, { mode: 0o600 })
    return this.publish({ connected: false, email: null, plan: null, limits: [], models: [], note: 'Codex disconnected. Other backends and other apps were not changed.' })
  }

  async run(input: CodexTurnInput): Promise<CodexTurnResult> {
    if (this.active) throw new ConfigError('Codex is already working.')
    if (this.loginId) throw new ConfigError('Finish or cancel Codex sign-in before sending a message.')
    if (input.signal.aborted) throw new StopError('Stopped before starting Codex.')
    const stopStarting = (): void => { void this.close() }
    input.signal.addEventListener('abort', stopStarting, { once: true })
    try {
      const status = await this.refresh()
      if (input.signal.aborted) throw new StopError('Stopped before starting Codex.')
      if (!status.connected) throw new ConfigError('Connect Codex with ChatGPT in Settings first. No API-key fallback was used.')
      if (status.models.length && !status.models.some(model=>model.id===input.model)) throw new PauseError(`The model ${input.model} is not listed for this Codex account. Choose an available Codex model in Settings. No native turn or API fallback was started.`)
      if (process.platform === 'win32' && input.tools) {
        const readiness = await this.request('windowsSandbox/readiness')
        if (readiness.status !== 'ready') throw new PauseError('The native Windows sandbox is not ready. Update the official Codex CLI and retry. No turn was started.')
      }
      const config = { web_search: input.tools ? 'live' : 'disabled', 'features.shell_tool': input.tools, 'features.multi_agent': false, ...(input.review ? { project_doc_max_bytes: 0 } : {}) }
      const threadParams = { model: input.model, cwd: input.cwd, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: input.editing && input.tools ? 'workspace-write' : 'read-only', developerInstructions: input.instructions, config }
      const result = input.threadId ? await this.request('thread/resume', { ...threadParams, threadId: input.threadId, excludeTurns: true })
        : await this.request('thread/start', { ...threadParams, dynamicTools: input.tools ? input.dynamicTools : [], ...(input.review ? { ephemeral: true } : {}) })
      const threadId = result.thread?.id
      if (typeof threadId !== 'string') throw new PauseError('Codex did not return a thread. No turn was started.')
      if (input.signal.aborted) throw new StopError('Stopped before starting Codex.')
      input.onThread(threadId)
      let active: NonNullable<CodexService['active']>
      const finished = new Promise<CodexTurnResult>((resolve, reject) => {
        active = { input, threadId, turnId: null, resolve, reject, usage: null, error: '', finished: false }
        this.active = active
      })
      void finished.catch(() => undefined)
      const abort = (): void => {
        if (active.turnId) void this.request('turn/interrupt', { threadId, turnId: active.turnId }).catch(() => undefined)
        // If the process does not acknowledge cancellation promptly, closing it prevents further work.
        setTimeout(() => { if (this.active === active && !active.finished) void this.close() }, 2500).unref()
      }
      input.signal.removeEventListener('abort', stopStarting)
      input.signal.addEventListener('abort', abort, { once: true })
      try {
        if (input.signal.aborted) throw new StopError('Stopped before starting Codex.')
        const started = await this.request('turn/start', { threadId, model: input.model, input: input.input, cwd: input.cwd, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandboxPolicy: input.editing && input.tools ? { type: 'workspaceWrite', writableRoots: [input.cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } : { type: 'readOnly', networkAccess: false }, ...(input.review ? { effort: 'low', outputSchema: LEARNING_SCHEMA } : {}) })
        active!.turnId = started.turn?.id ?? active!.turnId
        if (input.signal.aborted) abort()
        return await finished
      } finally {
        input.signal.removeEventListener('abort', abort)
        this.active = null
        // Release disposable review sessions without delaying the reply or changing the main thread.
        if (input.review && this.process && !input.signal.aborted) void this.request('thread/unsubscribe', { threadId }).catch(() => undefined)
      }
    } catch (error) {
      await this.close()
      if (input.signal.aborted) throw new StopError('The native Codex turn was interrupted. Work already sent can count against account usage.')
      throw error
    } finally { input.signal.removeEventListener('abort', stopStarting); if (this.closing) await this.closing }
  }

  private async serverRequest(message: Obj): Promise<void> {
    const active = this.active
    const params = message.params ?? {}
    let result: Obj
    if (!active || params.threadId !== active.threadId || active.input.signal.aborted || (active.turnId && params.turnId !== active.turnId)) {
      result = message.method === 'item/tool/call' ? { contentItems: [{ type: 'inputText', text: 'No active authorized Riot Bot turn.' }], success: false } : { decision: 'decline' }
    } else if (message.method === 'item/tool/call') {
      try {
        const content = await active.input.tool(String(params.tool), params.arguments ?? {})
        result = { contentItems: [{ type: 'inputText', text: content }], success: true }
      } catch (error) { result = { contentItems: [{ type: 'inputText', text: publicErrorMessage(error) }], success: false } }
    } else if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') {
      const file = message.method.includes('fileChange')
      const outside = params.grantRoot && !inside(active.input.cwd, params.grantRoot)
      const deny = !active.input.tools || params.networkApprovalContext || params.additionalPermissions || outside || (params.cwd && !inside(active.input.cwd, params.cwd)) || (file ? !active.input.editing : !params.command)
      const approved = !deny && await active.input.approve(file ? 'file' : 'command', file ? String(params.reason || 'Apply the native Codex file changes in this workspace.') : String(params.command || 'Unknown command'), String(params.cwd || active.input.cwd))
      result = { decision: approved && !active.input.signal.aborted ? 'accept' : 'decline' }
    } else if (message.method === 'item/permissions/requestApproval') result = { permissions: {}, scope: 'turn' }
    else if (message.method === 'tool/requestUserInput') result = { answers: {} }
    else { this.send({ id: message.id, error: { code: -32601, message: 'This request is not supported by Riot Bot.' } }); return }
    this.send({ id: message.id, result })
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing
    const child = this.process
    if (!child) return
    this.closing = this.shutdown(child)
    try { await this.closing } finally { this.closing = null }
  }

  private async shutdown(child: ChildProcessWithoutNullStreams): Promise<void> {
    this.lost(child, 'Codex stopped. No unfinished work was repeated.')
    // Kill only the child tree we started, including a shell left behind by an unresponsive server.
    // Keep stdin open until taskkill has found the tree; an early parent exit can orphan its children.
    if (child.pid && process.platform === 'win32') {
      await new Promise<void>(resolve => {
        const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
        const timer = setTimeout(() => { child.kill(); resolve() }, 3000)
        killer.on('error', () => { child.kill(); clearTimeout(timer); resolve() })
        killer.on('exit', () => { clearTimeout(timer); resolve() })
      })
    } else {
      try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill() } catch { child.kill() }
    }
    child.stdin.end()
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 1500); timer.unref(); child.once('exit', () => { clearTimeout(timer); resolve() }) })
  }
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file))
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}
