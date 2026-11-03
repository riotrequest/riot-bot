// Protocol fixture. It never executes commands, searches the web, or contacts a model.
const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { createInterface } = require('readline')
const home = process.env.CODEX_HOME
const config = JSON.parse(fs.readFileSync(path.join(home, 'fixture.json'), 'utf8'))
const log = value => fs.appendFileSync(path.join(home, 'requests.jsonl'), JSON.stringify(value) + '\n')
log({ environment: { home, hasApiKey: Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.ANTHROPIC_API_KEY) } })
const write = value => process.stdout.write(JSON.stringify(value) + '\n')
const event = (method, params) => write({ method, params })
const reply = (id, result) => write({ id, result })
let connected = config.connected !== false, threadId, turnId, turnCount = 0
const callbacks = new Map()
let sequence = 0
function ask(method, params) {
  const id = 'server-' + ++sequence
  return new Promise(resolve => { callbacks.set(id, resolve); write({ id, method, params }) })
}
function finish(status = 'completed') {
  event('thread/tokenUsage/updated', { threadId, tokenUsage: { total: { inputTokens: turnCount * 100, outputTokens: turnCount * 20, cachedInputTokens: turnCount * 10 } } })
  event('turn/completed', { threadId, turn: { id: turnId, status, error: null } })
}
async function turn(params) {
  const base = { threadId, turnId }
  if (config.scenario === 'crash') return process.exit(1)
  if (config.scenario === 'malformed') return process.stdout.write('invalid json\n')
  if (['hold', 'ignore-interrupt', 'ignore-interrupt-child'].includes(config.scenario)) {
    if (config.scenario === 'ignore-interrupt-child') {
      require('child_process').spawn(process.execPath, ['-e', "const fs=require('fs');setInterval(()=>fs.writeFileSync(process.argv[1],String(Date.now())),80);setTimeout(()=>process.exit(),8000)", path.join(home,'heartbeat')], { windowsHide: true, stdio: 'ignore' })
    }
    event('item/agentMessage/delta', { ...base, itemId: 'partial', delta: 'Partial reply' })
    return
  }
  let text = 'Native reply'
  if (config.scenario === 'disk-space') {
    // Simulated command results only; validates that streamed errors belong to the right action.
    for (const [index, status] of ['completed', 'failed'].entries()) {
      const item = { id: 'old-command-' + index, type: 'commandExecution', command: 'fixture-only', status: 'inProgress' }
      event('item/started', { ...base, item })
      event('item/completed', { ...base, item: { ...item, status, exitCode: index, aggregatedOutput: index ? 'Access denied (fixture)' : 'No capacity values (fixture)' } })
    }
    const item = { id: 'disk-' + turnCount, type: 'dynamicToolCall', tool: 'riot_get_disk_space', arguments: {}, status: 'inProgress' }
    event('item/started', { ...base, item })
    const result = await ask('item/tool/call', { ...base, callId: item.id, tool: item.tool, arguments: {} })
    event('item/completed', { ...base, item: { ...item, status: 'completed', ...result } })
    log({ dynamicResult: result })
    text += ': ' + result.contentItems[0].text
  }
  if (config.scenario === 'approval' || config.scenario === 'network') {
    const item = { id: 'command-' + turnCount, type: 'commandExecution', command: 'Write-Output fixture-only', cwd: params.cwd, status: 'inProgress' }
    event('item/started', { ...base, item })
    const result = await ask('item/commandExecution/requestApproval', { ...base, itemId: item.id, command: item.command, cwd: params.cwd, ...(config.scenario === 'network' ? { networkApprovalContext: { host: 'example.org' } } : {}) })
    log({ approval: result })
    event('item/completed', { ...base, item: { ...item, status: result.decision === 'accept' ? 'completed' : 'declined' } })
    text = 'Command ' + result.decision
  }
  if (config.scenario === 'tools') {
    const item = { id: 'search-' + turnCount, type: 'webSearch', query: 'fixture query', status: 'inProgress' }
    event('item/started', { ...base, item })
    event('item/completed', { ...base, item: { ...item, status: 'completed', result: 'Fixture source https://example.org/source' } })
    const memory = { id: 'memory-' + turnCount, type: 'dynamicToolCall', tool: 'riot_list_memories', arguments: {}, status: 'inProgress' }
    event('item/started', { ...base, item: memory })
    const result = await ask('item/tool/call', { ...base, callId: memory.id, tool: memory.tool, arguments: {} })
    event('item/completed', { ...base, item: { ...memory, status: 'completed', ...result } })
    log({ dynamicResult: result })
    text += ': ' + result.contentItems[0].text
  }
  if (config.scenario === 'unsupported') {
    const result = await ask('item/permissions/requestApproval', { ...base, permissions: { network: { enabled: true } } })
    log({ permissions: result })
  }
  if (config.scenario === 'schedule') {
    const result = await ask('item/tool/call', { ...base, callId: 'schedule-' + turnCount, tool: 'riot_create_schedule', arguments: config.schedule })
    log({ dynamicResult: result })
    text += ': ' + result.contentItems[0].text
  }
  if (params.outputSchema) text = JSON.stringify(config.review ?? { memory: null, skill: null })
  if (config.scenario === 'gmail') {
    const search = await ask('item/tool/call', { ...base, callId: 'gmail-search', tool: 'riot_gmail_search', arguments: { query: 'is:unread' } })
    log({ gmailSearch: search })
    const draft = await ask('item/tool/call', { ...base, callId: 'gmail-draft', tool: 'riot_gmail_save_draft', arguments: { to: 'customer@example.com', subject: 'Native Gmail fixture', body: 'The native Gmail test is complete.' } })
    const id = JSON.parse(draft.contentItems[0].text).id
    const sent = await ask('item/tool/call', { ...base, callId: 'gmail-send', tool: 'riot_gmail_send_draft', arguments: { id } })
    log({ gmailSend: sent })
    text += ': ' + sent.contentItems[0].text
  }
  const item = { type: 'agentMessage', id: 'reply-' + turnCount, text, phase: 'final_answer' }
  event('item/started', { ...base, item: { ...item, text: '' } })
  event('item/agentMessage/delta', { ...base, itemId: item.id, delta: text.slice(0, 6) })
  event('item/agentMessage/delta', { ...base, itemId: item.id, delta: text.slice(6) })
  event('item/completed', { ...base, item })
  finish()
}
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (!message.method) {
    const callback = callbacks.get(message.id)
    if (callback) { callbacks.delete(message.id); callback(message.result ?? { error: message.error }) }
    return
  }
  log(message)
  const { id, method, params } = message
  if (method === 'initialized') return
  if (method === 'initialize') {
    const data = JSON.stringify({ id, result: { userAgent: 'fixture' } }) + '\n'
    process.stdout.write(data.slice(0, 8))
    return setImmediate(() => process.stdout.write(data.slice(8)))
  }
  if (method === 'account/read') return reply(id, { account: connected ? { type: 'chatgpt', email: 'fixture@example.org', planType: 'plus' } : null })
  if (method === 'model/list') return reply(id, { data: [{ model: 'native-test', displayName: 'Native fixture', hidden: false }] })
  if (method === 'windowsSandbox/readiness') return reply(id, { status: config.sandboxNotReady ? 'notConfigured' : 'ready' })
  if (method === 'account/rateLimits/read') return reply(id, { rateLimits: { primary: { usedPercent: 12, resetsAt: 1800000000 } } })
  if (method === 'account/login/start') {
    reply(id, { loginId: 'fixture-login', authUrl: config.badLogin ? 'https://example.org/login' : 'https://auth.openai.com/authorize?fixture=true' })
    if (!config.holdLogin && !config.badLogin) setTimeout(() => { connected = true; event('account/login/completed', { loginId: 'fixture-login', success: true }) }, 40)
    return
  }
  if (method === 'account/login/cancel') return reply(id, {})
  if (method === 'account/logout') { connected = false; return reply(id, {}) }
  if (method === 'thread/start') { threadId = randomUUID(); turnCount = 0; return reply(id, { thread: { id: threadId } }) }
  if (method === 'thread/resume') { threadId = params.threadId; return reply(id, { thread: { id: threadId } }) }
  if (method === 'thread/unsubscribe') return reply(id, { status: 'unsubscribed' })
  if (method === 'turn/start') {
    if (config.scenario === 'quota') return write({ id, error: { code: -32000, message: 'Codex usage limit reached. Try after reset.' } })
    turnId = randomUUID(); turnCount++
    reply(id, { turn: { id: turnId, status: 'inProgress' } })
    event('turn/started', { threadId, turn: { id: turnId } })
    return setImmediate(() => void turn(params))
  }
  if (method === 'turn/interrupt') { reply(id, {}); if (!config.scenario?.startsWith('ignore-interrupt')) finish('interrupted'); return }
  write({ id, error: { code: -32601, message: 'Unknown fixture method' } })
})
