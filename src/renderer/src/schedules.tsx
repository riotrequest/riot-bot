import { useState } from 'react'
import type { RiotBridge, ScheduleDraft, ScheduleView } from '../../shared/types'
import { localParts, wallTime } from '../../core/schedules'
import { EmptyState, Icon, messageOf } from './ui'

function inputTime(time: number, timezone: string): string {
  const p = localParts(time, timezone), pad = (value: number) => String(value).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

function dateLabel(time: number, timezone: string): string {
  return `${new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(time)} · ${timezone}`
}

export function SchedulesPane(props: { api: RiotBridge; schedules: ScheduleView[]; botName: string; onChange: (items: ScheduleView[]) => void; onBusy: (busy: boolean) => void; onJobs: () => void }) {
  const [editor, setEditor] = useState<ScheduleView | 'new' | null>(null)
  const [kind, setKind] = useState<ScheduleDraft['kind']>('reminder')
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [time, setTime] = useState('')
  const [repeat, setRepeat] = useState<ScheduleDraft['repeat']>('once')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const shown = props.schedules.filter(item => showCancelled || item.state !== 'cancelled')

  function edit(item: ScheduleView | 'new', nextKind: ScheduleDraft['kind'] = 'reminder'): void {
    setEditor(item); setError(''); setNote('')
    const zone = item === 'new' ? Intl.DateTimeFormat().resolvedOptions().timeZone : item.timezone
    setTimezone(zone)
    setKind(item === 'new' ? nextKind : item.kind)
    setTitle(item === 'new' ? '' : item.title)
    setInstructions(item === 'new' ? '' : item.instructions)
    setRepeat(item === 'new' ? 'once' : item.repeat)
    setTime(inputTime(item === 'new' ? Date.now() + 10 * 60000 : item.nextRunAt ?? item.startAt, zone))
  }

  async function act(work: () => Promise<unknown>, message: string): Promise<void> {
    if (busy) return
    setBusy(true); props.onBusy(true); setError(''); setNote('')
    try { await work(); props.onChange(await props.api.listSchedules()); setNote(message) }
    catch (reason) { setError(messageOf(reason)) }
    finally { setBusy(false); props.onBusy(false) }
  }

  return <section className="panel schedules-pane">
    <div className="runtime-intro"><div><h2>Remember it. Or let your bot handle it.</h2><p>Reminders notify you. Scheduled tasks put {props.botName} to work using its saved context and usual permissions.</p></div><div className="row"><button disabled={busy} onClick={() => edit('new', 'reminder')}><Icon name="plus" /> Reminder</button><button disabled={busy} className="send" onClick={() => edit('new', 'task')}><Icon name="plus" /> Bot task</button></div></div>
    <p className="help schedule-local-note"><Icon name="calendar" /> Runs on this computer while Riot is open or in the tray. Keep your computer on and awake.</p>
    <details className="subtle-details"><summary>How scheduled work runs</summary><p className="help">Reminders do not call an AI model. Bot tasks use the selected bot’s current model, budget, memory, history, and permissions; paid usage and approval rules still apply. We save relevant conversation context with each task. Missed reminders catch up after reopening; missed AI tasks wait for Run now. A failed or stopped task pauses its schedule. Cancelling a schedule stops future runs; stop work already started in Tasks.</p></details>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {note && <p className="save-success" role="status">{note}</p>}
    {editor && <form className="settings-section schedule-editor" onSubmit={event => {
      event.preventDefault()
      void act(async () => {
        const [date, clock] = time.split('T'), [year, month, day] = date.split('-').map(Number), [hour, minute] = clock.split(':').map(Number)
        const stamp = wallTime(year, month, day, hour, minute, timezone)
        if (inputTime(stamp, timezone) !== time) throw new Error('That clock time does not exist on this date. Choose another time.')
        await props.api.saveSchedule({ kind, title, instructions, repeat, timezone, startAt: new Date(stamp).toISOString() }, editor === 'new' ? undefined : editor.id)
        setEditor(null)
      }, 'Schedule saved.')
    }}><fieldset disabled={busy}>
      <div className="section-heading"><h3>{editor === 'new' ? 'Add a schedule' : `Edit ${editor.title}`}</h3><button type="button" onClick={() => setEditor(null)}>Cancel</button></div>
      <div className="schedule-kind"><label><input type="radio" name="schedule-kind" checked={kind === 'reminder'} onChange={() => setKind('reminder')} /><span><strong>Remind me</strong><small>Show a notification. No AI usage.</small></span></label><label><input type="radio" name="schedule-kind" checked={kind === 'task'} onChange={() => setKind('task')} /><span><strong>Run a bot task</strong><small>Do the work and save the result in Chat.</small></span></label></div>
      <label>Give it a name<input required minLength={2} maxLength={80} value={title} onChange={event => setTitle(event.target.value)} placeholder={kind === 'reminder' ? 'Check my work email' : 'Morning RLH email check'} /></label>
      <label>{kind === 'reminder' ? 'What should the reminder say?' : 'What should your bot do?'}<textarea required rows={3} maxLength={4000} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder={kind === 'reminder' ? 'Time to check your work email.' : 'Check the RLH email system we discussed and summarize anything that needs attention.'} /></label>
      <div className="grid"><label>First date & time<input type="datetime-local" required value={time} onChange={event => setTime(event.target.value)} /></label><label>Repeat<select value={repeat} onChange={event => setRepeat(event.target.value as ScheduleDraft['repeat'])}><option value="once">Just once</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Every week on this day</option></select></label></div>
      <p className="help">Times use {timezone}. {kind === 'task' ? 'Relevant chat context is saved with this task. Your bot’s current instructions and permissions also apply at run time.' : 'Riot will show a desktop notification and keep the reminder here.'}</p>
      <button className="send" type="submit">{busy ? 'Saving…' : 'Save schedule'}<Icon name="check" /></button>
    </fieldset></form>}
    {!shown.length && !editor && <EmptyState icon="calendar" title="A little help, right on time">Add a reminder here, or tell your bot “Remind me at 9 PM” or “Check the email system every weekday at 8 AM.” It can use the context of your conversation.</EmptyState>}
    {shown.map(item => <article className="runtime-card schedule-card" key={item.id}>
      <div className="runtime-heading"><div><span className="eyebrow">{item.kind === 'reminder' ? 'REMINDER' : 'BOT TASK'}</span><h3>{item.title}</h3></div><span className={`job-status ${item.lastStatus === 'running' ? 'running' : item.state === 'active' ? 'completed' : item.state}`}>{item.lastStatus === 'running' ? 'Working' : item.state === 'completed' ? 'Finished schedule' : item.state}</span></div>
      <p className="schedule-instructions">{item.instructions}</p>
      <p className="help"><strong>{({ once: 'Once', daily: 'Every day', weekdays: 'Weekdays', weekly: 'Every week' })[item.repeat]}</strong>{item.nextRunAt && item.state === 'active' ? ` · Next: ${dateLabel(item.nextRunAt, item.timezone)}` : ' · No automatic run pending'}</p>
      {item.lastRunAt && <p className="help">Last: {item.lastStatus === 'reminded' ? 'Reminder shown' : item.lastStatus || 'Checked'} · {dateLabel(item.lastRunAt, item.timezone)}</p>}
      {item.lastNote && <p className="schedule-note">{item.lastNote}</p>}
      {item.context && <details className="subtle-details"><summary>Saved conversation context</summary><pre>{item.context}</pre></details>}
      <div className="runtime-actions"><button disabled={busy} onClick={() => edit(item)}>Edit</button>{item.state === 'active' ? <button disabled={busy} onClick={() => void act(() => props.api.manageSchedule(item.id, 'pause'), 'Schedule paused.')}>Pause</button> : (item.repeat !== 'once' || item.startAt > Date.now()) && <button disabled={busy} onClick={() => void act(() => props.api.manageSchedule(item.id, 'resume'), 'Schedule resumed.')}>Resume</button>}
        <button disabled={busy} title="Does not change the next planned run. Bot tasks use normal AI usage." onClick={() => void act(() => props.api.runScheduleNow(item.id), item.kind === 'reminder' ? 'Reminder shown.' : 'Task added to the queue.')}>{item.kind === 'reminder' ? 'Show now' : 'Run now'}</button>
        {item.lastJobId && <button disabled={busy} onClick={props.onJobs}>View in Tasks</button>}{item.state !== 'cancelled' && <button disabled={busy} onClick={() => void act(() => props.api.manageSchedule(item.id, 'cancel'), 'Schedule cancelled. You can edit or resume it later.')}>Cancel schedule</button>}
      </div>
    </article>)}
    {props.schedules.some(item => item.state === 'cancelled') && <label className="check help"><input type="checkbox" checked={showCancelled} onChange={event => setShowCancelled(event.target.checked)} />Show cancelled schedules</label>}
  </section>
}
