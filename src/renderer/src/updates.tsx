import { useState } from 'react'
import type { AppUpdateState, RiotBridge } from '../../shared/types'
import { messageOf } from './ui'

export function UpdatesPane({ update, api, unsaved }: {
  update: AppUpdateState | null
  api: RiotBridge
  unsaved: boolean
}) {
  const [actionError, setActionError] = useState('')
  function act(action: () => Promise<void>): void {
    setActionError('')
    void action().catch((error: unknown) => setActionError(messageOf(error)))
  }

  return <>
    <div className="page-intro">
      <h2>App updates</h2>
      <p>See which version is installed and how this copy gets new ones.</p>
    </div>
    <section className="settings-section">
      <h3>{update ? `Riot Bot ${update.currentVersion}` : 'Riot Bot'}</h3>
      <div className="help" role="status">
        {!update && <p>Loading update information…</p>}
        {update?.status === 'unavailable' && <p>This copy does not update itself. In-app updates work in copies installed from a signed release. For a source checkout, update it with Git. For an installer you built yourself, build and run a new one; your bots and data stay in place.</p>}
        {update?.status === 'checking' && <p>Checking GitHub Releases…</p>}
        {update?.status === 'current' && <p>You’re up to date.</p>}
        {update?.status === 'available' && <p>Riot Bot {update.version} is available.</p>}
        {update?.status === 'downloading' && <p>Downloading Riot Bot {update.version}…</p>}
        {update?.status === 'ready' && <p>Riot Bot {update.version} is ready to install. Finish or pause queued and running work before restarting.</p>}
        {update?.status === 'installing' && <p>Verifying the update before restarting…</p>}
        {update?.status === 'error' && <p>{update.message}</p>}
      </div>
      {update?.status === 'downloading' && <progress aria-label="Update download" max={100} value={update.progress} />}
      <div className="row">
        {update && ['idle', 'current', 'error'].includes(update.status) && <button type="button" onClick={() => act(api.checkForUpdates)}>Check for updates</button>}
        {update?.status === 'available' && <button type="button" onClick={() => act(api.downloadUpdate)}>Download update</button>}
        {update?.status === 'ready' && <button type="button" disabled={unsaved} onClick={() => act(api.installUpdate)}>Restart and install</button>}
      </div>
      {update?.status === 'ready' && unsaved && <p className="help">Save your app settings before restarting.</p>}
      {actionError && <p className="danger" role="alert">{actionError}</p>}
    </section>
  </>
}
