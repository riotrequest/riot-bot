import { safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import type { CredentialStatusSource, CredentialStore } from '../core/credentials'
import type { ProviderId } from '../shared/types'

export class ElectronCredentialStore implements CredentialStore {
  private readonly session = new Map<ProviderId, string>()
  private readonly file: string
  private encryptionAvailable: boolean

  static async open(userData: string): Promise<ElectronCredentialStore> {
    let encryptionAvailable = false
    try {
      encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable()
    } catch {
      encryptionAvailable = false
    }
    return new ElectronCredentialStore(userData, encryptionAvailable)
  }

  constructor(userData: string, encryptionAvailable: boolean) {
    this.file = path.join(userData, 'credentials.bin.json')
    this.encryptionAvailable = encryptionAvailable
  }

  status(): CredentialStatusSource {
    const available = this.encryptionAvailable
    return {
      storage: available ? 'os' : 'session',
      encryptionAvailable: available,
      explanation: available
        ? 'API keys are protected by Windows and are not shown again.'
        : 'Windows credential protection is not available. A key stays in memory only and is forgotten when you quit Riot Bot.',
      has: (provider) => Boolean(this.get(provider))
    }
  }

  set(provider: ProviderId, secret: string): { persistent: boolean; message: string } {
    if (this.encryptionAvailable) {
      try {
        const data = this.read()
        data[provider] = safeStorage.encryptString(secret).toString('base64')
        fs.writeFileSync(this.file, JSON.stringify(data), 'utf8')
        this.session.delete(provider)
        return { persistent: true, message: 'Saved with Windows credential protection. It is not shown again.' }
      } catch {
        this.encryptionAvailable = false
      }
    }
    this.session.set(provider, secret)
    return {
      persistent: false,
      message: 'Saved for this session only. Windows credential protection is unavailable, so the key will be forgotten when you quit.'
    }
  }

  get(provider: ProviderId): string | null {
    if (this.session.has(provider)) return this.session.get(provider) ?? null
    if (!this.encryptionAvailable) return null
    const encoded = this.read()[provider]
    if (!encoded) return null
    try {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      return null
    }
  }

  clear(provider: ProviderId): void {
    this.session.delete(provider)
    if (!this.encryptionAvailable) return
    const data = this.read()
    delete data[provider]
    fs.writeFileSync(this.file, JSON.stringify(data), 'utf8')
  }

  secretValues(): string[] {
    return (['openai', 'openrouter'] as ProviderId[])
      .map((provider) => this.get(provider))
      .filter((value): value is string => Boolean(value))
  }

  private read(): Record<string, string> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return parsed as Record<string, string>
    } catch {
      return {}
    }
  }
}
