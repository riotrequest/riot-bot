import { useEffect, useRef, useState } from 'react'
import type { EmailPreview, GmailStatus, PublicSettings, RiotBridge } from '../../shared/types'
import { messageOf } from './ui'

export function GmailConnection({ api, status, onStatus, onError }: { api: RiotBridge; status: GmailStatus | null; onStatus: (status: GmailStatus) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  async function action(work: () => Promise<GmailStatus | null>): Promise<void> {
    setBusy(true)
    try { const next = await work(); if (next) onStatus(next) } catch (error) { onError(messageOf(error)) } finally { setBusy(false) }
  }
  return <>
    <div className="page-intro"><h2>Your inbox, connected.</h2><p>Let your bots work with your existing Gmail or Google Workspace mailbox. The connection runs directly from this computer.</p></div>
    <section className="settings-section">
      <h3>{status?.connected ? status.email : status?.connecting ? 'Finish signing in with Google' : 'Connect Gmail'}</h3>
      <p className="help">{status?.connected ? 'Connected. Each bot gets access only when you enable it below or in Bot settings.' : status?.configured ? 'Your Google setup is ready. Sign in to choose the Gmail account you want to connect.' : 'For a self-hosted copy of Riot, Google needs a one-time app setup that you own. Choose its downloaded setup file, then sign in.'}</p>
      {status?.note && <p role="status">{status.note}</p>}
      {!status?.persistent && <p className="help">Windows credential protection is unavailable. This connection will last for this session only.</p>}
      <div className="row">
        {!status?.configured && <button className="send" type="button" disabled={busy} onClick={() => void action(() => api.importGmailClient())}>Choose Google setup file…</button>}
        {status?.configured && !status.connecting && <button className="send" type="button" disabled={busy} onClick={() => void action(() => api.connectGmail())}>{status.connected ? 'Reconnect Gmail' : 'Connect Gmail'}</button>}
        {status?.connecting && <button type="button" onClick={() => void action(() => api.cancelGmailLogin())}>Cancel sign-in</button>}
        {status?.connected && <button type="button" disabled={busy || status.connecting} onClick={() => void action(() => api.disconnectGmail())}>Disconnect Gmail</button>}
      </div>
      <details className="subtle-details" open={!status?.configured}>
        <summary>One-time Google setup</summary>
        <ol className="help">
          <li>Create or choose your own project in Google Cloud and enable Gmail API.</li>
          <li>Configure the Google Auth app name, audience, and Gmail read/compose scopes. If its status is Testing, add your Gmail address as a test user.</li>
          <li>Create an OAuth client with application type <strong>Desktop app</strong>, then download its JSON file.</li>
          <li>Choose that file here and connect. Keep the file out of Chat and your bot’s working folder.</li>
        </ol>
        <div className="row"><button type="button" onClick={() => void api.openExternal('https://console.cloud.google.com/apis/library/gmail.googleapis.com').catch(error => onError(messageOf(error)))}>Enable Gmail API</button><button type="button" onClick={() => void api.openExternal('https://console.cloud.google.com/auth/clients').catch(error => onError(messageOf(error)))}>Google app setup</button>{status?.configured && <button type="button" disabled={busy || status.connecting} onClick={() => void action(() => api.importGmailClient())}>Replace setup file…</button>}</div>
        <p className="help">Google apps in Testing usually require Gmail reconnection after seven days. Workspace policies and Google’s publishing requirements can also affect access.</p>
        <button type="button" onClick={() => void api.openExternal('https://developers.google.com/identity/protocols/oauth2/native-app').catch(error => onError(messageOf(error)))}>Google’s desktop sign-in guide</button>
      </details>
    </section>
    <div className="callout"><strong>One connection, access chosen per bot</strong><p>Google sign-in stays outside the chat. Credentials are protected locally when Windows protection is available. Email your bot reads is shared with that bot’s chosen AI provider. Riot does not host your mailbox.</p></div>
  </>
}

export function GmailAccess({ status, settings, botName, onChange, onManage, onError, onBusy, saveImmediately = false }: { status: GmailStatus | null; settings: PublicSettings; botName: string; onChange: (patch: Partial<PublicSettings>) => void | Promise<void>; onManage?: () => void; onError: (message: string) => void; onBusy?: (busy: boolean) => void; saveImmediately?: boolean }) {
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const bound = Boolean(status?.connected && settings.gmailAccount === status.email)
  async function change(access: PublicSettings['gmailAccess']): Promise<void> {
    setSaving(true); onBusy?.(true); setNote('')
    try { await onChange({ gmailAccess: access, gmailAccount: access === 'off' ? '' : status?.email ?? '' }); setNote(saveImmediately ? 'Email access saved.' : 'Save bot settings below to apply this change.') } catch (error) { onError(messageOf(error)) } finally { setSaving(false); onBusy?.(false) }
  }
  return <section className="settings-section">
    <h3>Email access for {botName}</h3>
    <p className="help">{status?.connected ? `Connected mailbox: ${status.email}` : 'Connect Gmail in app Settings → Email, then choose what this bot can do.'}</p>
    {settings.gmailAccount && !bound && <p className="help">This bot’s saved mailbox ({settings.gmailAccount}) is not connected. Choose access again to use the current mailbox.</p>}
    <label>What can this bot do?<select aria-label={`Email access for ${botName}`} value={bound ? settings.gmailAccess : settings.gmailAccount ? 'unavailable' : 'off'} disabled={saving || Boolean(status?.connecting)} onChange={event => void change(event.target.value as PublicSettings['gmailAccess'])}>
      {settings.gmailAccount && !bound && <option value="unavailable" disabled>Access paused — mailbox not connected</option>}
      <option value="off">No email access</option>
      <option value="drafts" disabled={!status?.connected}>Read email & save drafts</option>
      <option value="send" disabled={!status?.connected}>Read, draft & ask before sending</option>
    </select></label>
    <p className="help">Sending shows a review card with the recipients and message. This version supports plain-text email; attachments and mailbox cleanup can be handled in Gmail.</p>
    {!settings.toolsEnabled && <p className="help">Tools are currently off for this bot. Enable Allow tools in Bot settings → Files & tools to use email.</p>}
    {note && <p className="help" role="status">{note}</p>}
    {onManage && <button type="button" onClick={onManage}>Manage Gmail connection</button>}
  </section>
}

export function EmailApproval({ email, onResolve }: { email: EmailPreview; onResolve: (approved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  return <dialog ref={dialog} className="email-review-dialog" aria-labelledby="email-review-title" onCancel={event => { event.preventDefault(); onResolve(false) }}>
    <h2 id="email-review-title">Send this email?</h2>
    <div className="email-review-content" tabIndex={0} aria-label="Email preview">
    <dl className="email-review-addresses">
      <div><dt>From</dt><dd>{email.from}</dd></div>
      <div><dt>To</dt><dd>{email.to.join(', ')}</dd></div>
      {email.cc.length > 0 && <div><dt>Cc</dt><dd>{email.cc.join(', ')}</dd></div>}
      {email.bcc.length > 0 && <div><dt>Bcc</dt><dd>{email.bcc.join(', ')}</dd></div>}
      <div><dt>Subject</dt><dd>{email.subject}</dd></div>
    </dl>
    <pre className="email-review-body" tabIndex={0} aria-label="Email body">{email.body}</pre>
    </div>
    <p className="help">Review the full message above; scroll for more. Don’t send keeps the draft.</p>
    <div className="row approval-actions"><button type="button" onClick={() => onResolve(false)}>Don’t send</button><button type="button" className="send" onClick={() => onResolve(true)}>Send email</button></div>
  </dialog>
}
