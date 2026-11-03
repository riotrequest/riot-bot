import type { ScheduleDraft, ScheduleView } from '../shared/types'
import { ConfigError } from './errors'

export const SCHEDULE_SCHEMA = `
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, instructions TEXT NOT NULL, context TEXT NOT NULL,
  start_at INTEGER NOT NULL, repeat TEXT NOT NULL, timezone TEXT NOT NULL,
  next_run_at INTEGER, state TEXT NOT NULL,
  last_run_at INTEGER, last_status TEXT NOT NULL DEFAULT '', last_note TEXT NOT NULL DEFAULT '',
  last_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS schedules_due ON schedules(state, next_run_at);
CREATE INDEX IF NOT EXISTS schedules_bot ON schedules(bot_id, created_at);
`

export function localParts(time: number, timezone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(time)
  const value = (type: string): number => Number(parts.find(part => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') }
}

// Calendar days retain the selected wall-clock time across DST. A skipped time moves forward by the gap.
export function wallTime(year: number, month: number, day: number, hour: number, minute: number, timezone: string): number {
  const target = Date.UTC(year, month - 1, day, hour, minute)
  let guess = target
  const candidates: number[] = []
  for (let i = 0; i < 4; i++) {
    const p = localParts(guess, timezone)
    const offset = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    if (offset === 0) return guess
    guess += offset
    candidates.push(guess)
  }
  return Math.max(...candidates)
}

export function nextOccurrence(schedule: Pick<ScheduleView, 'repeat' | 'startAt' | 'timezone'>, after: number): number | null {
  if (schedule.repeat === 'once') return null
  const clock = localParts(schedule.startAt, schedule.timezone)
  const today = localParts(Math.max(after, schedule.startAt - 60000), schedule.timezone)
  const weeklyDay = new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay()
  for (let day = 0; day < 370; day++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + day))
    const weekday = date.getUTCDay()
    if (schedule.repeat === 'weekdays' && (weekday === 0 || weekday === 6)) continue
    if (schedule.repeat === 'weekly' && weekday !== weeklyDay) continue
    const next = wallTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), clock.hour, clock.minute, schedule.timezone)
    if (next > after && next >= schedule.startAt) return next
  }
  throw new ConfigError('Could not find the next scheduled time. Choose another date or time zone.')
}

export function validateSchedule(input: ScheduleDraft, now: number): Pick<ScheduleView, 'kind' | 'title' | 'instructions' | 'startAt' | 'repeat' | 'timezone' | 'nextRunAt'> {
  if (input.kind !== 'reminder' && input.kind !== 'task') throw new ConfigError('Choose a reminder or a bot task.')
  if (!['once', 'daily', 'weekdays', 'weekly'].includes(input.repeat)) throw new ConfigError('Choose once, daily, weekdays, or weekly.')
  const title = String(input.title ?? '').trim()
  const instructions = String(input.instructions ?? '').trim()
  if (title.length < 2 || title.length > 80) throw new ConfigError('Use a title between 2 and 80 characters.')
  if (!instructions || instructions.length > 4000) throw new ConfigError('Describe the reminder or task in up to 4,000 characters.')
  const timezone = String(input.timezone ?? '').trim()
  try { localParts(now, timezone) } catch { throw new ConfigError('Choose a valid time zone, such as America/New_York.') }
  if (!timezone) throw new ConfigError('A time zone is required.')
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(input.startAt)) throw new ConfigError('Use a date and time with an explicit UTC offset or Z.')
  const startAt = Date.parse(input.startAt)
  if (!Number.isFinite(startAt) || startAt > now + 10 * 366 * 86400000) throw new ConfigError('Choose a valid date within the next ten years.')
  const date = input.startAt.slice(0, 10)
  const [year, month, day] = date.split('-').map(Number)
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date) throw new ConfigError('That calendar date is not valid.')
  if (!input.startAt.endsWith('Z')) {
    const p = localParts(startAt, timezone)
    if (p.year !== year || p.month !== month || p.day !== day || p.hour !== Number(input.startAt.slice(11, 13)) || p.minute !== Number(input.startAt.slice(14, 16))) throw new ConfigError('The UTC offset does not match that time zone on this date. Check the offset and try again.')
  }
  if (input.repeat === 'once' && startAt <= now) throw new ConfigError('Choose a future time for a one-time reminder or task.')
  const schedule = { kind: input.kind, title, instructions, startAt, repeat: input.repeat, timezone }
  const local = localParts(startAt, timezone)
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()
  const nextRunAt = startAt > now && (input.repeat !== 'weekdays' || (weekday !== 0 && weekday !== 6)) ? startAt : nextOccurrence(schedule, now)
  return { ...schedule, nextRunAt }
}

export function scheduleText(schedule: ScheduleView): string {
  const when = schedule.nextRunAt ? new Intl.DateTimeFormat('en-US', { timeZone: schedule.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(schedule.nextRunAt) : 'No future run'
  return `${schedule.id} | ${schedule.kind} | ${schedule.title} | ${schedule.state} | ${schedule.repeat} | ${when} (${schedule.timezone})\n${schedule.instructions}`
}

export function scheduleClock(schedule: Pick<ScheduleView, 'startAt' | 'timezone' | 'repeat'>): number[] {
  const p = localParts(schedule.startAt, schedule.timezone)
  return [p.hour, p.minute, ...(schedule.repeat === 'weekly' ? [new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] : [])]
}
