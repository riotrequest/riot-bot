import { useState } from 'react'
import type { ArtifactView, Bot, JobView, RiotBridge } from '../../shared/types'
import { EmptyState, messageOf } from './ui'

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
    } catch (error) { props.onError(messageOf(error, 'Could not update this job.')) }
    finally { setBusy(null) }
  }
  return <section className="runtime-pane">
    <div className="runtime-intro"><div><h2>A clear view of what’s getting done.</h2><p>Follow your requests, review anything that needs you, or resume a paused task.</p></div>
      <label>Show <select aria-label="Task scope" value={scope} onChange={(event) => setScope(event.target.value as 'bot' | 'app')}><option value="bot">This bot</option><option value="app">All bots</option></select></label></div>
    <details className="subtle-details"><summary>Can I close the window while it works?</summary><p className="help">Yes. Riot stays in the system tray while this computer is on and awake. Choosing Quit pauses unfinished work; resume it here after reopening. Up to two bots can work at once. Requests for the same bot or working folder take turns.</p></details>
    {!jobs.length && <EmptyState icon="tasks" title="Your next task starts with a message">Ask your bot to do something in Chat. You’ll see its progress and finished work here.</EmptyState>}
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
    <div className="runtime-intro"><div><h2>Made by your bot. Kept for you.</h2><p>Find saved copies of the files this bot creates or changes.</p></div><input aria-label="Search saved files" placeholder="Find a file…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <details className="subtle-details"><summary>About saved versions</summary><p className="help">Copies are saved when a task ends, even if it stops early. They stay available after the original changes. Your working folder holds the current files. Large files, hidden folders and credentials are excluded. Show in folder opens Explorer; it does not run code.</p></details>
    {!artifacts.length && <EmptyState icon="files" title={query ? 'No matching files' : 'A home for your finished files'}>{query ? 'Try another filename or clear your search.' : 'Ask your bot to create a file. A saved copy will appear here when the task ends.'}</EmptyState>}
    <div className="runtime-list">{artifacts.map((item) => <article className="runtime-card artifact-card" key={item.id}>
      <div><strong>{item.name}</strong>{item.relativePath !== item.name && <p className="artifact-path">{item.relativePath}</p>}<p className="help">Version {item.version} · {size(item.bytes)} · {date(item.createdAt)}</p></div>
      <button onClick={() => void props.api.revealArtifact(item.id).catch((error: unknown) => props.onError(messageOf(error, 'Could not show this file.')))}>Show in folder</button>
    </article>)}</div>
  </section>
}

function date(value: number): string { return new Date(value).toLocaleString() }
function size(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
