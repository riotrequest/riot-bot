import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { MemoryCredentialStore } from '../src/core/credentials'
import { StopError } from '../src/core/errors'
import type { ModelResponse } from '../src/core/model'
import { MockProvider } from '../src/core/provider'
import { RiotService } from '../src/core/service'
import type { ElectronCredentialStore } from '../src/main/credentials'
import type { AppEvent } from '../src/shared/types'
import { tempDir, waitFor } from './helpers'

const native = vi.hoisted(() => ({ handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>() }))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => native.handlers.set(name, handler) },
  Menu: {}, clipboard: {}, dialog: {}
}))
import { registerIpc } from '../src/main/ipc'
import { shutDown } from '../src/main/shutdown'

/** The real service and IPC handlers, with a window whose renderer refreshes on every jobs change, like App.tsx. */
function desktop() {
  native.handlers.clear()
  const dir = tempDir(), provider = new MockProvider()
  const service = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), provider, credentials: new MemoryCredentialStore() })
  service.boot()
  const mainFrame = { url: 'app://local/index.html' }
  let destroyed = false
  const window = { webContents: { mainFrame }, isDestroyed: () => destroyed, destroy: () => { destroyed = true } }
  const event = { sender: window.webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
  const ipc = registerIpc(() => service, () => (destroyed ? null : window as unknown as BrowserWindow), { secretValues: () => [] } as unknown as ElectronCredentialStore)
  const refreshes: Promise<string>[] = []
  const invoke = (channel: string, ...args: unknown[]): Promise<string> => native.handlers.get(channel)!(event, ...args).then(() => 'ok', (error: Error) => error.message)
  // The main process forwards service events only to a live window.
  service.onEvent((item: AppEvent) => {
    if (destroyed || item.type !== 'jobs-changed') return
    setTimeout(() => refreshes.push(invoke('jobs:list', 'app'), invoke('app:getSnapshot')), 0)
  })
  /** Waits for the window's refreshes so far and returns their outcomes. */
  const settle = async (): Promise<string[]> => {
    await new Promise(resolve => setTimeout(resolve, 50))
    return Promise.all(refreshes.splice(0))
  }
  return { dir, provider, service, window, ipc, invoke, settle }
}

describe('quitting the desktop app', () => {
  it('reproduces the race when the service closes while the window still refreshes', async () => {
    const { service, settle } = desktop()
    await service.close()
    expect(await settle()).toContain('database is not open')
  })

  it('closes the window and its requests before the database, keeps job cleanup, then installs', async () => {
    const { dir, provider, service, window, ipc, invoke, settle } = desktop()
    const created = await service.createBot({ name: 'Quit Check', purpose: 'Check a clean quit', provider: 'openai', model: 'mock-model', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' })
    service.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
    provider.handler = input => new Promise<ModelResponse>((_resolve, reject) => input.signal?.addEventListener('abort', () => reject(new StopError('Stopped.')), { once: true }))
    const active = service.queueMessage(created.conversation.id, 'Long task')
    const queued = service.queueMessage(created.conversation.id, 'Follow-up')
    await waitFor(() => provider.calls.length === 1)
    expect(new Set(await settle())).toEqual(new Set(['ok']))
    const steps: string[] = []
    await shutDown({
      ipc,
      window,
      service: { close: async () => { steps.push(window.isDestroyed() ? 'service after window' : 'service with window open'); await service.close(); steps.push('service closed') } },
      install: () => steps.push('install')
    })
    expect(steps).toEqual(['service after window', 'service closed', 'install'])
    expect(await settle()).toEqual([])
    expect(await invoke('jobs:list', 'app')).toBe('Riot Bot is closing.')
    expect(await invoke('app:getSnapshot')).toBe('Riot Bot is closing.')

    const reopened = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'workspaces'), provider: new MockProvider(), credentials: new MemoryCredentialStore() })
    reopened.boot()
    try {
      const jobs = reopened.listJobs('app')
      expect(jobs.find(job => job.id === active.id)?.status).toBe('interrupted')
      expect(jobs.find(job => job.id === queued.id)).toMatchObject({ status: 'paused', note: expect.stringMatching(/Riot Bot quit/) })
    } finally { await reopened.close() }
  })

  it('does not install an update when the service fails to close', async () => {
    const { service, window, ipc } = desktop()
    const install = vi.fn()
    await expect(shutDown({ ipc, window, service: { close: () => Promise.reject(new Error('stuck')) }, install })).rejects.toThrow('stuck')
    expect(install).not.toHaveBeenCalled()
    await service.close()
  })
})
