import type { ApiProviderId } from '../shared/types'

export type CredentialKey = ApiProviderId | 'gmail-client' | 'gmail'

export function credentialSecrets(values: string[]): string[] {
  return values.flatMap(value => {
    try {
      const data = JSON.parse(value)
      return [value, ...['clientSecret', 'accessToken', 'refreshToken'].map(key => data?.[key]).filter((item): item is string => typeof item === 'string' && Boolean(item))]
    } catch { return [value] }
  })
}

export interface CredentialStatusSource {
  storage: 'os' | 'session'
  encryptionAvailable: boolean
  explanation: string
  has(provider: ApiProviderId): boolean
}

export interface CredentialStore {
  status(): CredentialStatusSource
  set(provider: CredentialKey, secret: string): { persistent: boolean; message: string }
  get(provider: CredentialKey): string | null
  clear(provider: CredentialKey): void
  secretValues(): string[]
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<CredentialKey, string>()
  encryptionAvailable: boolean
  storage: 'os' | 'session'

  constructor(options?: { encryptionAvailable?: boolean }) {
    this.encryptionAvailable = options?.encryptionAvailable ?? false
    this.storage = this.encryptionAvailable ? 'os' : 'session'
  }

  status(): CredentialStatusSource {
    return {
      storage: this.storage,
      encryptionAvailable: this.encryptionAvailable,
      explanation: this.encryptionAvailable
        ? 'API keys are encrypted with the operating system and are not shown again.'
        : 'This session cannot use operating-system credential protection. A key stays in memory only and is forgotten when Riot Bot closes.',
      has: (provider) => this.values.has(provider) && Boolean(this.values.get(provider))
    }
  }

  set(provider: CredentialKey, secret: string): { persistent: boolean; message: string } {
    this.values.set(provider, secret)
    if (!this.encryptionAvailable) {
      return {
        persistent: false,
        message: 'Saved for this session only. Riot Bot could not use operating-system credential protection, so the key will be forgotten when you quit.'
      }
    }
    return { persistent: true, message: 'Saved with operating-system credential protection. It is not shown again.' }
  }

  get(provider: CredentialKey): string | null {
    return this.values.get(provider) ?? null
  }

  clear(provider: CredentialKey): void {
    this.values.delete(provider)
  }

  secretValues(): string[] {
    return credentialSecrets([...this.values.values()])
  }
}
