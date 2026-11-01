import { describe, expect, it } from 'vitest'
import { ProviderError } from '../src/core/errors'
import { FakeTerminal, makeApp, waitFor } from './helpers'

describe('stop', () => {
  it('cancels the active request and does not make another model or tool call', async () => {
    const { app, provider } = makeApp()
    let calls = 0
    provider.handler = (input) =>
      new Promise((resolve, reject) => {
        calls += 1
        const timer = setTimeout(() => resolve({ content: 'too late', toolCalls: [] }), 5000)
        input.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new ProviderError('cancelled', 'Stopped.'))
        })
      })
    const pending = app.sendMessage(app.getSnapshot().conversations[0].id, 'Start something long')
    await waitFor(() => provider.calls.length === 1)
    app.stop()
    const run = await pending
    expect(run.status).toBe('stopped')
    expect(run.note.toLowerCase()).toContain('billed')
    expect(calls).toBe(1)
    expect(provider.calls).toHaveLength(1)
    await app.close()
  })

  it('does not run a command or continue after stop during approval', async () => {
    const terminal = new FakeTerminal()
    const { app, provider } = makeApp({ terminal })
    provider.handler = () => ({
      content: '',
      toolCalls: [{ id: 'term-1', name: 'run_terminal', arguments: JSON.stringify({ command: 'echo hello-exact' }) }]
    })
    const pending = app.sendMessage(app.getSnapshot().conversations[0].id, 'Run it')
    await waitFor(() => app.pendingApproval()?.command === 'echo hello-exact')
    app.stop()
    const run = await pending
    expect(run.status).toBe('stopped')
    expect(terminal.ran).toEqual([])
    expect(provider.calls).toHaveLength(1)
    await app.close()
  })
})
