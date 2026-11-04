import { useEffect, useRef, useState } from 'react'
import type { EmailPreview, GmailRuleDraftInput, GmailRulePreview, GmailRuleView, GmailSendActivity, GmailStatus, PublicSettings, RiotBridge } from '../../shared/types'
import { messageOf } from './ui'

export function GmailConnection({ api, status, onStatus, onError, showIntro = true }: { api: RiotBridge; status: GmailStatus | null; onStatus: (status: GmailStatus) => void; onError: (message: string) => void; showIntro?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function action(work: () => Promise<GmailStatus | null>): Promise<void> {
    setBusy(true)
    try { const next = await work(); if (next) onStatus(next) } catch (error) { onError(messageOf(error)) } finally { setBusy(false) }
  }
  return <>
    {showIntro && <div className="page-intro"><h2>Your inbox, connected.</h2><p>Let your bots work with your existing Gmail or Google Workspace mailbox. The connection runs directly from this computer.</p></div>}
    <section className="settings-section">
      <h3>{status?.connected ? status.email : status?.connecting ? 'Finish signing in with Google' : 'Connect Gmail'}</h3>
      <p className="help">{status?.connected ? 'Connected to Riot. Choose each bot’s access in Workspace → Apps → Gmail.' : status?.configured ? 'Your Google setup is ready. Sign in to choose the Gmail account you want to connect.' : 'For a self-hosted copy of Riot, Google needs a one-time app setup that you own. Choose its downloaded setup file, then sign in.'}</p>
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

export function GmailAccess({ status, settings, botName, onChange, onError, onBusy }: { status: GmailStatus | null; settings: PublicSettings; botName: string; onChange: (patch: Partial<PublicSettings>) => void | Promise<void>; onError: (message: string) => void; onBusy?: (busy: boolean) => void; }) {
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const bound = Boolean(status?.connected && settings.gmailAccount === status.email)
  async function change(access: PublicSettings['gmailAccess']): Promise<void> {
    setSaving(true); onBusy?.(true); setNote('')
    try { await onChange({ gmailAccess: access, gmailAccount: access === 'off' ? '' : status?.email ?? '' }); setNote('Email access saved.') } catch (error) { onError(messageOf(error)) } finally { setSaving(false); onBusy?.(false) }
  }
  return <section className="settings-section">
    <h3>Email access for {botName}</h3>
    <p className="help">{status?.connected ? `Connected mailbox: ${status.email}` : 'Connect Gmail in Workspace → Apps, then choose what this bot can do.'}</p>
    {settings.gmailAccount && !bound && <p className="help">This bot’s saved mailbox ({settings.gmailAccount}) is not connected. Choose access again to use the current mailbox.</p>}
    <label>What can this bot do?<select aria-label={`Email access for ${botName}`} value={bound ? settings.gmailAccess : settings.gmailAccount ? 'unavailable' : 'off'} disabled={saving || Boolean(status?.connecting)} onChange={event => void change(event.target.value as PublicSettings['gmailAccess'])}>
      {settings.gmailAccount && !bound && <option value="unavailable" disabled>Access paused — mailbox not connected</option>}
      <option value="off">No email access</option>
      <option value="drafts" disabled={!status?.connected}>Read email & save drafts</option>
      <option value="send" disabled={!status?.connected}>Read, draft & send</option>
    </select></label>
    <p className="help">Riot asks before every send unless you turn on a reply rule for this bot. A reply rule can send only the exact replies you approve. Attachments and mailbox cleanup stay in Gmail.</p>
    {!settings.toolsEnabled && <p className="help">Tools are currently off for this bot. Enable Allow tools in Bot settings → Files & tools to use email.</p>}
    {note && <p className="help" role="status">{note}</p>}
  </section>
}

export function GmailAutonomy({ api, botName, settings, initial, onError }: { api: RiotBridge; botName: string; settings: PublicSettings; initial?: { rules: GmailRuleView[]; activity: GmailSendActivity[] }; onError: (message: string) => void }) {
  const [rules, setRules] = useState<GmailRuleView[]>(initial?.rules ?? [])
  const [activity, setActivity] = useState<GmailSendActivity[]>(initial?.activity ?? [])
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async (): Promise<void> => {
    const next = await api.listGmailRules()
    setRules(next.rules)
    setActivity(next.activity)
  }
  useEffect(() => {
    if (initial) return
    let live = true
    void api.listGmailRules().then(next => { if (live) { setRules(next.rules); setActivity(next.activity) } }).catch(() => undefined)
    const stop = api.onEvent(event => { if (event.type === 'gmail-rules-changed') void load().catch(() => undefined) })
    return () => { live = false; stop() }
  }, [api, initial])
  async function save(input: GmailRuleDraftInput): Promise<void> {
    setBusy(true)
    try { await api.saveGmailRule(input); setEditing(null); if (!initial) await load() } catch (error) { onError(messageOf(error)) } finally { setBusy(false) }
  }
  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    setBusy(true)
    try { await api.setGmailRuleEnabled(id, enabled); if (!initial) await load() } catch (error) { onError(messageOf(error)) } finally { setBusy(false) }
  }
  const active = rules.filter(rule => rule.appliesNow).length
  return <section className="settings-section gmail-autonomy" aria-label={`What ${botName} can do on its own`}>
    <h3>What this bot can do on its own</h3>
    <p className="help">These rules affect only {botName}. {active ? `${active} reply rule${active === 1 ? ' is' : 's are'} on for this mailbox.` : 'Nothing sends on its own until you turn a reply rule on.'} Other bots keep asking before every send.</p>
    {rules.map(rule => editing === rule.id ? <RuleForm key={rule.id} rule={rule} mailbox={settings.gmailAccount} busy={busy} onCancel={() => setEditing(null)} onSave={save} /> : <RuleCard key={rule.id} rule={rule} busy={busy} onEdit={() => setEditing(rule.id)} onEnabled={setEnabled} />)}
    {editing === 'new' ? <RuleForm mailbox={settings.gmailAccount} busy={busy} onCancel={() => setEditing(null)} onSave={save} /> : <button type="button" disabled={busy || !settings.gmailAccount} onClick={() => setEditing('new')}>Add a reply rule</button>}
    {!settings.gmailAccount && <p className="help">Connect a mailbox before adding a reply rule.</p>}
    {activity.length > 0 && <details className="subtle-details"><summary>Recent send decisions</summary>{activity.map(item => <p key={`${item.createdAt}-${item.draftId}`} className="help">{item.summary} — {item.outcome === 'sent' ? 'Sent' : item.outcome === 'uncertain' ? 'Unconfirmed' : item.outcome === 'declined' ? 'Not sent' : 'Not sent'}. {item.reason}{item.messageId ? ` Receipt ${item.messageId}.` : ''}</p>)}</details>}
  </section>
}

function RuleCard({ rule, busy, onEdit, onEnabled }: { rule: GmailRuleView; busy: boolean; onEdit: () => void; onEnabled: (id: string, enabled: boolean) => Promise<void> }) {
  const reply = rule.templates[0] ? `“${rule.templates[0].slice(0, 160)}${rule.templates[0].length > 160 ? '…' : ''}”` : 'No exact reply yet'
  const status = rule.appliesNow ? 'On' : rule.enabled ? 'Paused' : 'Off'
  return <article className="gmail-rule-card">
    <div className="runtime-heading"><strong>{rule.title}</strong><span className={`app-access-status ${rule.appliesNow ? 'enabled' : 'paused'}`}>{status}</span></div>
    <p className="help">Mailbox {rule.account}. Replies to {rule.recipients.join(', ') || 'no one yet'}{rule.threadIds.length ? ` in ${rule.threadIds.join(', ')}` : ' in an existing conversation'}.</p>
    <p className="gmail-rule-template">{reply}{rule.templates.length > 1 ? ` and ${rule.templates.length - 1} more exact ${rule.templates.length === 2 ? 'reply' : 'replies'}` : ''}</p>
    <p className="help">Up to {rule.dailySendLimit} sends a day{rule.sendsToday ? ` · ${rule.sendsToday} used today` : ''}. Refunds in the original message or the reply, other recipients, and anything that does not match still wait for you.</p>
    {rule.blockedReason && <p className="help">{rule.blockedReason}</p>}
    {(rule.excludedRecipients.length > 0 || rule.excludedPhrases.length > 0) && <p className="help">Always review: {[...rule.excludedRecipients, ...rule.excludedPhrases].join(', ')}.</p>}
    <div className="row"><button type="button" disabled={busy} onClick={onEdit}>Edit</button><button type="button" disabled={busy} onClick={() => void onEnabled(rule.id, !rule.enabled)}>{rule.enabled ? 'Turn off' : 'Turn on'}</button></div>
  </article>
}

function RuleForm({ rule, mailbox, busy, onCancel, onSave }: { rule?: GmailRuleView; mailbox: string; busy: boolean; onCancel: () => void; onSave: (input: GmailRuleDraftInput) => Promise<void> }) {
  const [title, setTitle] = useState(rule?.title ?? '')
  const [recipients, setRecipients] = useState(rule?.recipients.join(', ') ?? '')
  const [templates, setTemplates] = useState(rule?.templates.length ? rule.templates : [''])
  const [threads, setThreads] = useState(rule?.threadIds.join(', ') ?? '')
  const [excludedRecipients, setExcludedRecipients] = useState(rule?.excludedRecipients.join(', ') ?? '')
  const [excludedPhrases, setExcludedPhrases] = useState(rule?.excludedPhrases.join(' | ') ?? '')
  const [limit, setLimit] = useState(String(rule?.dailySendLimit ?? 5))
  const input = (enabled: boolean): GmailRuleDraftInput => ({ id: rule?.id, title: title.trim() || 'Reply rule', recipients: splitList(recipients), threadIds: splitList(threads), templates: templates.map(item => item.trim()).filter(Boolean), excludedRecipients: splitList(excludedRecipients), excludedPhrases: excludedPhrases.split('|').map(item => item.trim()).filter(Boolean), dailySendLimit: Number(limit), enabled })
  return <form className="gmail-rule-form" onSubmit={event => { event.preventDefault(); void onSave(input(false)) }}>
    <p className="help">Mailbox: {mailbox || 'Not connected'}. Only exact replies to the addresses below can send without asking. This bot cannot invent the rest.</p>
    <label>Name<input value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
    <label>Send only to<input value={recipients} disabled={busy} placeholder="name@example.com" onChange={event => setRecipients(event.target.value)} /></label>
    {templates.map((template, index) => <label key={index}>Exact reply {templates.length > 1 ? index + 1 : ''}<textarea value={template} disabled={busy} rows={4} onChange={event => setTemplates(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}
    {templates.length < 5 && <button type="button" disabled={busy} onClick={() => setTemplates(current => [...current, ''])}>Add another exact reply</button>}
    <label>Sends per day<input type="number" min={1} max={20} value={limit} disabled={busy} onChange={event => setLimit(event.target.value)} /></label>
    <details className="subtle-details"><summary>Limit further</summary>
      <label>Only these conversation IDs<input value={threads} disabled={busy} onChange={event => setThreads(event.target.value)} /></label>
      <label>Always review these addresses<input value={excludedRecipients} disabled={busy} onChange={event => setExcludedRecipients(event.target.value)} /></label>
      <label>Always review these phrases<input value={excludedPhrases} disabled={busy} placeholder="2–200 characters, separated by |" onChange={event => setExcludedPhrases(event.target.value)} /></label>
    </details>
    <p className="help">Save paused stores these edits and turns automatic sending off. Turn on is the only action that enables this rule.</p>
    <div className="row"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" disabled={busy}>Save paused</button><button type="button" className="send" disabled={busy} onClick={() => void onSave(input(true))}>Turn on</button></div>
  </form>
}

function splitList(value: string): string[] {
  return value.split(/[,\s]+/).map(item => item.trim()).filter(Boolean)
}

export function GmailRuleApproval({ rule, onResolve }: { rule: GmailRulePreview; onResolve: (approved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  return <dialog ref={dialog} className="email-review-dialog" aria-labelledby="gmail-rule-title" onCancel={event => { event.preventDefault(); onResolve(false) }}>
    <h2 id="gmail-rule-title">Turn on this reply rule?</h2>
    <div className="email-review-content" tabIndex={0} aria-label="Reply rule preview">
      <p><strong>{rule.title}</strong> for {rule.account}. This bot only.</p>
      <p>Can send on its own: {rule.templates.length ? 'these exact replies' : 'nothing yet'} to {rule.recipients.join(', ') || 'no recipients yet'}{rule.threadIds.length ? `, only in ${rule.threadIds.join(', ')}` : ', in an existing conversation'}.</p>
      {rule.templates.map(template => <pre key={template} className="email-review-body gmail-rule-template">{template}</pre>)}
      {(rule.excludedRecipients.length > 0 || rule.excludedPhrases.length > 0) && <p>Always review: {[...rule.excludedRecipients, ...rule.excludedPhrases].join(', ')}.</p>}
      <p>Limit: {rule.dailySendLimit} sends a day. After that, Riot asks again.</p>
      <p className="help">{rule.limits}</p>
    </div>
    <div className="row approval-actions"><button type="button" onClick={() => onResolve(false)}>Not now</button><button type="button" className="send" onClick={() => onResolve(true)}>Turn on</button></div>
  </dialog>
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
