import { describe, expect, it } from 'vitest'
import { Database, type MessageRecord } from '../src/core/db'
import { newId } from '../src/core/ids'
import { MockProvider } from '../src/core/provider'
import { makeApp, reopen } from './helpers'

describe('compaction', () => {
  it('keeps pinned instructions and the original transcript', async () => {
    const first = makeApp()
    const conversationId = first.app.getSnapshot().conversations[0].id
    first.app.updateSettings({
      toolsEnabled: false,
      contextMode: 'manual',
      contextTokenBudget: 5000,
      maxModelCallsPerTask: 6,
      pinnedInstructions: 'ALWAYS_KEEP_PIN_ALPHA'
    })
    const dbPath = first.dbPath
    await first.app.close()
    const db = new Database(dbPath)
    db.migrate()
    db.addMessage(stored(conversationId, `ZEPHYR-LEDGER-77 ${'alpha '.repeat(1000)}`, 1))
    for (let index = 0; index < 4; index += 1) db.addMessage(stored(conversationId, `filler note ${index} ${'beta '.repeat(250)}`, index + 2))
    db.close()

    const provider = new MockProvider()
    provider.handler = (input) => {
      const blob = input.messages.map((message) => message.content).join('\n')
      if (blob.includes('Summarize the earlier conversation')) {
        return { content: 'Decisions: keep the pinned note. Constraints: stay inside the budget. Unresolved: none.', toolCalls: [] }
      }
      return { content: 'Ready when you are.', toolCalls: [] }
    }
    const second = reopen(dbPath, provider)
    const run = await second.app.sendMessage(conversationId, 'Continue from here.')
    expect(run.status).toBe('completed')
    expect(second.app.listActivity().some((entry) => entry.purpose === 'compaction')).toBe(true)
    const last = provider.calls.at(-1)
    const lastText = last?.messages.map((message) => message.content).join('\n') ?? ''
    expect(lastText).toContain('ALWAYS_KEEP_PIN_ALPHA')
    expect(lastText).not.toContain('ZEPHYR-LEDGER-77')
    const reopened = new Database(dbPath)
    reopened.migrate()
    expect(reopened.listMessages(conversationId).some((message) => message.content.includes('ZEPHYR-LEDGER-77'))).toBe(true)
    expect(reopened.searchMessages('ZEPHYR-LEDGER-77').length).toBeGreaterThan(0)
    reopened.close()
    await second.app.close()
  })
})

function stored(conversationId: string, content: string, createdAt: number): MessageRecord {
  return {
    id: newId(),
    conversationId,
    role: 'user',
    content,
    toolCallsJson: null,
    toolCallId: null,
    toolName: null,
    createdAt,
    summarized: false,
    runId: null
  }
}
