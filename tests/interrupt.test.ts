import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/core/sqlite'
import { makeApp, reopen } from './helpers'

describe('interrupted runs', () => {
  it('does not resume a run or repeat a file write after restart', async () => {
    const first = makeApp()
    const workspace = path.join(first.dir, 'workspace')
    fs.mkdirSync(workspace)
    first.app.updateSettings({ workspacePath: workspace, workspaceEditing: true, model: 'mock-model' })
    const conversationId = first.app.getSnapshot().conversations[0].id
    const dbPath = first.dbPath
    await first.app.close()

    const raw = openDatabase(dbPath)
    const runId = '55555555-5555-4555-8555-555555555555'
    const toolId = '66666666-6666-4666-8666-666666666666'
    const now = Date.now()
    raw
      .prepare(
        `INSERT INTO runs (id, conversation_id, task_id, trigger, status, started_at, ended_at, model_calls, stop_requested, note)
         VALUES (?, ?, NULL, 'user_message', 'running', ?, NULL, 1, 0, '')`
      )
      .run(runId, conversationId, now)
    raw
      .prepare(
        `INSERT INTO tool_calls (id, run_id, request_id, name, arguments_json, result_text, started_at, ended_at, outcome, error)
         VALUES (?, ?, NULL, 'write_file', ?, NULL, ?, NULL, 'started', NULL)`
      )
      .run(toolId, runId, JSON.stringify({ path: 'secret.txt', content: 'SHOULD_NOT_EXIST_INTERRUPT' }), now)
    raw.close()

    const second = reopen(dbPath)
    expect(second.provider.calls).toHaveLength(0)
    expect(fs.existsSync(path.join(workspace, 'secret.txt'))).toBe(false)
    expect(second.app.getRun(runId)?.status).toBe('interrupted')
    const check = openDatabase(dbPath)
    const tool = check.prepare(`SELECT outcome, error FROM tool_calls WHERE id = ?`).get(toolId) as { outcome: string; error: string }
    expect(tool.outcome).toBe('interrupted')
    expect(tool.error.toLowerCase()).toContain('not run again')
    check.close()
    await second.app.close()
  })
})
