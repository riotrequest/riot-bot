import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RiotService, type RiotServiceOptions } from '../src/core/service'
import { RiotApp } from '../src/core/app'
import { MemoryCredentialStore } from '../src/core/credentials'
import { MockProvider } from '../src/core/provider'
import { localParts, nextOccurrence, validateSchedule } from '../src/core/schedules'
import { openDatabase } from '../src/core/sqlite'
import type { AppEvent, ScheduleDraft } from '../src/shared/types'
import { FakeTerminal, makeApp, tempDir, waitFor } from './helpers'

const initial = Date.parse('2026-11-03T08:59:30-05:00')
const reminder: ScheduleDraft = { kind: 'reminder', title: 'Work email', instructions: 'Time to check your work email.', startAt: '2026-11-03T09:00:00-05:00', repeat: 'once', timezone: 'America/New_York' }

function setup(dir = tempDir(), start = initial, options: Partial<RiotServiceOptions> = {}) {
  let now = start
  const provider = new MockProvider(), credentials = new MemoryCredentialStore(), events: AppEvent[] = []
  const app = new RiotService({ dbPath: path.join(dir, 'schedules.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), provider, credentials, ...options, now: () => now })
  app.onEvent(event => events.push(event)); app.boot()
  app.updateSettings({ model: 'mock-model', workspacePath: dir, autoMemory: false, autoSkillSuggestions: false })
  return { app, provider, events, dir, credentials, clock: (value: number) => { now = value } }
}

describe('calendar scheduling', () => {
  it('keeps daily wall-clock times across spring and fall daylight-saving changes', () => {
    const spring = { repeat: 'daily' as const, startAt: Date.parse('2026-03-07T09:00:00-05:00'), timezone: 'America/New_York' }
    expect(nextOccurrence(spring, spring.startAt)).toBe(Date.parse('2026-03-08T09:00:00-04:00'))
    const gap = { ...spring, startAt: Date.parse('2026-03-07T02:30:00-05:00') }
    expect(nextOccurrence(gap, gap.startAt)).toBe(Date.parse('2026-03-08T03:30:00-04:00'))
    const fall = { ...spring, startAt: Date.parse('2026-10-31T01:30:00-04:00') }
    const first = nextOccurrence(fall, fall.startAt)!
    expect(first).toBe(Date.parse('2026-11-01T01:30:00-04:00'))
    expect(nextOccurrence(fall, first)).toBe(Date.parse('2026-11-02T01:30:00-05:00'))
  })

  it('honors weekdays, weekly dates, far-future starts, and the local day of a UTC timestamp', () => {
    const weekday = { repeat: 'weekdays' as const, startAt: Date.parse('2026-11-06T09:00:00-05:00'), timezone: 'America/New_York' }
    expect(nextOccurrence(weekday, weekday.startAt)).toBe(Date.parse('2026-11-09T09:00:00-05:00'))
    expect(nextOccurrence({ ...weekday, repeat: 'weekly' }, weekday.startAt)).toBe(Date.parse('2026-11-13T09:00:00-05:00'))
    const friday = validateSchedule({ ...reminder, repeat: 'weekdays', startAt: '2026-11-07T01:00:00Z' }, initial)
    expect(friday.nextRunAt).toBe(Date.parse('2026-11-06T20:00:00-05:00'))
    const future = validateSchedule({ ...reminder, repeat: 'weekdays', startAt: '2029-11-03T09:00:00-04:00' }, initial)
    expect(future.nextRunAt! > future.startAt).toBe(true)
    expect(localParts(future.nextRunAt!, future.timezone).hour).toBe(9)
  })

  it('rejects invalid dates, mismatched offsets, missing zones, and past one-time requests', () => {
    for (const input of [{ startAt: '2026-02-30T09:00:00-05:00' }, { startAt: '2026-11-03T09:00:00-04:00' }, { timezone: '' }, { timezone: 'Mars/Base' }, { startAt: '2026-11-03T09:00' }, { startAt: '2026-11-02T09:00:00-05:00' }]) expect(() => validateSchedule({ ...reminder, ...input }, initial)).toThrow()
  })
})

describe('native reminder and routine service', () => {
  it('upgrades a version 10 database without changing the bot and removes schedules when its bot is deleted', async () => {
    const first = setup()
    const bot = first.app.getSnapshot().bot!
    await first.app.close()
    const raw = openDatabase(path.join(first.dir, 'schedules.sqlite'))
    raw.exec('DROP TABLE schedules; PRAGMA user_version = 10;')
    raw.close()
    const second = setup(first.dir)
    try {
      await Promise.resolve()
      expect(second.app.getSnapshot().bot!.id).toBe(bot.id)
      second.app.saveSchedule(reminder)
      expect(second.app.listSchedules()).toHaveLength(1)
      const result = await second.app.deleteBot(bot.id, bot.name)
      expect(result.snapshot.schedules).toEqual([])
      second.clock(initial + 30000); second.app.checkSchedules()
      expect(second.events.filter(event => event.type === 'reminder-fired')).toHaveLength(0)
    } finally { await second.app.close() }
  })

  it('fires a reminder exactly once without any AI calls and keeps it after restart', async () => {
    const first = setup()
    await Promise.resolve()
    const saved = first.app.saveSchedule(reminder)
    first.app.updateSettings({ model: '' })
    first.clock(initial + 30000); first.app.checkSchedules(); first.app.checkSchedules()
    expect(first.events.filter(event => event.type === 'reminder-fired')).toHaveLength(1)
    expect(first.app.listSchedules()[0]).toMatchObject({ id: saved.id, state: 'completed', lastStatus: 'reminded', nextRunAt: null })
    expect(first.provider.calls).toHaveLength(0)
    expect(first.app.listJobs('app')).toHaveLength(0)
    await first.app.close()
    const second = setup(first.dir, initial + 60000)
    try { await Promise.resolve(); expect(second.events.filter(event => event.type === 'reminder-fired')).toHaveLength(0); expect(second.provider.calls).toHaveLength(0) }
    finally { await second.app.close() }
  })

  it('deduplicates retries, scopes controls by bot, and keeps pause/cancel reversible', async () => {
    const { app, provider, clock } = setup()
    try {
      await Promise.resolve()
      const a = app.getSnapshot().bot!.id
      const saved = app.saveSchedule({ ...reminder, repeat: 'daily' })
      expect(app.saveSchedule({ ...reminder, title: 'WORK EMAIL', repeat: 'daily' }).id).toBe(saved.id)
      expect(app.listSchedules()).toHaveLength(1)
      app.manageSchedule(saved.id, 'pause'); clock(initial + 30000); app.checkSchedules()
      expect(app.listSchedules()[0].lastRunAt).toBeNull()
      app.manageSchedule(saved.id, 'resume')
      expect(app.listSchedules()[0].nextRunAt).toBe(Date.parse('2026-11-04T09:00:00-05:00'))
      app.manageSchedule(saved.id, 'cancel'); app.manageSchedule(saved.id, 'resume')
      await app.createBot({ name: 'Other helper', purpose: 'Keep this separate', provider: 'openai', model: 'other-model', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      expect(app.listSchedules()).toHaveLength(0)
      expect(() => app.manageSchedule(saved.id, 'cancel')).toThrow('not in this bot')
      expect(() => app.runScheduleNow(saved.id)).toThrow('not in this bot')
      expect(() => app.saveSchedule(reminder, saved.id)).toThrow('not in this bot')
      app.selectBot(a); expect(app.listSchedules()[0].state).toBe('active')
      expect(provider.calls).toHaveLength(0)
    } finally { await app.close() }
  })

  it('runs recurring bot work with captured context and the correct bot even after selection changes', async () => {
    const { app, provider, clock } = setup()
    try {
      await Promise.resolve()
      const bot = app.getSnapshot().bot!, chat = app.getSnapshot().current!.conversation.id
      await app.sendMessage(chat, 'The RLH email system uses https://mail.example.test and the nightly deliverability report. Remember the client name is RLH.')
      const schedule = app.saveSchedule({ ...reminder, kind: 'task', title: 'RLH morning check', instructions: 'Check our RLH email system and summarize anything that needs attention.', repeat: 'daily' })
      expect(schedule.context).toContain('mail.example.test')
      await app.createBot({ name: 'Other helper', purpose: 'A separate bot', provider: 'openai', model: 'other-model', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      const other = app.getSnapshot().bot!.id
      clock(initial + 30000); app.checkSchedules(); app.checkSchedules()
      await waitFor(() => app.listJobs('app').some(job => job.text.includes('RLH morning check') && job.status === 'completed'))
      expect(provider.calls).toHaveLength(2)
      expect(provider.calls.at(-1)?.model).toBe('mock-model')
      expect(provider.calls.at(-1)?.messages.some(message => message.role === 'system' && message.content.includes('Reference context captured') && message.content.includes('mail.example.test'))).toBe(true)
      expect(app.getSnapshot().bot!.id).toBe(other)
      app.selectBot(bot.id)
      const record = app.listSchedules()[0], job = app.listJobs().find(item => item.id === record.lastJobId)!
      expect(app.getRun(job.runId!)?.trigger).toBe('scheduled_task')
      expect(app.openConversation(chat).messages.filter(message => message.role === 'user').at(-1)?.content).not.toContain('Reference context captured')
      expect(record.nextRunAt).toBe(Date.parse('2026-11-04T09:00:00-05:00'))
    } finally { await app.close() }
  })

  it('catches up reminders after restart but waits for Run now for missed AI work', async () => {
    const first = setup()
    await Promise.resolve()
    first.app.saveSchedule(reminder)
    const task = first.app.saveSchedule({ ...reminder, kind: 'task', title: 'Morning check' })
    await first.app.close()
    const second = setup(first.dir, initial + 3600000)
    try {
      await Promise.resolve()
      expect(second.events.filter(event => event.type === 'reminder-fired')).toHaveLength(1)
      expect(second.provider.calls).toHaveLength(0)
      expect(second.app.listJobs('app')).toHaveLength(0)
      expect(second.app.listSchedules().find(item => item.id === task.id)).toMatchObject({ state: 'paused', lastStatus: 'missed' })
      second.app.runScheduleNow(task.id)
      await waitFor(() => second.app.listJobs('app').some(job => job.status === 'completed'))
      expect(second.provider.calls).toHaveLength(1)
    } finally { await second.app.close() }
  })

  it('pauses a recurring schedule after failure instead of repeatedly retrying it', async () => {
    const { app, provider, clock } = setup()
    try {
      await Promise.resolve()
      const saved = app.saveSchedule({ ...reminder, kind: 'task', repeat: 'daily' })
      provider.handler = () => { throw new Error('Fixture connection failed.') }
      clock(initial + 30000); app.checkSchedules()
      await waitFor(() => app.listJobs('app').some(job => job.status === 'failed'))
      expect(app.listSchedules()[0]).toMatchObject({ id: saved.id, state: 'paused', lastStatus: 'failed' })
      const calls = provider.calls.length
      clock(initial + 86430000); app.checkSchedules()
      expect(provider.calls).toHaveLength(calls)
    } finally { await app.close() }
  })

  it('enforces the normal spending limit before a scheduled model call', async () => {
    const { app, provider, clock } = setup()
    try {
      await Promise.resolve()
      app.updateSettings({ maxEstimatedSpendPerTaskUsd: 0.001, inputUsdPerMillion: 100, outputUsdPerMillion: 100 })
      app.saveSchedule({ ...reminder, kind: 'task', repeat: 'daily' })
      clock(initial + 30000); app.checkSchedules()
      await waitFor(() => app.listJobs('app').some(job => job.status === 'paused'))
      expect(app.listJobs('app')[0].note).toContain('spend limit')
      expect(app.listSchedules()[0].state).toBe('paused')
      expect(provider.calls).toHaveLength(0)
    } finally { await app.close() }
  })

  it('still waits for command approval during scheduled work', async () => {
    const terminal = new FakeTerminal()
    const { app, provider, clock } = setup(undefined, undefined, { createExecutor: (_botId, options) => new RiotApp({ ...options, terminal }) })
    try {
      await Promise.resolve()
      provider.handler = input => input.messages.at(-1)?.role === 'tool' ? { content: 'The command was declined.', toolCalls: [] } : { content: '', toolCalls: [{ id: 'scheduled-command', name: 'run_terminal', arguments: '{"command":"echo fixture-only"}' }] }
      app.saveSchedule({ ...reminder, kind: 'task' })
      clock(initial + 30000); app.checkSchedules()
      await waitFor(() => Boolean(app.pendingApproval()))
      expect(app.listJobs('app')[0].awaitingApproval).toBe(true)
      expect(terminal.ran).toHaveLength(0)
      app.resolveApproval(app.pendingApproval()!.id, false)
      await waitFor(() => app.listJobs('app')[0].status === 'completed')
      expect(terminal.ran).toHaveLength(0)
    } finally { await app.close() }
  })

  it('does not queue another occurrence while the earlier one needs approval or is still running', async () => {
    const { app, provider, clock } = setup()
    try {
      await Promise.resolve()
      const saved = app.saveSchedule({ ...reminder, kind: 'task', repeat: 'daily' })
      provider.handler = input => new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('Stopped fixture.')), { once: true }))
      clock(initial + 30000); app.checkSchedules()
      await waitFor(() => provider.calls.length === 1)
      clock(initial + 86429000); app.checkSchedules()
      clock(initial + 86430000); app.checkSchedules()
      expect(app.listJobs('app')).toHaveLength(1)
      expect(app.listSchedules()[0].lastNote).toContain('previous run')
      expect(() => app.runScheduleNow(saved.id)).toThrow('previous run')
      app.stop()
      await waitFor(() => app.listSchedules()[0].state === 'paused')
    } finally { await app.close() }
  })

  it('pauses future runs when a queued occurrence is cancelled, and Stop all leaves reminders enabled', async () => {
    const { app, provider } = setup()
    try {
      await Promise.resolve()
      provider.handler = input => new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('Stopped fixture.')), { once: true }))
      app.queueMessage(app.getSnapshot().current!.conversation.id, 'Hold this fixture job.')
      await waitFor(() => provider.calls.length === 1)
      const task = app.saveSchedule({ ...reminder, kind: 'task', repeat: 'daily' })
      app.runScheduleNow(task.id)
      const queued = app.listSchedules().find(item => item.id === task.id)!.lastJobId!
      expect(app.listJobs('app').find(job => job.id === queued)!.status).toBe('queued')
      app.cancelJob(queued)
      expect(app.listSchedules().find(item => item.id === task.id)!.state).toBe('paused')
      app.manageSchedule(task.id, 'resume')
      const notification = app.saveSchedule(reminder)
      app.stopAll()
      expect(app.listSchedules().find(item => item.id === task.id)!.state).toBe('paused')
      expect(app.listSchedules().find(item => item.id === notification.id)!.state).toBe('active')
    } finally { await app.close() }
  })

  it('exposes native scheduling to chat, saves its context, and blocks unsolicited or recursive schedules', async () => {
    const { app, provider } = makeApp({ now: () => initial })
    try {
      const conversation = app.getSnapshot().current!.conversation.id
      const call = { id: 'schedule-call', name: 'create_schedule', arguments: JSON.stringify({ kind: 'reminder', title: reminder.title, instructions: reminder.instructions, start_at: reminder.startAt, repeat: 'once', timezone: reminder.timezone }) }
      provider.handler = input => {
        return input.messages.at(-1)?.role === 'tool' ? { content: 'Done.', toolCalls: [] } : { content: '', toolCalls: [call] }
      }
      await app.sendMessage(conversation, 'Read this website for me.')
      expect(app.listSchedules()).toHaveLength(0)
      expect(provider.calls[0].tools?.some(tool => tool.name === 'create_schedule')).toBe(false)
      await app.sendMessage(conversation, 'Remind me to check work email at 9 AM today.')
      expect(app.listSchedules()).toHaveLength(1)
      expect(provider.calls.some(input => input.tools?.some(tool => tool.name === 'create_schedule'))).toBe(true)
      const recursive = await app.sendMessage(conversation, 'Create a reminder every day.', [], 'scheduled_task')
      expect(app.listSchedules()).toHaveLength(1)
      expect(recursive.note).toContain('Scheduled work cannot create')
    } finally { await app.close() }
  })

  it('understands a short time clarification after a reminder request', async () => {
    const { app, provider } = makeApp({ now: () => initial })
    try {
      const conversation = app.getSnapshot().current!.conversation.id
      provider.script = [
        () => ({ content: 'What time should I remind you?', toolCalls: [] }),
        input => {
          expect(input.tools?.some(tool => tool.name === 'create_schedule')).toBe(true)
          return { content: 'Saving that reminder.', toolCalls: [{ id: 'clarified-time', name: 'create_schedule', arguments: JSON.stringify({ kind: 'reminder', title: reminder.title, instructions: reminder.instructions, start_at: reminder.startAt, repeat: 'once', timezone: reminder.timezone }) }] }
        },
        () => ({ content: 'Saved for 9 AM today.', toolCalls: [] })
      ]
      await app.sendMessage(conversation, 'Remind me to check work email.')
      expect((await app.sendMessage(conversation, '9 AM today.')).status).toBe('completed')
      expect(app.listSchedules()).toHaveLength(1)
    } finally { await app.close() }
  })
})
