import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { buildContext } from '../src/core/context'
import { Database, type MessageRecord } from '../src/core/db'
import { newId } from '../src/core/ids'
import { SYSTEM_PROMPT } from '../src/core/prompt'
import { MockProvider } from '../src/core/provider'
import { makeApp, reopen } from './helpers'

describe('context', () => {
  it('keeps the request inside the budget and can still find older text', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-bot-'))
    const db = new Database(path.join(dir, 'riot.sqlite'))
    db.migrate()
    const conversation = db.createConversation('Main', Date.now())
    const oldId = newId()
    db.addMessage(message(conversation.id, oldId, `ZEPHYR-LEDGER-77 ${'ledger '.repeat(1800)}`, 1))
    db.addMessage(message(conversation.id, newId(), 'What should we do next?', 2))
    const built = buildContext({
      systemPrompt: SYSTEM_PROMPT,
      pinnedInstructions: 'ALWAYS_KEEP_PIN_ALPHA',
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: db.listMessages(conversation.id),
      tokenBudget: 2500
    })
    const text = built.messages.map((item) => item.content).join('\n')
    expect(built.omittedMessageIds).toContain(oldId)
    expect(text).not.toContain('ZEPHYR-LEDGER-77')
    expect(text).toContain('ALWAYS_KEEP_PIN_ALPHA')
    expect(built.overBudget).toBe(false)
    expect(built.estimatedTokens).toBeLessThanOrEqual(2500)
    expect(db.searchMessages('ZEPHYR-LEDGER-77').some((hit) => hit.snippet.includes('ZEPHYR-LEDGER-77'))).toBe(true)
    db.close()
  })

  it('retrieves omitted history with the history tool instead of resending it', async () => {
    const first = makeApp()
    const conversationId = first.app.getSnapshot().conversations[0].id
    first.app.updateSettings({ toolsEnabled: true, contextMode: 'manual', contextTokenBudget: 8000, maxModelCallsPerTask: 6 })
    const dbPath = first.dbPath
    await first.app.close()
    const db = new Database(dbPath)
    db.migrate()
    db.addMessage(message(conversationId, newId(), `ZEPHYR-LEDGER-77 ${'ledger '.repeat(1100)}`, Date.now()))
    db.close()

    const provider = new MockProvider()
    provider.handler = (input) => {
      const joined = input.messages.map((item) => item.content).join('\n')
      if (joined.includes('Summarize the earlier conversation')) {
        return { content: 'Older notes were folded in. Decisions: none. Unresolved: none.', toolCalls: [] }
      }
      if (!joined.includes('ZEPHYR-LEDGER-77')) {
        return {
          content: '',
          toolCalls: [{ id: 'search-1', name: 'search_history', arguments: JSON.stringify({ query: 'ZEPHYR-LEDGER-77' }) }]
        }
      }
      return { content: 'Found it in history.', toolCalls: [] }
    }
    const second = reopen(dbPath, provider)
    const run = await second.app.sendMessage(conversationId, 'Look up the ledger name.')
    expect(run.status).toBe('completed')
    const chat = provider.calls.find((call) => !call.messages.some((item) => item.content.includes('Summarize the earlier conversation')))
    const chatText = chat?.messages.map((item) => item.content).join('\n') ?? ''
    expect(chatText).not.toContain('ZEPHYR-LEDGER-77')
    expect(provider.calls.every((call) => call.messages.reduce((sum, item) => sum + item.content.length, 0) < 20_000)).toBe(true)
    const toolMessage = second.app.openConversation(conversationId).messages.find((item) => item.role === 'tool')
    expect(toolMessage?.content).toContain('ZEPHYR-LEDGER-77')
    await second.app.close()
  })
})

function message(conversationId: string, id: string, content: string, createdAt: number): MessageRecord {
  return {
    id,
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
