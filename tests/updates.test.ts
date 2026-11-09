import { describe, expect, it, vi } from 'vitest'
import type { UpdateCheckResult } from 'electron-updater'
import { AppUpdates, verifyWindowsPublisher } from '../src/main/updates'
import type { AppUpdateState } from '../src/shared/types'

const installer = 'Riot-Bot-Setup-0.2.0.exe'
const sha512 = 'A'.repeat(86) + '=='
const updateInfo = { version: '0.2.0', files: [{ url: installer, sha512 }], path: installer, sha512, releaseDate: '2026-11-09T00:00:00Z' }
const available: UpdateCheckResult = { isUpdateAvailable: true, updateInfo, versionInfo: updateInfo }

function setup() {
  const client = {
    checkForUpdates: vi.fn<() => Promise<UpdateCheckResult | null>>().mockResolvedValue(available),
    downloadUpdate: vi.fn<() => Promise<string[]>>().mockResolvedValue([installer]),
    quitAndInstall: vi.fn()
  }
  const notify = vi.fn<(state: AppUpdateState) => void>()
  const verify = vi.fn<(file: string) => Promise<boolean>>().mockResolvedValue(true)
  const restart = vi.fn<(install: () => void) => void>()
  const updates = new AppUpdates('0.1.0', client, notify, verify, restart)
  return { updates, client, notify, verify, restart }
}

describe('app updates', () => {
  it('leaves source builds inactive and reports the installed version', async () => {
    const notify = vi.fn()
    const verify = vi.fn()
    const restart = vi.fn()
    const updates = new AppUpdates('0.1.0', null, notify, verify, restart)
    await updates.check()
    await updates.download()
    await updates.install()
    expect(updates.getState()).toEqual({ status: 'unavailable', currentVersion: '0.1.0' })
    expect(notify).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
  })

  it('checks once for concurrent requests and waits for explicit download and restart', async () => {
    const { updates, client, notify, verify, restart } = setup()
    await Promise.all([updates.check(), updates.check()])
    expect(client.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updates.getState()).toMatchObject({ status: 'available', version: '0.2.0' })
    await updates.install()
    expect(client.downloadUpdate).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()

    const download = updates.download()
    updates.progress(41.9)
    expect(updates.getState()).toMatchObject({ status: 'downloading', progress: 41 })
    await Promise.all([download, updates.download(), updates.check(), updates.install()])
    expect(client.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({ status: 'ready', version: '0.2.0', currentVersion: '0.1.0' })
    expect(client.quitAndInstall).not.toHaveBeenCalled()

    await Promise.all([updates.install(), updates.install()])
    expect(verify.mock.calls).toEqual([[installer], [installer]])
    expect(restart).toHaveBeenCalledTimes(1)
    restart.mock.calls[0][0]()
    expect(client.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('rejects unverifiable downloads and refuses a cached installer that changes before restart', async () => {
    const { updates, client, verify, restart } = setup()
    verify.mockResolvedValueOnce(false)
    await updates.check()
    await updates.download()
    expect(updates.getState()).toMatchObject({ status: 'error', message: expect.stringContaining('publisher signature') })
    await updates.install()
    expect(restart).not.toHaveBeenCalled()

    await updates.check()
    await updates.download()
    verify.mockResolvedValueOnce(false)
    await updates.install()
    expect(updates.getState()).toMatchObject({ status: 'error' })
    expect(restart).not.toHaveBeenCalled()
    expect(client.quitAndInstall).not.toHaveBeenCalled()
  })

  it('keeps a verified update ready if the app is busy and allows a retry', async () => {
    const { updates, restart } = setup()
    await updates.check()
    await updates.download()
    restart.mockImplementationOnce(() => { throw new Error('Pending work') })
    await expect(updates.install()).rejects.toThrow('Pending work')
    expect(updates.getState()).toMatchObject({ status: 'ready', version: '0.2.0' })
    await updates.install()
    expect(restart).toHaveBeenCalledTimes(2)
  })

  it('lets the user retry a failed check without exposing the provider error', async () => {
    const { updates, client } = setup()
    client.checkForUpdates.mockRejectedValueOnce(new Error('internal details'))
    await updates.check()
    expect(updates.getState()).toMatchObject({ status: 'error', message: 'Could not check for updates. Try again in a moment.' })
    client.checkForUpdates.mockResolvedValueOnce({ ...available, isUpdateAvailable: false })
    await updates.check()
    expect(updates.getState()).toEqual({ status: 'current', currentVersion: '0.1.0' })
  })

  it('refuses installer URLs supplied by release metadata', async () => {
    const { updates, client } = setup()
    client.checkForUpdates.mockResolvedValueOnce({
      ...available,
      updateInfo: { ...updateInfo, files: [{ url: 'http://127.0.0.1/setup.exe', sha512 }] }
    })
    await updates.check()
    expect(updates.getState()).toMatchObject({ status: 'error' })
    await updates.download()
    expect(client.downloadUpdate).not.toHaveBeenCalled()
  })

  it.runIf(process.platform === 'win32')('rejects a path with no verifiable Authenticode signature', async () => {
    await expect(verifyWindowsPublisher(__filename)).resolves.toBe(false)
  }, 35_000)
})
