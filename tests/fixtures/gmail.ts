import type { GmailMessage } from '../../src/core/gmail-message'
import { GMAIL_SCOPES } from '../../src/core/gmail'
import { MemoryCredentialStore } from '../../src/core/credentials'

export const GMAIL_ACCOUNT = 'owner@example.com'
export const GOOGLE_CLIENT = JSON.stringify({ installed: { client_id: 'fixture.apps.googleusercontent.com', client_secret: 'fixture-google-secret', auth_uri: 'https://ignored.example.test', token_uri: 'https://ignored.example.test' } })
export const ORIGINAL_MAIL: GmailMessage = { id: 'mail1', threadId: 'thread1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Can you send the morning report?', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Customer <customer@example.com>' }, { name: 'To', value: GMAIL_ACCOUNT }, { name: 'Subject', value: 'Morning report' }, { name: 'Message-ID', value: '<original@example.com>' }, { name: 'Date', value: 'Tue, 3 Nov 2026 09:00:00 -0500' }], body: { data: Buffer.from('Can you send the morning report?\nThis is synthetic test email.').toString('base64url') } } }

/** Offline Gmail boundary. Every HTTP call stays in this function; it never uses the network. */
export class FakeGmail {
  requests: { url: URL; init: RequestInit; body: any }[] = []
  drafts = new Map<string, { id: string; message: GmailMessage; raw: string }>()
  messages = new Map<string, GmailMessage>([['mail1', structuredClone(ORIGINAL_MAIL)]])
  sendCount = 0
  sendMode: 'ok' | 'uncertain' | 'forbidden' = 'ok'
  refreshMode: 'ok' | 'revoked' = 'ok'
  profileEmail = GMAIL_ACCOUNT
  private next = 0
  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const body = typeof init.body === 'string' ? init.headers && (init.headers as Record<string, string>)['Content-Type'] === 'application/x-www-form-urlencoded' ? Object.fromEntries(new URLSearchParams(init.body)) : JSON.parse(init.body) : null
    this.requests.push({ url, init, body })
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.href === 'https://oauth2.googleapis.com/token') {
      if (body.grant_type === 'refresh_token' && this.refreshMode === 'revoked') return json({ error: 'invalid_grant', private: 'fixture-google-secret' }, 400)
      return json({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 3600, scope: GMAIL_SCOPES.join(' ') })
    }
    if (url.origin !== 'https://gmail.googleapis.com') throw new Error('Unexpected network destination in Gmail fixture')
    const route = url.pathname.replace('/gmail/v1/users/me', '')
    if (route === '/profile') return json({ emailAddress: this.profileEmail })
    if (route === '/messages') return json({ messages: [...this.messages.values()].map(message => ({ id: message.id, threadId: message.threadId })), nextPageToken: 'fixture-page' })
    if (route.startsWith('/messages/')) return this.messages.has(route.slice(10)) ? json(this.messages.get(route.slice(10))) : json({}, 404)
    if (route.startsWith('/threads/')) return json({ id: route.slice(9), messages: [...this.messages.values()] })
    if (route === '/drafts/send') {
      const draft = this.drafts.get(body.id)
      if (!draft) return json({}, 404)
      if (this.sendMode === 'forbidden') return json({ error: { message: 'Private authorization details must not be exposed.' } }, 403)
      this.sendCount++
      this.drafts.delete(body.id)
      if (this.sendMode === 'uncertain') throw new Error('Lost response after fixture Gmail accepted send; fixture-access-token')
      return json({ id: `sent${this.sendCount}`, threadId: draft.message.threadId, labelIds: ['SENT'] })
    }
    if ((route === '/drafts' && init.method === 'POST') || route.startsWith('/drafts/') && init.method === 'PUT') {
      const id = route === '/drafts' ? `draft${++this.next}` : route.slice(8)
      const raw = Buffer.from(body.message.raw, 'base64url').toString('utf8')
      const divider = raw.indexOf('\r\n\r\n')
      const headerLines = raw.slice(0, divider).replace(/\r\n[ \t]+/g, ' ').split('\r\n')
      const message: GmailMessage = { id: `draftmail${this.next}`, threadId: body.message.threadId ?? 'newthread', labelIds: ['DRAFT'], payload: { mimeType: 'text/plain', headers: headerLines.map(line => ({ name: line.slice(0, line.indexOf(':')), value: line.slice(line.indexOf(':') + 1).trim() })), body: { data: Buffer.from(raw.slice(divider + 4), 'base64').toString('base64url') } } }
      this.drafts.set(id, { id, message, raw })
      return json({ id, message: { id: message.id, threadId: message.threadId } })
    }
    if (route.startsWith('/drafts/')) return this.drafts.has(route.slice(8)) ? json(this.drafts.get(route.slice(8))) : json({}, 404)
    throw new Error(`Unhandled Gmail fixture route ${route}`)
  }
}

export function gmailCredentials(expiresAt = Date.now() + 3600_000) {
  const credentials = new MemoryCredentialStore({ encryptionAvailable: true })
  credentials.set('gmail-client', JSON.stringify({ clientId: 'fixture.apps.googleusercontent.com', clientSecret: 'fixture-google-secret' }))
  credentials.set('gmail', JSON.stringify({ accessToken: 'fixture-access-token', refreshToken: 'fixture-refresh-token', expiresAt, email: GMAIL_ACCOUNT }))
  return credentials
}
