import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { Database } from '../src/core/db'
import { Gateway } from '../src/core/gateway'
import { MockProvider } from '../src/core/provider'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/core/settings'
import { openDatabase } from '../src/core/sqlite'
import { makeApp, reopen } from './helpers'

describe('idle launch', () => {
  it('does not call a provider on launch, viewing, settings changes, or restart', async () => {
    const first = makeApp()
    first.app.getSnapshot()
    first.app.listMemories()
    first.app.listActivity()
    first.app.getUsage()
    first.app.updateSettings({ workspaceEditing: false, streaming: true })
    expect(first.provider.calls).toHaveLength(0)
    const dbPath = first.dbPath
    await first.app.close()

    const second = reopen(dbPath)
    second.app.getSnapshot()
    second.app.openConversation(second.app.getSnapshot().conversations[0].id)
    expect(second.provider.calls).toHaveLength(0)
    await second.app.close()
  })

  it('rejects a model call whose run was not triggered by the user', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-bot-'))
    const dbPath = path.join(dir, 'riot.sqlite')
    const setup = new Database(dbPath)
    setup.migrate()
    setup.saveSettings(sanitizeSettings({ ...DEFAULT_SETTINGS, model: 'mock-model' }))
    const conversation = setup.createConversation('Main', Date.now())
    setup.close()
    const raw = openDatabase(dbPath)
    const runId = '11111111-1111-1111-1111-111111111111'
    raw
      .prepare(
        `INSERT INTO runs (id, conversation_id, task_id, trigger, status, started_at, ended_at, model_calls, stop_requested, note)
         VALUES (?, ?, NULL, 'startup', 'running', ?, NULL, 0, 0, '')`
      )
      .run(runId, conversation.id, Date.now())
    raw.close()

    const provider = new MockProvider()
    const database = new Database(dbPath)
    database.migrate()
    const gateway = new Gateway({
      db: database,
      provider: () => provider,
      getSettings: () => database.getSettings(),
      now: () => Date.now(),
      secrets: () => [],
      logger: { info() {}, error() {} }
    })
    await expect(
      gateway.request({
        runId,
        purpose: 'chat',
        messages: [{ role: 'user', content: 'hello' }],
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/not started by a message you sent/)
    expect(provider.calls).toHaveLength(0)
    database.close()
  })
})
