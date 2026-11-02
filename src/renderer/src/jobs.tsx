import { useState } from 'react'
import type { ArtifactView, Bot, JobView, RiotBridge } from '../../shared/types'

export function JobsPane(props: {
  api: RiotBridge
  jobs: JobView[]
  bots: Bot[]
  botId: string | null
  onOpen: (botId: string) => void
  onError: (message: string) => void
}) {
  const [scope, setScope] = useState<'bot' | 'app'>('bot')
  const [busy, setBusy] = useState<string | null>(null)
  const jobs = props.jobs.filter((job) => scope === 'app' || job.botId === props.botId)
  async function act(job: JobView, resume: boolean): Promise<void> {
    setBusy(job.id)
    try {
      if (resume) await props.api.resumeJob(job.id)
      else await props.api.cancelJob(job.id)
    } catch (error) { props.onError(error instanceof Error ? error.message : 'Could not update this job.') }
    finally { setBusy(null) }
  }
  return <section className="runtime-pane">
    <div className="runtime-intro"><div><h2>Your work</h2><p>Two bots can work at once. Messages for the same bot run in order. Bots sharing a workspace take turns.</p></div>
      <label>Show <select aria-label="Job scope" value={scope} onChange={(event) => setScope(event.target.value as 'bot' | 'app')}><option value="bot">This bot</option><option value="app">All bots</option></select></label></div>
    <p className="help">Closing the chat keeps Riot in the system tray. Quit pauses unfinished work; choose Resume after reopening. This computer must stay on and awake.</p>
    {!jobs.length && <p className="empty">No jobs yet. Send a message to give this bot something to do.</p>}
    <div className="runtime-list">{jobs.map((job) => {
      const resumable = ['paused', 'interrupted', 'failed', 'cancelled'].includes(job.status)
      const cancellable = ['queued', 'running', 'paused', 'interrupted'].includes(job.status)
      return <article className="runtime-card" key={job.id}>
        <div className="runtime-heading"><button className="quiet" onClick={() => props.onOpen(job.botId)}>{props.bots.find((bot) => bot.id === job.botId)?.name ?? 'Bot'}</button><span className={`job-status ${job.status}`}>{job.awaitingApproval ? 'Needs approval' : job.status}</span></div>
        <p className="job-request">{job.text}</p>
        <p className="help">{date(job.createdAt)}{job.attachmentCount ? ` · ${job.attachmentCount} attachment${job.attachmentCount === 1 ? '' : 's'}` : ''}{job.attempt > 1 ? ` · Attempt ${job.attempt}` : ''}</p>
        {job.note && <p className="job-note">{job.note}</p>}
        <div className="runtime-actions">
          {job.awaitingApproval && <button onClick={() => props.onOpen(job.botId)}>Review approval</button>}
          {resumable && <button disabled={busy === job.id} onClick={() => void act(job, true)}>Resume</button>}
          {cancellable && <button disabled={busy === job.id} onClick={() => void act(job, false)}>{job.status === 'running' ? 'Stop' : 'Cancel'}</button>}
        </div>
      </article>
    })}</div>
  </section>
}

export function LibraryPane(props: { api: RiotBridge; artifacts: ArtifactView[]; onError: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const artifacts = props.artifacts.filter((item) => item.relativePath.toLowerCase().includes(query.trim().toLowerCase()))
  return <section className="runtime-pane">
    <div className="runtime-intro"><div><h2>Saved files</h2><p>File versions captured when this bot finishes a job. The workspace keeps your working files.</p></div><input aria-label="Search saved files" placeholder="Find a file…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <p className="help">Saved copies stay available if the original changes or is deleted. HTML and code open as files; no preview runs automatically. Large files, hidden folders and credential files are excluded.</p>
    {!artifacts.length && <p className="empty">{query ? 'No matching files.' : 'Files this bot creates or changes will appear here after its job ends.'}</p>}
    <div className="runtime-list">{artifacts.map((item) => <article className="runtime-card artifact-card" key={item.id}>
      <div><strong>{item.name}</strong>{item.relativePath !== item.name && <p className="artifact-path">{item.relativePath}</p>}<p className="help">Version {item.version} · {size(item.bytes)} · {date(item.createdAt)}</p></div>
      <button onClick={() => void props.api.revealArtifact(item.id).catch((error: unknown) => props.onError(error instanceof Error ? error.message : 'Could not show this file.'))}>Show saved file</button>
    </article>)}</div>
  </section>
}

function date(value: number): string { return new Date(value).toLocaleString() }
function size(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
