import { describe, expect, it } from 'vitest'
import { Database, type MessageRecord } from '../src/core/db'
import { newId } from '../src/core/ids'
import { makeApp, reopen } from './helpers'

describe('paged conversation history', () => {
  it('opens a bounded page and visits tied timestamps exactly once, preserving saved run outcomes', async () => {
    const { app, dbPath, provider } = makeApp()
    const conversationId = app.getSnapshot().current!.conversation.id
    const db = new Database(dbPath)
    const ids: string[] = []
    const failed = db.createRun(conversationId, 10)
    db.finishRun(failed.id, 'failed', 11, 'fixture failure')
    const completed = db.createRun(conversationId, 12)
    db.finishRun(completed.id, 'completed', 13, '')
    for (let index = 0; index < 2081; index++) ids.push(newId())
    // One commit for the whole fixture: a commit per row takes most of 30 seconds on CI disks.
    db.addMessages(ids.map((id, index) => message(id, conversationId, index < 100 ? failed.id : completed.id, `Saved message ${index}`)))
    const first = app.openConversation(conversationId)
    expect(first.messages).toHaveLength(80)
    expect(first.messages.map((item) => item.id)).toEqual(ids.slice(-80))
    const restored = [...first.messages]
    let cursor = first.olderMessagesCursor
    while (cursor) {
      const page = app.loadOlderMessages(conversationId, cursor)
      expect(page.messages.length).toBeLessThanOrEqual(80)
      restored.unshift(...page.messages)
      cursor = page.olderMessagesCursor
    }
    expect(restored.map((item) => item.id)).toEqual(ids)
    expect(restored[0]).toMatchObject({ runId: failed.id, runStatus: 'failed' })
    expect(restored.at(-1)).toMatchObject({ runId: completed.id, runStatus: 'completed' })
    expect(provider.calls).toHaveLength(0)
    db.close()
    await app.close()
    const restarted = reopen(dbPath)
    expect(restarted.app.openConversation(conversationId).messages.at(-1)?.runStatus).toBe('completed')
    const old = restarted.app.loadOlderMessages(conversationId, ids[80])
    expect(old.messages[0].runStatus).toBe('failed')
    await restarted.app.close()
  })

  it('rejects a cursor from another conversation and keeps nearby reads bounded', async () => {
    const { app, dbPath } = makeApp()
    const a = app.getSnapshot().current!.conversation.id
    const b = app.createConversation().id
    const db = new Database(dbPath)
    const anchor = newId()
    db.addMessage(message(anchor, b, null, 'other conversation'))
    expect(() => app.loadOlderMessages(a, anchor)).toThrow(/not in this conversation/)
    expect(() => app.loadOlderMessages(a, newId())).toThrow(/not in this conversation/)
    for (let index = 0; index < 12; index++) db.addMessage(message(newId(), a, null, `around ${index}`))
    const all = db.listMessages(a)
    expect(db.messagesAround(all[6].id, 2, 3).map((item) => item.id)).toEqual(all.slice(4, 10).map((item) => item.id))
    db.close()
    await app.close()
  })
})

function message(id: string, conversationId: string, runId: string | null, content: string): MessageRecord {
  return { id, conversationId, runId, content, role: 'user', toolCallsJson: null, toolCallId: null, toolName: null, createdAt: 20, summarized: false }
}
