import path from 'path'
import fs from 'fs'
import { createHash } from 'crypto'
import { CodexService } from '../src/core/codex'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GmailService } from '../src/core/gmail'
import { mailContent, prepareGmailDraft } from '../src/core/gmail-message'
import { Database } from '../src/core/db'
import { MemoryCredentialStore } from '../src/core/credentials'
import { RiotService } from '../src/core/service'
import { MockProvider } from '../src/core/provider'
import { ApprovalCard } from '../src/renderer/src/App'
import { GmailAccess, GmailConnection } from '../src/renderer/src/email'
import type { ApprovalView, RiotBridge } from '../src/shared/types'
import { makeApp, tempDir, waitFor } from './helpers'
import { FakeGmail, GMAIL_ACCOUNT, gmailCredentials, GOOGLE_CLIENT, ORIGINAL_MAIL } from './fixtures/gmail'

const draft = { to: 'customer@example.com', subject: 'Morning report', body: 'Hello,\nThe morning report is ready.\nThanks!' }
const tool = (name: string, args: unknown = {}) => ({ content: '', toolCalls: [{ id: name, name, arguments: JSON.stringify(args) }] })
const done = { content: 'Finished the requested email work.', toolCalls: [] }

function setup() {
  const fake = new FakeGmail(), credentials = gmailCredentials()
  const fixture = makeApp({ credentials, gmailFetchImpl: fake.fetch })
  fixture.app.updateSettings({ gmailAccount: GMAIL_ACCOUNT, gmailAccess: 'send' })
  return { ...fixture, fake, id: fixture.app.getSnapshot().ongoingConversationId! }
}

async function save(fixture: ReturnType<typeof setup>, body = draft) {
  fixture.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_save_draft', body)
  expect((await fixture.app.sendMessage(fixture.id, 'Draft an email to the customer.')).status).toBe('completed')
  return [...fixture.fake.drafts.keys()].at(-1)!
}

describe('local Gmail authorization', () => {
  it('uses a local state-checked PKCE callback and keeps credentials out of status', async () => {
    const credentials = new MemoryCredentialStore({ encryptionAvailable: true }), fake = new FakeGmail()
    let opened = ''
    const gmail = new GmailService({ credentials, fetchImpl: fake.fetch, openLink: url => { opened = url } })
    try {
      gmail.configure(GOOGLE_CLIENT)
      const connecting = gmail.connect()
      await waitFor(() => Boolean(opened))
      const url = new URL(opened)
      expect(url.origin).toBe('https://accounts.google.com')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('access_type')).toBe('offline')
      const redirect = new URL(url.searchParams.get('redirect_uri')!)
      expect(redirect.hostname).toBe('127.0.0.1')
      const wrong = new URL(redirect); wrong.search = new URLSearchParams({ state: 'wrong', code: 'bad' }).toString()
      expect((await fetch(wrong)).status).toBe(400)
      expect(fake.requests).toHaveLength(0)
      redirect.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'fixture-auth-code' }).toString()
      expect((await fetch(redirect)).status).toBe(200)
      const status = await connecting
      expect(status).toMatchObject({ connected: true, email: GMAIL_ACCOUNT, connecting: false })
      const exchange = fake.requests.find(item => item.url.href === 'https://oauth2.googleapis.com/token')!
      expect(exchange.body.code_verifier.length).toBeGreaterThanOrEqual(43)
      expect(createHash('sha256').update(exchange.body.code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
      const stateText = JSON.stringify(status)
      for (const secret of ['fixture-google-secret', 'fixture-access-token', 'fixture-refresh-token', 'fixture-auth-code']) expect(stateText).not.toContain(secret)
      expect(credentials.secretValues()).toEqual(expect.arrayContaining(['fixture-google-secret', 'fixture-access-token', 'fixture-refresh-token']))
    } finally { gmail.close() }
  })

  it('cancels authorization without making a token request and rejects non-desktop files', async () => {
    const fake = new FakeGmail(), credentials = new MemoryCredentialStore()
    let opened = ''
    const gmail = new GmailService({ credentials, fetchImpl: fake.fetch, openLink: url => { opened = url } })
    expect(() => gmail.configure('{"web":{"client_id":"web"}}')).toThrow(/Desktop/)
    gmail.configure(GOOGLE_CLIENT)
    const connecting = gmail.connect()
    await waitFor(() => Boolean(opened))
    gmail.cancelLogin()
    expect((await connecting).connected).toBe(false)
    expect(fake.requests).toHaveLength(0)
    gmail.close()
  })

  it('refreshes once across concurrent reads and handles a revoked refresh token', async () => {
    const fake = new FakeGmail(), credentials = gmailCredentials(0)
    const gmail = new GmailService({ credentials, fetchImpl: fake.fetch })
    const signal = new AbortController().signal
    await Promise.all([gmail.search(GMAIL_ACCOUNT, 'is:unread', 5, '', signal), gmail.readMessage(GMAIL_ACCOUNT, 'mail1', 0, signal)])
    expect(fake.requests.filter(item => item.url.href === 'https://oauth2.googleapis.com/token')).toHaveLength(1)
    credentials.set('gmail', JSON.stringify({ accessToken: 'old', refreshToken: 'revoked', email: GMAIL_ACCOUNT, expiresAt: 0 }))
    fake.refreshMode = 'revoked'
    await expect(gmail.search(GMAIL_ACCOUNT, '', 5, '', signal)).rejects.toThrow(/Reconnect Gmail/)
    expect(gmail.status().connected).toBe(false)
    gmail.close()
  })
})

