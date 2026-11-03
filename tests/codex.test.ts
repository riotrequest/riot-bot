import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexService, type CodexTurnInput } from '../src/core/codex'
import { redact } from '../src/core/redact'
import { makeApp, tempDir, waitFor } from './helpers'
import type { ChatMessageView } from '../src/shared/types'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); vi.unstubAllEnvs() })

function fixture(config: Record<string, unknown> = {}) {
  const dir = tempDir(), home = path.join(dir, 'codex')
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(home, 'fixture.json'), JSON.stringify(config))
  const opened: string[] = []
  const codex = new CodexService({ home, command: process.execPath, prefixArgs: [path.resolve('tests/fixtures/codex-server.cjs')], openLink: url => opened.push(url) })
  cleanups.push(() => codex.close())
  const requests = (): any[] => fs.existsSync(path.join(home, 'requests.jsonl')) ? fs.readFileSync(path.join(home, 'requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
  return { dir, home, codex, opened, requests }
}

function nativeApp(config: Record<string, unknown> = {}) {
  const fake = fixture(config)
  const setup = makeApp({ dbPath: path.join(fake.dir, 'riot.sqlite'), codex: fake.codex, createProvider: () => { throw new Error('Unexpected API fallback') } })
  cleanups.push(() => setup.app.close())
  const workspace = path.join(fake.dir, 'workspace')
  fs.mkdirSync(workspace)
  setup.app.updateSettings({ provider: 'codex', model: 'native-test', workspacePath: workspace, maxEstimatedSpendPerTaskUsd: 0.001 })
  const id = setup.app.getSnapshot().current!.conversation.id
  return { ...fake, ...setup, id }
}

function turnInput(dir: string, patch: Partial<CodexTurnInput> = {}): CodexTurnInput {
  return { model: 'native-test', cwd: dir, editing: false, tools: true, instructions: 'Test', input: [{ type: 'text', text: 'Test', text_elements: [] }], signal: new AbortController().signal, onThread() {}, onDelta() {}, onItem() {}, approve: async () => false, tool: async () => 'fixture', dynamicTools: [], ...patch }
}

describe('native Codex connection', () => {
  it('reads disk capacity through Riot and matches streamed native failures to the correct action', async () => {
    const { app, id, requests, provider } = nativeApp({ scenario: 'disk-space' })
    app.updateSettings({ workspaceEditing: false })
    const commands: ChatMessageView[] = []
    let approvals = 0
    app.onEvent(event => {
      if (event.type === 'message' && event.message.toolName === 'codex_commandExecution') commands.push(event.message)
      if (event.type === 'approval' && event.approval) approvals++
    })
    expect((await app.sendMessage(id, 'How much disk space is available?')).status).toBe('completed')
    const start = requests().find(item => item.method === 'thread/start')
    expect(start.params.dynamicTools.some((item: any) => item.name === 'riot_get_disk_space')).toBe(true)
    expect(start.params.developerInstructions).toContain('For disk-space questions, use riot_get_disk_space')
    const result = requests().find(item => item.dynamicResult).dynamicResult
    expect(result.success).toBe(true)
    expect(JSON.parse(result.contentItems[0].text).totalBytes).toBeGreaterThan(0)
    expect(commands).toHaveLength(2)
    expect(commands[0].toolError).toBeNull()
    expect(commands[1].toolError).toContain('did not complete successfully')
    expect(app.openConversation(id).messages.filter(message => message.toolError)).toHaveLength(1)
    expect(approvals).toBe(0)
    expect(provider.calls).toHaveLength(0)
  })

  it('exposes built-in schedules and carries scheduled context without allowing recursive schedules', async () => {
    const { app, id, requests, provider } = nativeApp({ scenario: 'schedule', schedule: { kind: 'reminder', title: 'Fixture reminder', instructions: 'Review the fixture.', start_at: new Date(Date.now() + 86400000).toISOString(), repeat: 'once', timezone: 'UTC' } })
    expect((await app.sendMessage(id, 'Remind me to review the fixture tomorrow.')).status).toBe('completed')
    expect(app.listSchedules()).toHaveLength(1)
    const start = requests().find(item => item.method === 'thread/start')
    expect(start.params.dynamicTools.some((item: any) => item.name === 'riot_create_schedule')).toBe(true)
    const run = await app.sendMessage(id, 'Check RLH every morning.', [], 'scheduled_task', 'Reference context captured: RLH uses the fixture email dashboard.')
    expect(run.trigger).toBe('scheduled_task')
    expect(app.listSchedules()).toHaveLength(1)
    expect(requests().filter(item => item.method === 'thread/resume').at(-1).params.developerInstructions).toContain('RLH uses the fixture email dashboard')
    expect(requests().filter(item => item.dynamicResult).at(-1).dynamicResult).toMatchObject({ success: false })
    expect(app.listActivity()[0].trigger).toBe('scheduled_task')
    expect(provider.calls).toHaveLength(0)
  })

  it('pauses an unlisted model before starting a thread or consuming a native turn',async()=>{
    const {app,id,requests}=nativeApp()
    app.updateSettings({model:'unlisted-model'})
    const run=await app.sendMessage(id,'Use my selected model')
    expect(run.status).toBe('paused')
    expect(run.note).toMatch(/Choose an available Codex model in Settings/)
    expect(requests().some(item=>item.method==='thread/start'||item.method==='turn/start')).toBe(false)
    expect(app.getUsage()).toMatchObject({modelCalls:0,codexTurns:0})
  })

  it('does nothing at construction or app boot, and metadata never starts an agent turn', async () => {
    const { app, provider, codex, requests } = nativeApp()
    expect(requests()).toEqual([])
    app.getSnapshot(); app.getUsage(); app.listActivity()
    expect(requests()).toEqual([])
    const status = await app.getCodexStatus()
    expect(status).toMatchObject({ connected: true, plan: 'plus', limits: [{ usedPercent: 12 }] })
    expect(codex.status().models).toEqual([{ id: 'native-test', name: 'Native fixture' }])
    expect(requests().some(item => item.method === 'turn/start')).toBe(false)
    expect(provider.calls).toHaveLength(0)
    expect(app.planProviderCheck().maxCalls).toBe(0)
  })

  it('uses the official login, rotates session identity, supports cancel/logout, and strips API env keys', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fixture-only-value')
    vi.stubEnv('CODEX_API_KEY', 'fixture-only-value')
    const { codex, home, opened, requests } = fixture({ connected: false })
    const before = codex.sessionKey()
    expect((await codex.refresh()).connected).toBe(false)
    expect((await codex.login()).loginPending).toBe(true)
    expect(opened).toEqual(['https://auth.openai.com/authorize?fixture=true'])
    await waitFor(() => codex.status().connected)
    expect(codex.sessionKey()).not.toBe(before)
    expect(requests()[0].environment).toEqual({ home, hasApiKey: false })
    expect((await codex.logout()).connected).toBe(false)
    expect(requests().some(item => item.method === 'turn/start')).toBe(false)
    const second = fixture({ connected: false, holdLogin: true })
    await second.codex.login()
    await expect(second.codex.run(turnInput(second.dir))).rejects.toThrow(/Finish or cancel/)
    expect((await second.codex.cancelLogin()).loginPending).toBe(false)
    expect(second.requests().some(item => item.method === 'account/login/cancel')).toBe(true)
  })

  it('rejects an unexpected authentication URL and signed-out turns without API fallback', async () => {
    const bad = fixture({ badLogin: true, connected: false })
    await expect(bad.codex.login()).rejects.toThrow(/unexpected sign-in address/)
    expect(bad.opened).toEqual([])
    const { app, id, requests } = nativeApp({ connected: false })
    const run = await app.sendMessage(id, 'hello')
    expect(run.status).toBe('failed')
    expect(run.note).toMatch(/Connect Codex/)
    expect(requests().some(item => item.method === 'turn/start')).toBe(false)
  })

  it('keeps native search and scoped Riot memory, streams replies, and separates subscription usage from dollars', async () => {
    const { app, id, requests, provider } = nativeApp({ scenario: 'tools' })
    let streamed = ''
    app.onEvent(event => { if (event.type === 'delta') streamed = event.message.content })
    const run = await app.sendMessage(id, 'Remember that my mascot is a blue comet.')
    expect(run.status).toBe('completed')
    expect(streamed).toContain('Native')
    const data = app.getSnapshot()
    expect(data.current!.messages.some(item => item.role === 'assistant' && item.content.includes('blue comet'))).toBe(true)
    expect(data.activity[0]).toMatchObject({ provider: 'codex', purpose: 'codex_turn', outcome: 'completed', inputTokens: 100, outputTokens: 20, costLabel: 'subscription', estimatedCostUsd: null, reportedCostUsd: null })
    expect(data.activity[0].tools.some(item => item.name === 'codex_webSearch')).toBe(true)
    expect(data.usage).toMatchObject({ modelCalls: 0, codexTurns: 1, estimatedUsd: 0, reportedUsd: 0, unsettledUsd: 0 })
    expect(run.modelCalls).toBe(0)
    expect(provider.calls).toHaveLength(0)
    const start = requests().find(item => item.method === 'thread/start')
    expect(start.params.config.web_search).toBe('live')
    expect(start.params.dynamicTools.some((item: any) => item.name === 'riot_list_memories')).toBe(true)
    expect(start.params.dynamicTools.some((item: any) => item.name === 'riot_web_search' || item.name === 'riot_run_terminal')).toBe(false)
  })

  it('resumes only the same bot/conversation/account/settings and records token deltas', async () => {
    const { app, id, requests, codex } = nativeApp()
    await app.sendMessage(id, 'First')
    await app.sendMessage(id, 'Second')
    expect(requests().filter(item => item.method === 'thread/start')).toHaveLength(1)
    expect(requests().filter(item => item.method === 'thread/resume')).toHaveLength(1)
    expect(app.listActivity()[0].inputTokens).toBe(100)
    app.updateSettings({ toolsEnabled: false })
    await app.sendMessage(id, 'Third')
    expect(requests().filter(item => item.method === 'thread/start')).toHaveLength(2)
    expect(requests().filter(item => item.method === 'thread/start').at(-1).params.dynamicTools).toEqual([])
    expect(requests().filter(item => item.method === 'thread/start').at(-1).params.config.web_search).toBe('disabled')
    expect(requests().filter(item => item.method === 'turn/start').at(-1).params.sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false })
    await codex.logout(); await codex.login(); await waitFor(() => codex.status().connected)
    await app.sendMessage(id, 'Fourth')
    expect(requests().filter(item => item.method === 'thread/start')).toHaveLength(3)
    const second = await app.createBot({ purpose: 'second isolated bot', name: 'Other', provider: 'codex', model: 'native-test', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#445566' })
    await app.selectBot(second.bot.id)
    const snapshot = app.getSnapshot()
    await app.sendMessage(snapshot.current!.conversation.id, 'Other bot question')
    expect(requests().filter(item => item.method === 'thread/start')).toHaveLength(4)
    expect(requests().filter(item => item.method === 'thread/start').at(-1).params.developerInstructions).toContain('Other')
  })

  it('carries images and text attachments into the native turn', async () => {
    const { app, id, requests } = nativeApp()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const attached = app.stageAttachments([{ name: 'notes.txt', bytes: Buffer.from('Native attachment marker') }, { name: 'screen.png', bytes: png }], app.getSnapshot().bot!.id)
    await app.sendMessage(id, 'Check these', attached.map(item => item.id))
    const input = requests().find(item => item.method === 'turn/start').params.input
    expect(input[0].text).toContain('Native attachment marker')
    expect(input[1]).toEqual({ type: 'image', url: `data:image/png;base64,${png.toString('base64')}` })
  })

  it('forwards one-time approval, records refusal, and declines network escalation without prompting', async () => {
    const { app, id, requests } = nativeApp({ scenario: 'approval' })
    const run = app.sendMessage(id, 'Run a command')
    await waitFor(() => Boolean(app.pendingApproval()))
    expect(app.pendingApproval()).toMatchObject({ kind: 'codex',title:'Allow this Codex command?',command:'Write-Output fixture-only' })
    app.resolveApproval(app.pendingApproval()!.id, false)
    expect((await run).status).toBe('completed')
    expect(requests().find(item => item.approval).approval).toEqual({ decision: 'decline' })
    const next = nativeApp({ scenario: 'network' })
    await next.app.sendMessage(next.id, 'Try broader network permissions')
    expect(next.app.pendingApproval()).toBeNull()
    expect(next.requests().find(item => item.approval).approval).toEqual({ decision: 'decline' })
    const permissions = fixture({ scenario: 'unsupported' })
    await permissions.codex.run(turnInput(permissions.dir))
    expect(permissions.requests().find(item => item.permissions).permissions).toEqual({ permissions: {}, scope: 'turn' })
  })

  it('interrupts on Stop, preserves partial text, and starts a fresh session after interruption', async () => {
    const { app, id, requests } = nativeApp({ scenario: 'hold' })
    const pending = app.sendMessage(id, 'Do something long')
    await waitFor(() => app.getSnapshot().current!.messages.some(item => item.role === 'assistant'))
    app.stop()
    expect((await pending).status).toBe('stopped')
    expect(requests().filter(item => item.method === 'turn/interrupt')).toHaveLength(1)
    expect(app.getSnapshot().current!.messages.some(item => item.content === 'Partial reply')).toBe(true)
    const second = app.sendMessage(id, 'Again')
    await waitFor(() => requests().filter(item => item.method === 'turn/start').length === 2)
    app.stop(); await second
    expect(requests().filter(item => item.method === 'thread/resume')).toHaveLength(0)
  })

  it('closes a server that ignores interruption and never retries a quota failure or disconnected turn', async () => {
    const hanging = nativeApp({ scenario: 'ignore-interrupt-child' })
    const pending = hanging.app.sendMessage(hanging.id, 'Long')
    await waitFor(() => hanging.requests().some(item => item.method === 'turn/start'))
    const heartbeat = path.join(hanging.home, 'heartbeat')
    await waitFor(() => fs.existsSync(heartbeat))
    hanging.app.stop()
    expect((await pending).status).toBe('stopped')
    expect(hanging.codex.status().connected).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 200))
    const lastBeat = fs.readFileSync(heartbeat, 'utf8')
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(fs.readFileSync(heartbeat, 'utf8')).toBe(lastBeat)
    for (const scenario of ['quota', 'crash', 'malformed']) {
      const test = nativeApp({ scenario })
      const run = await test.app.sendMessage(test.id, 'Try once')
      expect(run.status).toBe('paused')
      expect(test.requests().filter(item => item.method === 'turn/start')).toHaveLength(1)
      expect(test.provider.calls).toHaveLength(0)
      expect(test.app.getUsage().unsettledUsd).toBe(0)
    }
  }, 10_000)

  it('redacts OAuth token fields before persistence or error display', () => {
    expect(redact('{"access_token":"test-access","refresh_token":"test-refresh","id_token":"test-id"}')).not.toMatch(/test-(access|refresh|id)/)
  })

  it('clears approval on Stop and refuses a native turn when the Windows sandbox is not ready', async () => {
    const pending = nativeApp({ scenario: 'approval' })
    const run = pending.app.sendMessage(pending.id, 'Run a command')
    await waitFor(() => Boolean(pending.app.pendingApproval()))
    pending.app.stop()
    expect((await run).status).toBe('stopped')
    expect(pending.app.pendingApproval()).toBeNull()
    if (process.platform === 'win32') {
      const bad = nativeApp({ sandboxNotReady: true })
      expect((await bad.app.sendMessage(bad.id, 'Start')).status).toBe('paused')
      expect(bad.requests().some(item => item.method === 'turn/start')).toBe(false)
    }
  })

  it('keeps a completed session across app restart without starting idle work', async () => {
    const first = nativeApp()
    await first.app.sendMessage(first.id, 'First turn')
    const calls = first.requests().filter(item => item.method === 'turn/start').length
    await first.app.close()
    const codex = new CodexService({ home: first.home, command: process.execPath, prefixArgs: [path.resolve('tests/fixtures/codex-server.cjs')] })
    const next = makeApp({ dbPath: first.dbPath, codex })
    cleanups.push(() => next.app.close())
    next.app.updateSettings({ provider: 'codex', model: 'native-test' })
    expect(first.requests().filter(item => item.method === 'turn/start')).toHaveLength(calls)
    expect((await next.app.sendMessage(first.id, 'Second turn')).status).toBe('completed')
    expect(first.requests().filter(item => item.method === 'thread/resume')).toHaveLength(1)
  })
})
