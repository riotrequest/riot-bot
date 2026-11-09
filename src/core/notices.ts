import type { AppNotice } from '../shared/types'

export const NOTICE_LIMIT = 3

export function clipNoticeText(value: string, limit: number): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (clean.length <= limit) return clean
  return `${clean.slice(0, Math.max(1, limit - 1))}…`
}

export function reminderNotice(input: { id: string; botId: string; title: string; instructions: string }): AppNotice {
  return {
    id: `reminder:${input.id}`,
    kind: 'reminder',
    title: clipNoticeText(input.title, 80) || 'Reminder',
    body: clipNoticeText(input.instructions, 280) || 'A reminder is due.',
    botId: input.botId
  }
}

export function attentionNotice(input: { id: string; attempt: number; state: string; botId: string; text?: string }): AppNotice | null {
  const title = input.state === 'approval' ? 'Approval needed' : input.state === 'completed' ? 'Job finished' : input.state === 'failed' || input.state === 'paused' ? 'Needs attention' : ''
  if (!title) return null
  const fallback = input.state === 'approval' ? 'A bot needs your approval.' : input.state === 'completed' ? 'A job finished.' : 'A job needs attention.'
  const attempt = Number.isInteger(input.attempt) && input.attempt >= 0 && input.attempt < 1000 ? input.attempt : 0
  return { id: `job:${input.id}:${attempt}:${input.state}`, kind: 'attention', title, body: clipNoticeText(input.text ?? '', 280) || fallback, botId: input.botId }
}

/** Keeps the newest notices and replaces an existing id instead of duplicating it. */
export function pushNotice(current: readonly AppNotice[], notice: AppNotice): AppNotice[] {
  return [...current.filter((item) => item.id !== notice.id), notice].slice(-NOTICE_LIMIT)
}

export function dismissNotice(current: readonly AppNotice[], id: string): AppNotice[] {
  return current.filter((item) => item.id !== id)
}

const ATTENTION_STATES = new Set(['approval', 'completed', 'failed', 'paused'])

export interface AttentionJob {
  id: string
  attempt: number
  status: string
  awaitingApproval: boolean
  botId: string
  text: string
}

export function jobAttentionState(job: { awaitingApproval: boolean; status: string }): string {
  return job.awaitingApproval ? 'approval' : job.status
}

export function parseAttentionId(id: string): { jobId: string; attempt: number; state: string } | null {
  const match = /^job:(.+):(\d+):([a-z]+)$/.exec(id)
  if (!match?.[1] || !match[2] || !match[3]) return null
  return { jobId: match[1], attempt: Number(match[2]), state: match[3] }
}

/**
 * Drops attention cards whose job, attempt, or state is no longer current.
 * Completion, failure, and pause are recorded once for the attempt. Approval is
 * recorded for the pending occurrence: leaving that state forgets the key, so a
 * later approval can notify, while a repeat of the approval still waiting stays quiet.
 * `allowNew` false still clears obsolete cards and still suppresses that new toast.
 */
export function reconcileAttention(current: readonly AppNotice[], jobs: readonly AttentionJob[], notified: ReadonlySet<string>, allowNew: boolean): { notices: AppNotice[]; notified: Set<string>; changed: boolean } {
  const jobsById = new Map(jobs.map((job) => [job.id, job]))
  const seen = new Set(notified)
  let changed = false
  const kept: AppNotice[] = []
  for (const notice of current) {
    if (notice.kind !== 'attention') { kept.push(notice); continue }
    const parsed = parseAttentionId(notice.id)
    const job = parsed ? jobsById.get(parsed.jobId) : undefined
    if (!parsed || !job || job.attempt !== parsed.attempt || jobAttentionState(job) !== parsed.state) { changed = true; continue }
    kept.push(notice)
  }
  let notices = kept
  for (const job of jobs) {
    const state = jobAttentionState(job)
    if (state !== 'approval') seen.delete(`${job.id}:${job.attempt}:approval`)
    if (!ATTENTION_STATES.has(state)) continue
    const key = `${job.id}:${job.attempt}:${state}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!allowNew) continue
    const notice = attentionNotice({ id: job.id, attempt: job.attempt, state, botId: job.botId, text: job.text })
    if (!notice) continue
    const withoutJob = notices.filter((item) => item.kind !== 'attention' || parseAttentionId(item.id)?.jobId !== job.id)
    notices = pushNotice(withoutJob, notice)
    changed = true
  }
  return { notices, notified: seen, changed }
}

/**
 * Marks every job state that already exists when Riot Bot starts as seen. Without it, the first
 * job event after a restart would turn earlier sessions' results into new cards.
 */
export function seedAttention(jobs: readonly AttentionJob[]): Set<string> {
  return reconcileAttention([], jobs, new Set(), false).notified
}

export interface MainWindowPresence {
  destroyed: boolean
  visible: boolean
  minimized: boolean
  focused: boolean
}

/** True when the user is looking at Riot Bot: the window is on screen, restored, and focused. */
export function mainWindowIsFocused(window: MainWindowPresence | null): boolean {
  return Boolean(window && !window.destroyed && window.visible && !window.minimized && window.focused)
}

/** Desktop cards stay up only after startup, outside quit, and while Riot Bot is not the focused window. */
export function noticesMaySurface(input: { windowShown: boolean; quitting: boolean; focused: boolean; count: number }): boolean {
  return input.windowShown && !input.quitting && input.count > 0 && !input.focused
}

export function noticePopupBounds(workArea: { x: number; y: number; width: number; height: number }, height: number): { x: number; y: number; width: number; height: number } {
  const margin = 16
  const roomWidth = Math.max(1, workArea.width - margin * 2)
  const roomHeight = Math.max(1, workArea.height - margin * 2)
  const width = Math.min(360, roomWidth)
  const requested = Math.max(96, Math.round(Number.isFinite(height) ? height : 96))
  const next = Math.min(560, roomHeight, requested)
  return {
    x: Math.round(workArea.x + workArea.width - width - margin),
    y: Math.round(workArea.y + workArea.height - next - margin),
    width,
    height: next
  }
}
