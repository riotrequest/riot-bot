import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { Database } from '../src/core/db'
import { ProviderError } from '../src/core/errors'
import { localDay } from '../src/core/settings'
import { makeApp, reopen } from './helpers'

describe('limits', () => {
  it('counts retries and compaction toward the same task limit', async () => {
    const retry = makeApp()
    retry.app.updateSettings({ maxModelCallsPerTask: 12 })
    let attempts = 0
    retry.provider.handler = () => {
      attempts += 1
      throw new ProviderError('transient', 'temporary outage')
    }
    const retryRun = await retry.app.sendMessage(retry.app.getSnapshot().conversations[0].id, 'Hello')
    expect(attempts).toBe(3)
    expect(retry.provider.calls).toHaveLength(3)
    expect(retryRun.status).toBe('failed')
    await retry.app.close()

    const auth = makeApp()
    auth.provider.handler = () => {
      throw new ProviderError('auth', 'invalid api key')
    }
    await auth.app.sendMessage(auth.app.getSnapshot().conversations[0].id, 'Hello')
    expect(auth.provider.calls).toHaveLength(1)
    await auth.app.close()

    const first = makeApp()
    const conversationId = first.app.getSnapshot().conversations[0].id
    first.app.updateSettings({ toolsEnabled: true, contextMode: 'manual', contextTokenBudget: 8000, maxModelCallsPerTask: 1, pinnedInstructions: 'PIN' })
    const dbPath = first.dbPath
    await first.app.close()
    const db = new Database(dbPath)
    db.migrate()
    db.addMessage({
      id: '22222222-2222-2222-2222-222222222222',
      conversationId,
      role: 'user',
      content: `KEEP-ORIGINAL ${'detail '.repeat(1100)}`,
      toolCallsJson: null,
      toolCallId: null,
      toolName: null,
      createdAt: 1,
      summarized: false,
      runId: null
    })
    db.close()
    const second = reopen(dbPath)
    second.provider.handler = () => ({ content: 'Summary only. Decisions: none. Unresolved: none.', toolCalls: [] })
    const run = await second.app.sendMessage(conversationId, 'Go on')
    expect(second.provider.calls).toHaveLength(1)
    expect(second.app.listActivity().some((entry) => entry.purpose === 'compaction')).toBe(true)
    expect(run.status).toBe('paused')
    expect(run.note.toLowerCase()).toContain('limit')
    expect(second.app.openConversation(conversationId).messages.some((message) => message.content.includes('KEEP-ORIGINAL'))).toBe(true)
    await second.app.close()
  })

  it('does not let unknown pricing bypass a dollar limit, while call limits still work', async () => {
    const priced = makeApp()
    priced.app.updateSettings({ maxEstimatedSpendPerDayUsd: 1, inputUsdPerMillion: null, outputUsdPerMillion: null })
    priced.provider.handler = () => ({ content: 'should not run', toolCalls: [] })
    const blocked = await priced.app.sendMessage(priced.app.getSnapshot().conversations[0].id, 'Hello')
    expect(priced.provider.calls).toHaveLength(0)
    expect(blocked.status).toBe('paused')
    expect(blocked.note.toLowerCase()).toContain('price')
    await priced.app.close()

    const calls = makeApp()
    calls.app.updateSettings({
      maxEstimatedSpendPerDayUsd: null,
      maxEstimatedSpendPerTaskUsd: null,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      maxModelCallsPerTask: 1,
      toolsEnabled: true
    })
    calls.provider.handler = () => ({
      content: '',
      toolCalls: [{ id: 'mem-1', name: 'list_memories', arguments: '{}' }]
    })
    const limited = await calls.app.sendMessage(calls.app.getSnapshot().conversations[0].id, 'List what you know')
    expect(calls.provider.calls).toHaveLength(1)
    expect(limited.status).toBe('paused')
    expect(limited.note.toLowerCase()).toContain('model calls')
    await calls.app.close()
  })

  it('keeps an unsettled reservation after restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-bot-'))
    const dbPath = path.join(dir, 'riot.sqlite')
    const db = new Database(dbPath)
    db.migrate()
    const conversation = db.createConversation('Main', Date.now())
    const run = db.createRun(conversation.id, Date.now())
    const day = localDay(Date.now())
    db.insertReservation({ id: '33333333-3333-3333-3333-333333333333', runId: run.id, requestId: '44444444-4444-4444-4444-444444444444', day, reservedUsd: 3.25, createdAt: Date.now() })
    expect(db.sumSpend({ day })).toBeCloseTo(3.25)
    db.interruptUnfinished(Date.now())
    expect(db.sumSpend({ day })).toBeCloseTo(3.25)
    db.close()
    const reopened = new Database(dbPath)
    reopened.migrate()
    expect(reopened.sumSpend({ day })).toBeCloseTo(3.25)
    expect(reopened.usageTotals(day).unsettledUsd).toBeCloseTo(3.25)
    reopened.close()

    const spent = makeApp()
    spent.app.updateSettings({ inputUsdPerMillion: 2, outputUsdPerMillion: 8, maxOutputTokens: 100 })
    spent.provider.handler = () => ({ content: 'done', toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 } })
    await spent.app.sendMessage(spent.app.getSnapshot().conversations[0].id, 'Hello')
    const before = spent.app.getUsage().estimatedUsd
    expect(before).toBeGreaterThan(0)
    const spentPath = spent.dbPath
    await spent.app.close()
    const after = reopen(spentPath)
    expect(after.app.getUsage().estimatedUsd).toBeCloseTo(before)
    await after.app.close()
  })
})
