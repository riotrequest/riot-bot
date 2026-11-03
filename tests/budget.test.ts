import { describe, expect, it } from 'vitest'
import { buildContext } from '../src/core/context'
import { Database, type MessageRecord } from '../src/core/db'
import { newId } from '../src/core/ids'
import { toolsForGroups } from '../src/core/model'
import { SYSTEM_PROMPT } from '../src/core/prompt'
import { estimateTokens, fitTokens } from '../src/core/settings'
import { makeApp, reopen } from './helpers'

const toolReserve = estimateTokens(JSON.stringify(toolsForGroups(['files', 'terminal'])))

describe('input budget', () => {
  it('fits a short workspace question with the current tool set and a saved summary', () => {
    const summary = 'Earlier notes. '.repeat(160)
    const built = buildContext({
      systemPrompt: `${SYSTEM_PROMPT}\n\nBot name: Riot\nPurpose: Help with the project.\nWorkspace: C:/Users/owner/RiotBot/workspaces/riot\nIf asked where the workspace is, answer with this path. Do not search files for it.`,
      pinnedInstructions: 'Keep answers short and practical.'.padEnd(233, ' '),
      pinnedMemories: [],
      retrievedMemories: [],
      summary,
      task: null,
      recent: [stored(newId(), 'what is your workspace location', 'user', 1)],
      tokenBudget: 8000,
      responseAllowance: 2048,
      toolTokenReserve: toolReserve
    })
    expect(built.overBudget).toBe(false)
    expect(built.pauseReason).toBeNull()
    expect(built.messages.some((message) => message.content.includes('what is your workspace location'))).toBe(true)
    expect(built.messages.some((message) => message.content.includes('Workspace:'))).toBe(true)
    expect(fitTokens(built.estimatedTokens)).toBeLessThanOrEqual(8000)
    expect(fitTokens(built.estimatedTokens) + 2048).toBeGreaterThan(8000)
  })

  it('names the overhead instead of asking to shorten a tiny message', () => {
    const built = buildContext({
      systemPrompt: SYSTEM_PROMPT,
      pinnedInstructions: '',
      pinnedMemories: [],
      retrievedMemories: [],
      summary: '',
      task: null,
      recent: [stored(newId(), 'what is your workspace location', 'user', 1)],
      tokenBudget: 1200,
      responseAllowance: 2048,
      toolTokenReserve: toolReserve
    })
    expect(built.hardStop).toBe(true)
    expect(built.pauseReason ?? '').toMatch(/Open Settings/)
    expect(built.pauseReason ?? '').toMatch(/input working budget/)
    expect(built.pauseReason ?? '').not.toMatch(/shorter message/)
    expect(built.pauseReason ?? '').toMatch(/instructions \d+, tools \d+/)
  })

  it('drops older history before rejecting a long conversation', () => {
    const recent: MessageRecord[] = []
    for (let index = 0; index < 6; index += 1) {
      recent.push(stored(newId(), `OLD-LEDGER-${index} ${'note '.repeat(700)}`, 'user', index + 1))
      recent.push(stored(newId(), `Reply ${index} ${'word '.repeat(400)}`, 'assistant', index + 1.1))
    }
    const current = 'what is your workspace location'
    recent.push(stored(newId(), current, 'user', 20))
    const built = buildContext({
      systemPrompt: SYSTEM_PROMPT,
      pinnedInstructions: 'ALWAYS_KEEP_PIN_ALPHA',
      pinnedMemories: [],
      retrievedMemories: [{ id: 'mem-1', content: `retrieved ${'fact '.repeat(400)}` }],
      skillCatalog: [{ id: 'skill-1', name: 'Deploy', description: 'A long skill description '.repeat(20) }],
      summary: 'Summary '.repeat(300),
      task: null,
      recent,
      tokenBudget: 8000,
      responseAllowance: 2048,
      toolTokenReserve: estimateTokens(JSON.stringify(toolsForGroups(['files', 'terminal', 'browser'])))
    })
    expect(built.overBudget).toBe(false)
    expect(built.omittedMessageIds.length).toBeGreaterThan(0)
    const text = built.messages.map((message) => message.content).join('\n')
    expect(text).toContain(current)
    expect(text).toContain('ALWAYS_KEEP_PIN_ALPHA')
    expect(text).not.toContain('OLD-LEDGER-0')
    expect(fitTokens(built.estimatedTokens)).toBeLessThanOrEqual(8000)
  })

  it('sends the short workspace question through the app without pausing', async () => {
    const first = makeApp()
    const conversationId = first.app.getSnapshot().current?.conversation.id ?? ''
    first.app.updateSettings({ toolsEnabled: true, contextTokenBudget: 8000, maxOutputTokens: 2048, pinnedInstructions: 'Keep answers short.'.padEnd(233, ' ') })
    const dbPath = first.dbPath
    await first.app.close()
    const db = new Database(dbPath)
    db.migrate()
    db.setSummary(conversationId, 'Earlier notes. '.repeat(160))
    db.close()
    const second = reopen(dbPath)
    second.provider.handler = (input) => {
      const text = input.messages.map((message) => message.content).join('\n')
      expect(text).toContain('Workspace:')
      expect(text).toContain('what is your workspace location')
      return { content: 'The workspace is listed in the profile.', toolCalls: [] }
    }
    const run = await second.app.sendMessage(conversationId, 'what is your workspace location')
    expect(run.status).toBe('completed')
    expect(run.note).toBe('')
    const notices = second.app.openConversation(conversationId).messages.filter((message) => message.role === 'notice')
    expect(notices).toHaveLength(0)
    await second.app.close()
  })
})

function stored(id: string, content: string, role: MessageRecord['role'], createdAt: number): MessageRecord {
  return {
    id,
    conversationId: 'conversation',
    role,
    content,
    toolCallsJson: null,
    toolCallId: null,
    toolName: null,
    createdAt,
    summarized: false,
    runId: null
  }
}