describe('Gmail tools and reliable sending', () => {
  it('makes the existing connection discoverable for contextual mailbox requests', async () => {
    const f = setup()
    try {
      f.provider.handler = input => {
        const last = input.messages.at(-1)
        if (last?.role === 'user') return tool('describe_tools', { group: 'email' })
        if (last?.name === 'describe_tools') return tool('gmail_search', { query: 'is:unread' })
        return done
      }
      await f.app.sendMessage(f.id, 'What needs my attention today?')
      expect(f.provider.calls[0].tools?.some(item => item.name === 'gmail_search')).toBe(false)
      expect(f.provider.calls[0].messages.map(message => message.content).join('\n')).toContain(`Gmail is enabled for this bot: ${GMAIL_ACCOUNT}`)
      expect(f.provider.calls[1].tools?.some(item => item.name === 'gmail_search')).toBe(true)
      expect(f.fake.requests.some(item => item.url.pathname.endsWith('/messages'))).toBe(true)
    } finally { await f.app.close() }
  })

  it('searches and reads with no email body rendering, login, mark-read or idle calls', async () => {
    const f = setup()
    try {
      f.app.getSnapshot(); f.app.getGmailStatus()
      expect(f.fake.requests).toHaveLength(0)
      f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_search', { query: 'is:unread', limit: 5 })
      await f.app.sendMessage(f.id, 'Check my unread email.')
      const result = f.app.openConversation(f.id).messages.find(message => message.toolName === 'gmail_search')!
      expect(result.content).toContain('Morning report')
      expect(f.provider.calls[0].tools?.map(item => item.name)).toContain('gmail_search')
      f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_read_email', { id: 'mail1' })
      await f.app.sendMessage(f.id, 'Read that email.')
      expect(f.app.openConversation(f.id).messages.find(message => message.toolName === 'gmail_read_email')?.content).toContain('synthetic test email')
      expect(f.fake.requests.every(item => !item.init.method || item.init.method === 'GET')).toBe(true)
      expect(JSON.stringify(f.app.getSnapshot())).not.toContain('fixture-access-token')
    } finally { await f.app.close() }
  })

  it('builds a threaded Unicode reply and blocks header injection', () => {
    const ready = prepareGmailDraft(GMAIL_ACCOUNT, { body: 'The report is ready ✓', replyMessageId: 'mail1' }, ORIGINAL_MAIL)
    const raw = Buffer.from(ready.raw, 'base64url').toString('utf8')
    expect(ready.preview).toMatchObject({ to: ['customer@example.com'], subject: 'Re: Morning report' })
    expect(ready.threadId).toBe('thread1')
    expect(raw).toContain('In-Reply-To: <original@example.com>')
    expect(raw).toContain('References: <original@example.com>')
    expect(raw).toContain(Buffer.from('The report is ready ✓').toString('base64'))
    expect(() => prepareGmailDraft(GMAIL_ACCOUNT, { ...draft, to: 'customer@example.com\r\nBcc: other@example.com' })).toThrow()
    expect(() => prepareGmailDraft(GMAIL_ACCOUNT, { ...draft, subject: 'Hello\r\nBad: value' })).toThrow()
    expect(() => prepareGmailDraft(GMAIL_ACCOUNT, { ...draft, subject: 'Different topic' }, ORIGINAL_MAIL)).toThrow(/original subject/)
    const html = { ...ORIGINAL_MAIL, payload: { mimeType: 'text/html', body: { data: Buffer.from('<p>Hello &amp; welcome</p><script>bad()</script>').toString('base64url') } } }
    expect(mailContent(html).text).toContain('Hello & welcome')
    expect(mailContent(html).text).not.toContain('bad()')
  })

  it('keeps drafts unsent until review, then confirms one send and suppresses repeats', async () => {
    const f = setup()
    const seen: ApprovalView[] = []
    try {
      const id = await save(f)
      expect(f.fake.sendCount).toBe(0)
      f.app.onEvent(event => { if (event.type === 'approval' && event.approval) { seen.push(event.approval); f.app.resolveApproval(event.approval.id, true) } })
      f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_send_draft', { id })
      expect((await f.app.sendMessage(f.id, 'Send that email.')).status).toBe('completed')
      expect(seen[0]).toMatchObject({ kind: 'email', email: { to: ['customer@example.com'], subject: draft.subject, body: draft.body } })
      expect(f.fake.sendCount).toBe(1)
      await f.app.sendMessage(f.id, 'Can you check whether that draft was sent?')
      expect(f.fake.sendCount).toBe(1)
      expect(seen).toHaveLength(1)
      expect(f.app.openConversation(f.id).messages.filter(message => message.toolName === 'gmail_send_draft').at(-1)?.content).toContain('not sent again')
    } finally { await f.app.close() }
  })

  it('honors refusal, Stop, changed drafts and send permission removed during review', async () => {
    for (const decision of ['deny', 'stop', 'edit', 'permission'] as const) {
      const f = setup()
      try {
        const id = await save(f)
        f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_send_draft', { id })
        f.app.onEvent(event => {
          if (event.type !== 'approval' || !event.approval) return
          if (decision === 'stop') { f.app.stop(); return }
          if (decision === 'edit') f.fake.drafts.get(id)!.message.payload!.body!.data = Buffer.from('Changed outside Riot').toString('base64url')
          if (decision === 'permission') f.app.updateSettings({ gmailAccess: 'drafts' })
          f.app.resolveApproval(event.approval.id, decision !== 'deny')
        })
        await f.app.sendMessage(f.id, 'Send the draft.')
        expect(f.fake.sendCount).toBe(0)
        expect(f.fake.drafts.has(id)).toBe(true)
      } finally { await f.app.close() }
    }
  })

  it('retains uncertain send state across restart and never automatically resends it', async () => {
    const f = setup()
    const id = await save(f)
    f.fake.sendMode = 'uncertain'
    f.app.onEvent(event => { if (event.type === 'approval' && event.approval) f.app.resolveApproval(event.approval.id, true) })
    f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_send_draft', { id })
    expect((await f.app.sendMessage(f.id, 'Send the draft.')).status).toBe('paused')
    expect(f.fake.sendCount).toBe(1)
    expect(JSON.stringify({ activity: f.app.listActivity(), snapshot: f.app.getSnapshot(), logs: f.logger.lines })).not.toContain('fixture-access-token')
    await f.app.close()
    const next = makeApp({ dbPath: f.dbPath, credentials: f.credentials, gmailFetchImpl: f.fake.fetch })
    try {
      next.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_send_draft', { id })
      expect((await next.app.sendMessage(f.id, 'Retry that send.')).status).toBe('paused')
      expect(f.fake.sendCount).toBe(1)
      const db = new Database(f.dbPath)
      try { expect(db.getGmailDraft(GMAIL_ACCOUNT, id, next.app.getSnapshot().bot!.id)?.status).toBe('uncertain') } finally { db.close() }
    } finally { await next.app.close() }
  })

  it('treats a definitive Gmail refusal as unsent rather than an uncertain delivery', async () => {
    const f = setup()
    try {
      const id = await save(f)
      f.fake.sendMode = 'forbidden'
      f.app.onEvent(event => { if (event.type === 'approval' && event.approval) f.app.resolveApproval(event.approval.id, true) })
      f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_send_draft', { id })
      await f.app.sendMessage(f.id, 'Send that email.')
      expect(f.fake.sendCount).toBe(0)
      const db = new Database(f.dbPath)
      try { expect(db.getGmailDraft(GMAIL_ACCOUNT, id, f.app.getSnapshot().bot!.id)?.status).toBe('draft') } finally { db.close() }
    } finally { await f.app.close() }
  })

  it('deduplicates identical draft creation within one task and recovers a crashed send conservatively', async () => {
    const f = setup()
    f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : { content: '', toolCalls: ['first', 'repeat'].map(id => ({ id, name: 'gmail_save_draft', arguments: JSON.stringify(draft) })) }
    await f.app.sendMessage(f.id, 'Draft an email to the customer.')
    expect(f.fake.requests.filter(item => item.url.pathname.endsWith('/drafts') && item.init.method === 'POST')).toHaveLength(1)
    const id = [...f.fake.drafts.keys()][0], botId = f.app.getSnapshot().bot!.id
    const db = new Database(f.dbPath)
    const saved = db.getGmailDraft(GMAIL_ACCOUNT, id, botId)!
    db.claimGmailSend(GMAIL_ACCOUNT, id, botId, saved.fingerprint, Date.now())
    db.close()
    await f.app.close()
    const next = makeApp({ dbPath: f.dbPath, credentials: f.credentials, gmailFetchImpl: f.fake.fetch })
    try {
      next.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_send_draft', { id })
      expect((await next.app.sendMessage(f.id, 'Send that draft.')).status).toBe('paused')
      expect(f.fake.sendCount).toBe(0)
    } finally { await next.app.close() }
  })

  it('blocks email when tools/access are off, a different account is connected, or another bot owns the draft', async () => {
    const f = setup()
    try {
      const id = await save(f)
      f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_send_draft', { id })
      f.app.updateSettings({ gmailAccess: 'drafts' })
      await f.app.sendMessage(f.id, 'Send the draft.')
      expect(f.fake.sendCount).toBe(0)
      const other = await f.app.createBot({ name: 'Other', purpose: 'Other project', provider: 'openai', model: 'mock-model', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      f.app.updateSettings({ gmailAccount: GMAIL_ACCOUNT, gmailAccess: 'send' })
      await f.app.sendMessage(other.conversation.id, 'Send the draft from the other bot.')
      expect(f.fake.sendCount).toBe(0)
      const calls = f.fake.requests.length
      f.app.updateSettings({ gmailAccount: 'different@example.com' })
      f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_search')
      await f.app.sendMessage(other.conversation.id, 'Check email.')
      expect(f.fake.requests).toHaveLength(calls)
      f.app.updateSettings({ gmailAccount: GMAIL_ACCOUNT, gmailAccess: 'off' })
      await f.app.sendMessage(other.conversation.id, 'Check email.')
      expect(f.fake.requests).toHaveLength(calls)
      f.app.updateSettings({ gmailAccess: 'drafts', toolsEnabled: false })
      await f.app.sendMessage(other.conversation.id, 'Check email.')
      expect(f.fake.requests).toHaveLength(calls)
    } finally { await f.app.close() }
  })

  it('keeps identical replies to different conversations as separate drafts', async () => {
    const f = setup()
    try {
      f.fake.messages.set('mail2', { ...structuredClone(ORIGINAL_MAIL), id: 'mail2', threadId: 'thread2' })
      f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : { content: '', toolCalls: ['mail1', 'mail2'].map(id => ({ id, name: 'gmail_save_draft', arguments: JSON.stringify({ body: draft.body, reply_to_message_id: id }) })) }
      await f.app.sendMessage(f.id, 'Draft the same email reply in both customer conversations.')
      expect(f.fake.drafts.size).toBe(2)
      expect([...f.fake.drafts.values()].map(item => item.message.threadId).sort()).toEqual(['thread1', 'thread2'])
    } finally { await f.app.close() }
  })

  it('cannot bypass an uncertain send by rewriting a different existing draft', async () => {
    const f = setup()
    try {
      const id = await save(f), other = await save(f, { ...draft, body: 'A separate draft.' })
      f.fake.sendMode = 'uncertain'
      f.app.onEvent(event => { if (event.type === 'approval' && event.approval) f.app.resolveApproval(event.approval.id, true) })
      f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_send_draft', { id })
      expect((await f.app.sendMessage(f.id, 'Send the report email.')).status).toBe('paused')
      f.provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_save_draft', { ...draft, id: other })
      expect((await f.app.sendMessage(f.id, 'Update the other email draft with that same message.')).status).toBe('paused')
      expect(f.fake.requests.some(item => item.init.method === 'PUT')).toBe(false)
      expect(f.fake.sendCount).toBe(1)
    } finally { await f.app.close() }
  })

  it('runs scheduled email work with the owning bot’s binding after the selected bot changes', async () => {
    const dir = tempDir(), fake = new FakeGmail(), credentials = gmailCredentials(), provider = new MockProvider()
    const app = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), credentials, provider, gmailFetchImpl: fake.fetch })
    app.boot()
    try {
      const original = app.getSnapshot().bot!
      app.updateSettings({ model: 'mock-model', gmailAccount: GMAIL_ACCOUNT, gmailAccess: 'drafts' })
      const schedule = app.saveSchedule({ kind: 'task', title: 'Morning email', instructions: 'Read unread Gmail and summarize anything needing attention.', startAt: new Date(Date.now() + 3600_000).toISOString(), repeat: 'daily', timezone: 'America/New_York' })
      const other = await app.createBot({ name: 'Other', purpose: 'No email access', provider: 'openai', model: 'mock-model', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('gmail_search', { query: 'is:unread' })
      app.selectBot(original.id); app.runScheduleNow(schedule.id); app.selectBot(other.bot.id)
      await waitFor(() => app.listJobs('app').some(job => job.status === 'completed'))
      expect(fake.requests.some(item => item.url.pathname.endsWith('/messages'))).toBe(true)
      expect(app.getSnapshot().bot?.id).toBe(other.bot.id)
      expect(app.getSnapshot().current!.messages).toHaveLength(0)
      app.selectBot(original.id)
      expect(app.getSnapshot().current!.messages.some(message => message.toolName === 'gmail_search')).toBe(true)
      expect(fake.sendCount).toBe(0)
    } finally { await app.close() }
  })

  it('uses the same local Gmail tools and review card through native Codex, without API fallback', async () => {
    const dir = tempDir(), home = path.join(dir, 'codex'), fake = new FakeGmail(), credentials = gmailCredentials()
    fs.mkdirSync(home); fs.writeFileSync(path.join(home, 'fixture.json'), JSON.stringify({ scenario: 'gmail' }))
    const codex = new CodexService({ home, command: process.execPath, prefixArgs: [path.resolve('tests/fixtures/codex-server.cjs')] })
    const f = makeApp({ dbPath: path.join(dir, 'riot.sqlite'), credentials, gmailFetchImpl: fake.fetch, codex })
    try {
      f.app.updateSettings({ provider: 'codex', model: 'native-test', workspacePath: dir, gmailAccount: GMAIL_ACCOUNT, gmailAccess: 'send' })
      const approvals: ApprovalView[] = []
      f.app.onEvent(event => { if (event.type === 'approval' && event.approval) { approvals.push(event.approval); expect(f.app.pendingApproval()?.kind).toBe('email'); f.app.resolveApproval(event.approval.id, true) } })
      expect((await f.app.sendMessage(f.app.getSnapshot().ongoingConversationId!, 'Check unread email and send the requested reply.')).status).toBe('completed')
      expect(approvals[0]?.kind).toBe('email')
      expect(fake.sendCount).toBe(1)
      expect(f.provider.calls).toHaveLength(0)
      expect(JSON.stringify(f.app.getSnapshot())).not.toContain('fixture-refresh-token')
    } finally { await f.app.close() }
  })

  it('shows a readable send review with all recipients and keeps setup credentials out of forms', () => {
    const email = { from: GMAIL_ACCOUNT, to: [draft.to], cc: ['cc@example.com'], bcc: ['bcc@example.com'], subject: draft.subject, body: draft.body.repeat(100) }
    const html = renderToStaticMarkup(createElement(ApprovalCard, { approval: { id: 'test', kind: 'email', title: 'Send this email?', command: 'Not a terminal command', cwd: '', timeoutMs: 1000, warning: '', email }, onResolve() {} }))
    expect(html).toContain('Send email')
    expect(html).toContain('Don’t send')
    expect(html).toContain('bcc@example.com')
    expect(html.indexOf('approval-actions')).toBeGreaterThan(html.indexOf('email-review-body'))
    expect(html).not.toContain('Allow command')
    const status = { configured: false, connected: false, connecting: false, email: null, persistent: true, note: '' }
    const setupHtml = renderToStaticMarkup(createElement(GmailConnection, { api: {} as RiotBridge, status, onStatus() {}, onError() {} }))
    expect(setupHtml).toContain('Choose Google setup file')
    expect(setupHtml).not.toContain('type="password"')
    const f = makeApp()
    const access = renderToStaticMarkup(createElement(GmailAccess, { status, settings: f.app.getSnapshot().settings, botName: 'Riot', onChange() {}, onError() {} }))
    expect(access).toContain('No email access')
    return f.app.close()
  })
})
