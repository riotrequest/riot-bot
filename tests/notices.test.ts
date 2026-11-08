import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RiotApp } from '../src/core/app'
import type { ModelResponse } from '../src/core/model'
import { MemoryCredentialStore } from '../src/core/credentials'
import { MockProvider } from '../src/core/provider'
import { RiotService } from '../src/core/service'
import { attentionNotice, clipNoticeText, dismissNotice, mainWindowIsFocused, noticePopupBounds, noticesMaySurface, pushNotice, reconcileAttention, reminderNotice, seedAttention, type AttentionJob } from '../src/core/notices'
import type { AppNotice } from '../src/shared/types'
import { NoticeStack } from '../src/renderer/src/notices'
import { FakeTerminal, tempDir, waitFor } from './helpers'

describe('notice board', () => {
  it('clips reminder text and replaces the same reminder', () => {
    const first = reminderNotice({ id: 'sched-1', botId: 'bot-1', title: ' Daily\u0000Reminder ', instructions: 'Check email.\nThen stop.' })
    expect(first).toMatchObject({ id: 'reminder:sched-1', kind: 'reminder', title: 'Daily Reminder', body: 'Check email. Then stop.', botId: 'bot-1' })
    const next = reminderNotice({ id: 'sched-1', botId: 'bot-1', title: 'Daily Reminder - 9 PM', instructions: 'Time to check your work email.' })
    const other = reminderNotice({ id: 'sched-2', botId: 'bot-2', title: 'Other', instructions: 'Later.' })
    const board = pushNotice(pushNotice([first], other), next)
    expect(board.map((item) => item.id)).toEqual(['reminder:sched-2', 'reminder:sched-1'])
    expect(board[1]?.body).toBe('Time to check your work email.')
  })

  it('keeps the three newest notices and drops an unrelated job state', () => {
    let board = [] as ReturnType<typeof reminderNotice>[]
    for (let index = 1; index <= 4; index += 1) board = pushNotice(board, reminderNotice({ id: `s${index}`, botId: 'bot', title: `Title ${index}`, instructions: `Body ${index}` }))
    expect(board.map((item) => item.title)).toEqual(['Title 2', 'Title 3', 'Title 4'])
    expect(attentionNotice({ id: 'job-1', attempt: 2, state: 'approval', botId: 'bot', text: 'Check the inbox' })).toMatchObject({ id: 'job:job-1:2:approval', kind: 'attention', title: 'Approval needed', body: 'Check the inbox' })
    expect(attentionNotice({ id: 'job-1', attempt: 1.5, state: 'running', botId: 'bot' })).toBeNull()
    expect(dismissNotice(board, 'reminder:s3').map((item) => item.title)).toEqual(['Title 2', 'Title 4'])
    expect(clipNoticeText(` ${'a'.repeat(90)}\n`, 80).endsWith('…')).toBe(true)
    expect(clipNoticeText(` ${'a'.repeat(90)}\n`, 80).length).toBe(80)
  })

  it('places the tray popup inside the work area, including a short display', () => {
    expect(noticePopupBounds({ x: 100, y: 40, width: 1600, height: 900 }, 180)).toEqual({ x: 1324, y: 744, width: 360, height: 180 })
    expect(noticePopupBounds({ x: 0, y: 0, width: 800, height: 600 }, 0).height).toBe(96)
    expect(noticePopupBounds({ x: 0, y: 0, width: 800, height: 600 }, 900).height).toBe(560)
    const tight = noticePopupBounds({ x: 0, y: 0, width: 800, height: 500 }, 900)
    expect(tight).toMatchObject({ x: 424, y: 16, width: 360, height: 468 })
    expect(tight.y).toBeGreaterThanOrEqual(0)
    expect(tight.y + tight.height).toBeLessThanOrEqual(500)
    const narrow = noticePopupBounds({ x: 10, y: 10, width: 300, height: 100 }, 400)
    expect(narrow.x).toBeGreaterThanOrEqual(10)
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(310)
    expect(narrow.y + narrow.height).toBeLessThanOrEqual(110)
  })

  it('renders reminder text as a popup, not a Windows alert', () => {
    const notice = reminderNotice({
      id: 'sched-9',
      botId: 'bot-9',
      title: '<script>alert(1)</script>',
      instructions: 'Time to check your work email. <img src=x onerror=alert(1)>'
    })
    const html = renderToStaticMarkup(createElement(NoticeStack, { notices: [notice], onDismiss() {}, onOpen() {} }))
    expect(html).toContain('aria-label="Notifications"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('REMINDER')
    expect(html).toContain('View schedule')
    expect(html).toContain('Dismiss')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('alertdialog')
    expect(html).not.toContain('>OK<')
  })

  it('notifies a later approval in the same attempt without repeating the one still waiting', () => {
    const job = (awaitingApproval: boolean, status = 'running'): AttentionJob => ({ id: 'job-1', attempt: 1, status, awaitingApproval, botId: 'bot', text: 'Check the inbox' })
    const reminder = reminderNotice({ id: 'sched', botId: 'bot', title: 'Keep', instructions: 'Here' })
    let notices = [reminder]
    let notified = new Set<string>()
    const step = (awaitingApproval: boolean, status = 'running', allowNew = true) => {
      const result = reconcileAttention(notices, [job(awaitingApproval, status)], notified, allowNew)
      notices = result.notices
      notified = result.notified
      return result
    }
    expect(step(true).notices.map((item) => item.title)).toEqual(['Keep', 'Approval needed'])
    expect(step(true).changed).toBe(false)
    expect(step(false).notices.map((item) => item.title)).toEqual(['Keep'])
    expect(step(true).notices.map((item) => item.id)).toEqual(['reminder:sched', 'job:job-1:1:approval'])
    expect(step(true, 'running', false).changed).toBe(false)
    expect(step(false, 'completed').notices.map((item) => item.title)).toEqual(['Keep', 'Job finished'])
    expect(step(false, 'completed').changed).toBe(false)

    notices = [reminder]
    notified = new Set()
    expect(step(true, 'running', false).notices.map((item) => item.title)).toEqual(['Keep'])
    expect(step(true).notices.map((item) => item.title)).toEqual(['Keep'])
    expect(step(false).notices.map((item) => item.title)).toEqual(['Keep'])
    expect(step(true).notices.map((item) => item.title)).toEqual(['Keep', 'Approval needed'])
    expect(step(false, 'completed').notices.map((item) => item.title)).toEqual(['Keep', 'Job finished'])
  })

  it('shows desktop cards when Riot is minimized or behind another window', () => {
    const present = { destroyed: false, visible: true, minimized: false, focused: true }
    expect(mainWindowIsFocused(present)).toBe(true)
    expect(mainWindowIsFocused({ ...present, focused: false })).toBe(false)
    expect(mainWindowIsFocused({ ...present, minimized: true, focused: false })).toBe(false)
    expect(mainWindowIsFocused({ ...present, visible: false, focused: false })).toBe(false)
    expect(mainWindowIsFocused(null)).toBe(false)
    const surface = { windowShown: true, quitting: false, focused: false, count: 1 }
    expect(noticesMaySurface(surface)).toBe(true)
    expect(noticesMaySurface({ ...surface, focused: true })).toBe(false)
    expect(noticesMaySurface({ ...surface, count: 0 })).toBe(false)
    expect(noticesMaySurface({ ...surface, windowShown: false })).toBe(false)
    expect(noticesMaySurface({ ...surface, quitting: true })).toBe(false)
  })
})

function followJobs(app: RiotService, initial: AppNotice[], seeded = new Set<string>()) {
  let notices = initial
  let notified = seeded
  // `hidden` is production's "Riot is not the focused window": tray, minimized, or behind another app.
  let hidden = true
  const stop = app.onEvent((event) => {
    if (event.type !== 'jobs-changed') return
    const result = reconcileAttention(notices, app.listJobs('app'), notified, hidden)
    notices = result.notices
    notified = result.notified
  })
  return {
    stop,
    notices: () => notices,
    ids: () => notices.map((item) => item.id),
    notified: () => notified,
    hidden: (value: boolean) => { hidden = value },
    again(): AppNotice[] {
      return reconcileAttention(notices, app.listJobs('app'), notified, hidden).notices
    }
  }
}

describe('job notices follow real job events', () => {
  it('does not replay earlier sessions’ job results after a restart', async () => {
    const dir = tempDir()
    const options = { dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), credentials: new MemoryCredentialStore() }
    const firstProvider = new MockProvider()
    const first = new RiotService({ ...options, provider: firstProvider })
    first.boot()
    let conversationId = ''
    try {
      const created = await first.createBot({ name: 'Work', purpose: 'Help with this project', provider: 'openai', model: 'fixture', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      conversationId = created.conversation.id
      first.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
      firstProvider.handler = () => ({ content: 'Earlier result.', toolCalls: [] })
      for (const text of ['Earlier one', 'Earlier two', 'Earlier three']) {
        const job = first.queueMessage(conversationId, text)
        await waitFor(() => first.listJobs('app').find((item) => item.id === job.id)?.status === 'completed')
      }
    } finally { await first.close() }

    const provider = new MockProvider()
    const app = new RiotService({ ...options, provider })
    app.boot()
    const earlier = app.listJobs('app').map((item) => item.id)
    expect(earlier).toHaveLength(3)
    const board = followJobs(app, [], seedAttention(app.listJobs('app')))
    const unseeded = followJobs(app, [])
    try {
      provider.handler = () => ({ content: 'New result.', toolCalls: [] })
      const job = app.queueMessage(conversationId, 'Run while Riot is in the background')
      await waitFor(() => app.listJobs('app').find((item) => item.id === job.id)?.status === 'completed')
      expect(board.notices().map((item) => item.id)).toEqual([`job:${job.id}:${app.listJobs('app').find((item) => item.id === job.id)?.attempt}:completed`])
      expect(board.notices().some((item) => earlier.some((id) => item.id.includes(id)))).toBe(false)
      // Without the startup seed, the first event replays the earlier results.
      expect(unseeded.notices().some((item) => earlier.some((id) => item.id.includes(id)))).toBe(true)
    } finally {
      board.stop()
      unseeded.stop()
      await app.close()
    }
  })

  it('replaces approval with completion, and a focused window does not grow a new card', async () => {
    const dir = tempDir()
    const provider = new MockProvider()
    const terminal = new FakeTerminal()
    const app = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), provider, credentials: new MemoryCredentialStore(), createExecutor: (_id, options) => new RiotApp({ ...options, terminal }) })
    app.boot()
    const board = followJobs(app, [reminderNotice({ id: 'sched-1', botId: 'bot', title: 'Daily Reminder', instructions: 'Check email.' })])
    try {
      const created = await app.createBot({ name: 'Work', purpose: 'Help with this project', provider: 'openai', model: 'fixture', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
      const releases: Array<(response: ModelResponse) => void> = []
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
        ? new Promise<ModelResponse>((resolve) => { releases.push((response) => resolve(response)) })
        : { content: '', toolCalls: [{ id: 'one-command', name: 'run_terminal', arguments: '{"command":"echo fixture"}' }] }
      const job = app.queueMessage(created.conversation.id, 'Check the inbox')
      await waitFor(() => app.listJobs('app').some((item) => item.id === job.id && item.awaitingApproval))
      expect(board.ids()).toEqual(['reminder:sched-1', `job:${job.id}:${app.listJobs('app').find((item) => item.id === job.id)?.attempt}:approval`])
      expect(board.again().map((item) => item.id)).toEqual(board.ids())
      app.resolveApproval(app.pendingApproval()!.id, true)
      await waitFor(() => releases.length > 0 && app.listJobs('app').some((item) => item.id === job.id && item.status === 'running' && !item.awaitingApproval))
      expect(board.notices().filter((item) => item.kind === 'attention')).toEqual([])
      expect(board.ids()[0]).toBe('reminder:sched-1')
      releases[0]?.({ content: 'Done.', toolCalls: [] })
      await waitFor(() => app.listJobs('app').find((item) => item.id === job.id)?.status === 'completed')
      expect(board.notices().map((item) => item.title)).toEqual(['Daily Reminder', 'Job finished'])
      expect(board.notices()[1]?.body).toBe('Check the inbox')
      expect(board.again().map((item) => item.title)).toEqual(['Daily Reminder', 'Job finished'])

      board.hidden(false)
      const seen = releases.length
      provider.handler = (input) => input.messages.at(-1)?.role === 'tool'
        ? new Promise<ModelResponse>((resolve) => { releases.push((response) => resolve(response)) })
        : { content: '', toolCalls: [{ id: 'next-command', name: 'run_terminal', arguments: '{"command":"echo next"}' }] }
      const second = app.queueMessage(created.conversation.id, 'Finish while the window is open')
      await waitFor(() => app.listJobs('app').some((item) => item.id === second.id && item.awaitingApproval))
      expect(board.notices().some((item) => item.id.includes(second.id))).toBe(false)
      app.resolveApproval(app.pendingApproval()!.id, true)
      await waitFor(() => releases.length > seen)
      releases[seen]?.({ content: 'Done.', toolCalls: [] })
      await waitFor(() => app.listJobs('app').find((item) => item.id === second.id)?.status === 'completed')
      expect(board.notices().map((item) => item.title)).toEqual(['Daily Reminder', 'Job finished'])
      expect(board.notices().some((item) => item.id.includes(second.id))).toBe(false)
    } finally {
      board.stop()
      await app.close()
    }
  })

  it('clears a failed job card when that attempt resumes and finishes', async () => {
    const dir = tempDir()
    const provider = new MockProvider()
    const app = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), provider, credentials: new MemoryCredentialStore() })
    app.boot()
    const board = followJobs(app, [reminderNotice({ id: 'sched-2', botId: 'bot', title: 'Keep me', instructions: 'Still here.' })])
    try {
      const created = await app.createBot({ name: 'Retry', purpose: 'Help with this project', provider: 'openai', model: 'fixture', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
      let fail = true
      provider.handler = () => { if (fail) throw new Error('fixture failed'); return { content: 'Recovered.', toolCalls: [] } }
      const job = app.queueMessage(created.conversation.id, 'Try the export')
      await waitFor(() => app.listJobs('app').find((item) => item.id === job.id)?.status === 'failed')
      const failed = board.notices().find((item) => item.kind === 'attention')
      expect(failed?.title).toBe('Needs attention')
      expect(failed?.id).toContain(':failed')
      expect(board.again().map((item) => item.id)).toEqual(board.ids())
      fail = false
      app.resumeJob(job.id)
      await waitFor(() => app.listJobs('app').find((item) => item.id === job.id)?.status === 'completed')
      expect(board.notices().map((item) => item.title)).toEqual(['Keep me', 'Job finished'])
      expect(board.notices().some((item) => item.id.endsWith(':failed'))).toBe(false)
      const current = app.listJobs('app').find((item) => item.id === job.id) as AttentionJob
      expect(board.notices()[1]?.id).toBe(`job:${current.id}:${current.attempt}:completed`)
    } finally {
      board.stop()
      await app.close()
    }
  })

  it('notifies both approvals in one attempt, stays quiet during each wait, then notifies completion once', async () => {
    const dir = tempDir()
    const provider = new MockProvider()
    const terminal = new FakeTerminal()
    const app = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), provider, credentials: new MemoryCredentialStore(), createExecutor: (_id, options) => new RiotApp({ ...options, terminal }) })
    app.boot()
    const board = followJobs(app, [reminderNotice({ id: 'sched-keep', botId: 'bot', title: 'Keep me', instructions: 'Still here.' })])
    try {
      const created = await app.createBot({ name: 'Review', purpose: 'A synthetic notification review', provider: 'openai', model: 'fixture', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
      let step = 0
      provider.handler = () => {
        step += 1
        return step <= 2
          ? { content: '', toolCalls: [{ id: `step-${step}`, name: 'run_terminal', arguments: JSON.stringify({ command: `echo synthetic-step-${step}` }) }] }
          : { content: 'Done.', toolCalls: [] }
      }
      const job = app.queueMessage(created.conversation.id, 'Two steps needing separate approval.')
      await waitFor(() => Boolean(app.pendingApproval()) && app.listJobs('app').some((item) => item.id === job.id && item.awaitingApproval))
      const first = app.pendingApproval()!
      expect(app.listJobs('app').find((item) => item.id === job.id)?.attempt).toBe(1)
      expect(board.notices().map((item) => item.title)).toEqual(['Keep me', 'Approval needed'])
      expect(board.notices()[1]?.id).toBe(`job:${job.id}:1:approval`)
      const firstRepeat = reconcileAttention(board.notices(), app.listJobs('app'), board.notified(), true)
      expect(firstRepeat.changed).toBe(false)
      expect(firstRepeat.notices.map((item) => item.id)).toEqual(board.ids())
      app.resolveApproval(first.id, true)
      expect(board.notices().filter((item) => item.kind === 'attention')).toEqual([])
      await waitFor(() => Boolean(app.pendingApproval() && app.pendingApproval()!.id !== first.id) && app.listJobs('app').some((item) => item.id === job.id && item.awaitingApproval))
      const second = app.pendingApproval()!
      expect(second.id).not.toBe(first.id)
      expect(board.notices().map((item) => item.title)).toEqual(['Keep me', 'Approval needed'])
      const secondRepeat = reconcileAttention(board.notices(), app.listJobs('app'), board.notified(), true)
      expect(secondRepeat.changed).toBe(false)
      expect(secondRepeat.notices.map((item) => item.id)).toEqual(board.ids())
      app.resolveApproval(second.id, true)
      await waitFor(() => app.listJobs('app').find((item) => item.id === job.id)?.status === 'completed')
      expect(board.notices().map((item) => item.title)).toEqual(['Keep me', 'Job finished'])
      expect(board.notices()[1]?.id).toBe(`job:${job.id}:1:completed`)
      expect(board.again().map((item) => item.title)).toEqual(['Keep me', 'Job finished'])
      expect(terminal.ran).toEqual(['echo synthetic-step-1', 'echo synthetic-step-2'])
    } finally {
      board.stop()
      await app.close()
    }
  })

  it('suppresses a focused approval and still notifies the next approval once Riot is away', async () => {
    const dir = tempDir()
    const provider = new MockProvider()
    const terminal = new FakeTerminal()
    const app = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), provider, credentials: new MemoryCredentialStore(), createExecutor: (_id, options) => new RiotApp({ ...options, terminal }) })
    app.boot()
    const board = followJobs(app, [reminderNotice({ id: 'sched-keep', botId: 'bot', title: 'Keep me', instructions: 'Still here.' })])
    board.hidden(false)
    try {
      const created = await app.createBot({ name: 'Review', purpose: 'A synthetic notification review', provider: 'openai', model: 'fixture', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
      app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
      let step = 0
      provider.handler = () => {
        step += 1
        return step <= 2
          ? { content: '', toolCalls: [{ id: `step-${step}`, name: 'run_terminal', arguments: JSON.stringify({ command: `echo synthetic-step-${step}` }) }] }
          : { content: 'Done.', toolCalls: [] }
      }
      const job = app.queueMessage(created.conversation.id, 'Two steps needing separate approval.')
      await waitFor(() => Boolean(app.pendingApproval()) && app.listJobs('app').some((item) => item.id === job.id && item.awaitingApproval))
      const first = app.pendingApproval()!
      expect(board.notices().map((item) => item.title)).toEqual(['Keep me'])
      board.hidden(true)
      expect(board.again().map((item) => item.title)).toEqual(['Keep me'])
      app.resolveApproval(first.id, true)
      expect(board.notices().filter((item) => item.kind === 'attention')).toEqual([])
      await waitFor(() => Boolean(app.pendingApproval() && app.pendingApproval()!.id !== first.id) && app.listJobs('app').some((item) => item.id === job.id && item.awaitingApproval))
      const second = app.pendingApproval()!
      expect(second.id).not.toBe(first.id)
      expect(app.listJobs('app').find((item) => item.id === job.id)?.attempt).toBe(1)
      expect(board.notices().map((item) => item.title)).toEqual(['Keep me', 'Approval needed'])
      expect(board.notices()[1]?.id).toBe(`job:${job.id}:1:approval`)
      const repeat = reconcileAttention(board.notices(), app.listJobs('app'), board.notified(), true)
      expect(repeat.changed).toBe(false)
      app.resolveApproval(second.id, true)
      await waitFor(() => app.listJobs('app').find((item) => item.id === job.id)?.status === 'completed')
      expect(board.notices().map((item) => item.title)).toEqual(['Keep me', 'Job finished'])
      expect(board.again().map((item) => item.id)).toEqual(board.ids())
      expect(terminal.ran).toEqual(['echo synthetic-step-1', 'echo synthetic-step-2'])
    } finally {
      board.stop()
      await app.close()
    }
  })
})
