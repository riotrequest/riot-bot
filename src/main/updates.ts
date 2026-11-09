import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { NsisUpdater } from 'electron-updater'
import type { AppUpdateState, AppUpdateStatus } from '../shared/types'

type UpdateClient = Pick<NsisUpdater, 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall'>

export class AppUpdates {
  private status: AppUpdateStatus
  private installer: string | null = null

  constructor(
    private readonly currentVersion: string,
    private readonly client: UpdateClient | null,
    private readonly notify: (state: AppUpdateState) => void,
    private readonly verify: (installer: string) => Promise<boolean>,
    private readonly restart: (install: () => void) => void
  ) {
    this.status = { status: client ? 'idle' : 'unavailable' }
  }

  getState(): AppUpdateState {
    return { currentVersion: this.currentVersion, ...this.status }
  }

  private set(status: AppUpdateStatus): void {
    this.status = status
    this.notify(this.getState())
  }

  async check(): Promise<void> {
    if (!this.client || !['idle', 'current', 'error', 'available'].includes(this.status.status)) return
    this.set({ status: 'checking' })
    try {
      const result = await this.client.checkForUpdates()
      if (!result?.isUpdateAvailable) {
        this.set({ status: 'current' })
        return
      }
      const { version, files } = result.updateInfo
      if (!/^\d+\.\d+\.\d+$/.test(version) || !Array.isArray(files) || files.length !== 1 ||
          files[0].url !== 'Riot-Bot-Setup-' + version + '.exe' || !/^[A-Za-z0-9+/]{86}==$/.test(files[0].sha512)) {
        this.set({ status: 'error', message: 'The release is missing the expected Windows installer or checksum.' })
        return
      }
      this.set({ status: 'available', version })
    } catch {
      this.set({ status: 'error', message: 'Could not check for updates. Try again in a moment.' })
    }
  }

  progress(percent: number): void {
    if (this.status.status !== 'downloading' || !Number.isFinite(percent)) return
    const progress = Math.max(0, Math.min(100, Math.floor(percent)))
    if (progress !== this.status.progress) this.set({ ...this.status, progress })
  }

  async download(): Promise<void> {
    if (!this.client || this.status.status !== 'available') return
    const { version } = this.status
    this.set({ status: 'downloading', version, progress: 0 })
    try {
      const [installer] = await this.client.downloadUpdate()
      if (!installer || !(await this.verify(installer))) {
        this.rejectSignature()
        return
      }
      this.installer = installer
      this.set({ status: 'ready', version })
    } catch {
      this.set({ status: 'error', message: 'Could not download and verify the update. Check for updates to try again.' })
    }
  }

  async install(): Promise<void> {
    const client = this.client
    if (!client || !this.installer || this.status.status !== 'ready') return
    const { version } = this.status
    this.set({ status: 'installing', version })
    if (!(await this.verify(this.installer))) {
      this.rejectSignature()
      return
    }
    try {
      this.restart(() => client.quitAndInstall(true, true))
    } catch (error) {
      this.set({ status: 'ready', version })
      throw error
    }
  }

  private rejectSignature(): void {
    this.installer = null
    this.set({ status: 'error', message: 'Windows could not verify the update’s publisher signature. The update was blocked.' })
  }
}

const run = promisify(execFile)
const verifySignature = Buffer.from(`
  $ErrorActionPreference = 'Stop'
  $env:PSModulePath = "$PSHOME\\Modules"
  Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1"
  $installed = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:RIOT_INSTALLED_EXE
  $update = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:RIOT_UPDATE_EXE
  if ($installed.Status -eq 'Valid' -and $update.Status -eq 'Valid' -and
      $installed.SignatureType -eq 'Authenticode' -and $update.SignatureType -eq 'Authenticode' -and
      $installed.SignerCertificate.Subject -and
      $installed.SignerCertificate.Subject -ceq $update.SignerCertificate.Subject) {
    [Console]::WriteLine('verified')
  } else { exit 1 }
`, 'utf16le').toString('base64')

// The v6 updater can skip its check when PowerShell is unavailable. Require a valid embedded
// signature from the installed app's publisher, including when using a cached download.
export async function verifyWindowsPublisher(installer: string): Promise<boolean> {
  try {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const { stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', verifySignature], {
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, RIOT_INSTALLED_EXE: process.execPath, RIOT_UPDATE_EXE: installer }
    })
    return stdout.trim() === 'verified'
  } catch {
    return false
  }
}
