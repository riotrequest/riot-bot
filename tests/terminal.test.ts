import { describe, expect, it } from 'vitest'
import { OsTerminal } from '../src/core/terminal'
import { FakeTerminal, makeApp, waitFor } from './helpers'

describe('terminal approval', () => {
  it('runs only the exact command that was approved', async () => {
    const terminal = new FakeTerminal()
    const { app, provider } = makeApp({ terminal })
    let step = 0
    provider.handler = () => {
      step += 1
      if (step === 1) {
        return { content: '', toolCalls: [{ id: 't1', name: 'run_terminal', arguments: JSON.stringify({ command: 'echo hello-exact' }) }] }
      }
      if (step === 2) {
        return { content: '', toolCalls: [{ id: 't2', name: 'run_terminal', arguments: JSON.stringify({ command: 'echo goodbye' }) }] }
      }
      return { content: 'Finished.', toolCalls: [] }
    }
    const pending = app.sendMessage(app.getSnapshot().conversations[0].id, 'Please run those')
    await waitFor(() => app.pendingApproval()?.command === 'echo hello-exact')
    const first = app.pendingApproval()
    expect(first?.cwd).toBeTruthy()
    expect(first?.timeoutMs).toBeGreaterThan(0)
    app.resolveApproval(first!.id, true)
    await waitFor(() => app.pendingApproval()?.command === 'echo goodbye')
    app.resolveApproval(app.pendingApproval()!.id, false)
    const run = await pending
    expect(run.status).toBe('completed')
    expect(terminal.ran).toEqual(['echo hello-exact'])
    await app.close()
  })

  it('stops a running process tree', async () => {
    const runner = new OsTerminal()
    const controller = new AbortController()
    const started = Date.now()
    const pending = runner.run({
      command: 'ping -n 30 127.0.0.1',
      cwd: process.cwd(),
      timeoutMs: 20000,
      maxOutputChars: 4000,
      signal: controller.signal
    })
    await new Promise((resolve) => setTimeout(resolve, 700))
    const stopped = runner.stop()
    controller.abort()
    const result = await pending
    expect(Date.now() - started).toBeLessThan(8000)
    expect(stopped.ok).toBe(true)
    expect(result.cancelled).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.note.toLowerCase()).toMatch(/stop|end|signal/)
    expect((result.stdout.match(/Reply from|bytes of data/gi) ?? []).length).toBeLessThan(12)
  })
})
