import fs from 'fs'
import os from 'os'
import path from 'path'
import { RiotApp, type RiotAppOptions } from '../src/core/app'
import { MemoryCredentialStore } from '../src/core/credentials'
import { MemoryLogger } from '../src/core/logger'
import { MockProvider } from '../src/core/provider'
import type { TerminalRunner } from '../src/core/terminal'

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'riot-bot-'))
}

export function makeApp(options?: Partial<Pick<RiotAppOptions, 'terminal' | 'fetchImpl' | 'lookupHost' | 'createProvider' | 'workspaceRoot' | 'openFolder' | 'revealFile' | 'writeClipboard' | 'browserOpener' | 'now' | 'codex'>> & { provider?: MockProvider; dbPath?: string; learning?: boolean }) {
  const dir = options?.dbPath ? path.dirname(options.dbPath) : tempDir()
  const dbPath = options?.dbPath ?? path.join(dir, 'riot.sqlite')
  const provider = options?.provider ?? new MockProvider()
  const credentials = new MemoryCredentialStore()
  const logger = new MemoryLogger()
  const app = new RiotApp({
    dbPath,
    provider,
    credentials,
    logger,
    terminal: options?.terminal,
    codex: options?.codex,
    fetchImpl: options?.fetchImpl,
    lookupHost: options?.lookupHost,
    createProvider: options?.createProvider,
    workspaceRoot: options?.workspaceRoot ?? path.join(dir, 'workspaces'),
    openFolder: options?.openFolder,
    revealFile: options?.revealFile,
    writeClipboard: options?.writeClipboard,
    browserOpener: options?.browserOpener,
    now: options?.now
  })
  app.boot()
  app.updateSettings({ model: 'mock-model' })
  // Foreground regression fixtures opt out of optional reviews; learning tests enable the real defaults.
  if (!options?.learning) {
    app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
    const create = app.createBot.bind(app)
    app.createBot = async draft => {
      const result = await create(draft)
      app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
      return result
    }
  }
  return { dir, dbPath, app, provider, credentials, logger }
}

export function reopen(dbPath: string, provider = new MockProvider()) {
  const credentials = new MemoryCredentialStore()
  const logger = new MemoryLogger()
  const app = new RiotApp({ dbPath, provider, credentials, logger })
  app.boot()
  return { app, provider, credentials, logger }
}

export async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('Timed out.')
}

export class FakeTerminal implements TerminalRunner {
  ran: string[] = []
  stopCount = 0

  async run(input: { command: string }): Promise<{
    stdout: string
    stderr: string
    exitCode: number | null
    timedOut: boolean
    cancelled: boolean
    truncated: boolean
    note: string
  }> {
    this.ran.push(input.command)
    return { stdout: 'ok', stderr: '', exitCode: 0, timedOut: false, cancelled: false, truncated: false, note: '' }
  }

  stop(): { ok: boolean; detail: string } {
    this.stopCount += 1
    return { ok: true, detail: 'stopped' }
  }
}
