import type { ApiProviderId } from '../shared/types'

export type CustomKeySlot = 'custom-key-a' | 'custom-key-b'

export function endpointApiKey(store: CredentialStore, connection: { customBaseUrl: string; customKeySlot?: CustomKeySlot; customKeyId?: string }): string | null {
  if (!connection.customBaseUrl || !connection.customKeySlot || !connection.customKeyId) return null
  const value = store.get(connection.customKeySlot)
  if (!value) return null
  try {
    const saved = JSON.parse(value)
    return saved.id === connection.customKeyId && saved.baseUrl === connection.customBaseUrl && typeof saved.apiKey === 'string' ? saved.apiKey : null
  } catch { return null }
}

export type CredentialKey = CustomKeySlot | ApiProviderId | 'gmail-client' | 'gmail' | 'research-tavily' | 'research-firecrawl' | `logins:${string}` | `server-logins:${string}`

export function credentialSecrets(values: string[]): string[] {
  const fields = new Set(['apiKey','clientSecret','accessToken','refreshToken','password'])
  const collect = (value: unknown): string[] => !value || typeof value!=='object' ? [] : Object.entries(value).flatMap(([key,item])=>fields.has(key)&&typeof item==='string' ? [item] : collect(item))
  return values.flatMap(value => {
    try {
      const data = JSON.parse(value)
      return [value, ...collect(data)]
    } catch { return [value] }
  })
}

export interface CredentialStatusSource {
  storage: 'os' | 'session'
  encryptionAvailable: boolean
  explanation: string
  sessionOnly?(key: CredentialKey): boolean
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
      sessionOnly: key => !this.encryptionAvailable && this.values.has(key),
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
