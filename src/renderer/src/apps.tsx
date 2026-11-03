import { useState } from 'react'
import type { GmailStatus, PublicSettings, RiotBridge } from '../../shared/types'
import { GmailAccess, GmailConnection } from './email'
import { Icon } from './ui'

export function AppsPane({ api, botName, settings, gmail, onGmail, onChange, onError, onBusy }: {
  api: RiotBridge
  botName: string
  settings: PublicSettings
  gmail: GmailStatus | null
  onGmail: (status: GmailStatus) => void
  onChange: (patch: Partial<PublicSettings>) => Promise<void>
  onError: (message: string) => void
  onBusy: (busy: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const bound = Boolean(gmail?.connected && settings.gmailAccount === gmail.email)
  const enabled = bound && settings.gmailAccess !== 'off'
  const paused = settings.gmailAccess !== 'off' && (!bound || !settings.toolsEnabled)
  const state = paused ? 'Access paused' : enabled ? `On for ${botName}` : `Off for ${botName}`
  const description = paused
    ? !bound ? 'This bot’s saved mailbox is not connected. Choose a connected account below to restore access.' : 'Email access is saved, but tools are off for this bot. Turn on Allow tools in Bot settings → Files & tools.'
    : enabled ? settings.gmailAccess === 'send' ? `${botName} can read email, save drafts, and ask you before sending.` : `${botName} can read email and save drafts. Sending is off.`
    : gmail?.connected ? `${gmail.email} is connected to Riot. Choose what ${botName} can do with this mailbox.` : 'Connect your existing Gmail or Google Workspace mailbox to read email and prepare replies.'

  return <section className="panel apps-pane" aria-label={`Apps for ${botName}`}>
    <div className="page-intro"><h2>Bring your apps into the conversation.</h2><p>Choose what {botName} can access. Your other bots keep their own permissions.</p></div>
    <article className="app-card" aria-label="Gmail">
      <div className="app-card-heading">
        <span className="app-card-icon"><Icon name="mail" /></span>
        <div className="app-card-title"><h3>Gmail</h3><p className="help">Email · Google Workspace</p><span className={`app-access-status ${paused ? 'paused' : enabled ? 'enabled' : ''}`}>{state}</span></div>
        <button type="button" className={enabled ? undefined : 'send'} aria-expanded={expanded} aria-controls="gmail-app-details" onClick={() => setExpanded(current => !current)}>{expanded ? 'Close details' : gmail?.connected ? 'Manage Gmail' : 'Connect Gmail'}</button>
      </div>
      <p className="app-card-description">{description}</p>
      {enabled && <p className="app-card-account">Connected mailbox: {settings.gmailAccount}</p>}
      {expanded && <div id="gmail-app-details" className="app-card-details">
        {!gmail?.connected && <GmailConnection api={api} status={gmail} onStatus={onGmail} onError={onError} showIntro={false} />}
        {(gmail?.connected || settings.gmailAccount) && <GmailAccess status={gmail} settings={settings} botName={botName} onChange={onChange} onError={onError} onBusy={onBusy} />}
        {gmail?.connected && <details className="app-account-details">
          <summary>Manage shared Gmail connection</summary>
          <p className="help">This account connection is shared across Riot. Disconnecting it signs Gmail out for every bot. To stop only {botName}, choose No email access above.</p>
          <GmailConnection api={api} status={gmail} onStatus={onGmail} onError={onError} showIntro={false} />
        </details>}
      </div>}
    </article>
    <p className="help apps-save-note">Access changes save immediately. You can change or turn off a bot’s access here at any time.</p>
  </section>
}
