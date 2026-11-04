import { describe, expect, it } from 'vitest'
import { MemoryCredentialStore } from '../src/core/credentials'
import { ProviderError } from '../src/core/errors'
import { MemoryLogger, RedactingLogger } from '../src/core/logger'
import { redact } from '../src/core/redact'
import { memoryRejection } from '../src/core/memory'
import { makeApp } from './helpers'

const KEY = 'purple-lantern-key-99'

describe('credentials', () => {
  it('refuses to save a known short password in ordinary memory',()=>{
    expect(memoryRejection('My account PIN is 1234',['1234'])).not.toBeNull()
    expect(memoryRejection('The project uses ticket ABC1234',['1234'])).toBeNull()
  })
  it('keeps secrets out of renderer payloads, activity, and logs', async () => {
    const sink = new MemoryLogger()
    const logger = new RedactingLogger(sink, () => [KEY])
    logger.info(`using ${KEY}`, { authorization: `Bearer ${KEY}` })
    expect(sink.lines.join('\n')).not.toContain(KEY)
    expect(redact(`sk-live-secret-value-123456 and ${KEY}`, [KEY])).not.toContain(KEY)
    expect(redact('sk-live-secret-value-123456', [])).not.toContain('sk-live')

    const { app, provider, credentials } = makeApp()
    const saved = app.setCredential('openai', KEY)
    expect(saved.message).not.toContain(KEY)
    expect(JSON.stringify(app.getSnapshot())).not.toContain(KEY)
    expect(JSON.stringify(credentials.status())).not.toContain(KEY)
    provider.handler = () => {
      throw new ProviderError('unknown', `provider echoed ${KEY}`)
    }
    await app.sendMessage(app.getSnapshot().conversations[0].id, 'Hello')
    const dumped = JSON.stringify({ activity: app.listActivity(), snapshot: app.getSnapshot() })
    expect(dumped).not.toContain(KEY)
    const logs = JSON.stringify((credentials as MemoryCredentialStore).secretValues())
    expect(logs).toContain(KEY)
    expect(JSON.stringify(app.listActivity())).not.toContain(KEY)
    await app.close()
  })
})
