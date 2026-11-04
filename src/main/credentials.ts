import { safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import { credentialSecrets, type CredentialKey, type CredentialStatusSource, type CredentialStore } from '../core/credentials'

export class ElectronCredentialStore implements CredentialStore {
  private readonly session = new Map<CredentialKey, string>()
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

  set(provider: CredentialKey, secret: string): { persistent: boolean; message: string } {
    let encrypted:string|null=null
    if (this.encryptionAvailable) {
      try { encrypted=safeStorage.encryptString(secret).toString('base64') }
      catch { this.encryptionAvailable=false }
    }
    if(encrypted!==null){
      try {
        const data = this.read()
        data[provider] = encrypted
        this.write(data)
        this.session.delete(provider)
        return { persistent: true, message: 'Saved with Windows credential protection. It is not shown again.' }
      } catch { /* File failures do not disable otherwise working OS encryption. */ }
    }
    this.session.set(provider, secret)
    return {
      persistent: false,
      message: 'Saved for this session only. Riot could not update protected storage, so this value will be forgotten when you quit.'
    }
  }

  get(provider: CredentialKey): string | null {
    if (this.session.has(provider)) return this.session.get(provider) ?? null
    if (!this.encryptionAvailable) return null
    try {
      const encoded = this.read()[provider]
      if (!encoded) return null
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      return null
    }
  }

  clear(provider: CredentialKey): void {
    const data = this.read()
    if (Object.hasOwn(data,provider)) {
      delete data[provider]
      this.write(data)
    }
    this.session.delete(provider)
  }

  secretValues(): string[] {
    let saved: string[] = []
    try { saved = Object.keys(this.read()) } catch { /* Unreadable entries are unavailable, never overwritten. */ }
    return credentialSecrets(([...new Set([...saved,...this.session.keys()])] as CredentialKey[])
      .map((provider) => this.get(provider))
      .filter((value): value is string => Boolean(value)))
  }

  private read(): Record<string, string> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value=>typeof value!=='string')) throw new Error('Invalid credential store')
      return parsed as Record<string, string>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code==='ENOENT') return {}
      throw new Error('The saved credential file could not be read. No saved entries were changed.')
    }
  }

  private write(data: Record<string,string>): void {
    const temporary = this.file + '.tmp'
    try {
      fs.writeFileSync(temporary,JSON.stringify(data),{encoding:'utf8',mode:0o600})
      fs.renameSync(temporary,this.file)
    } catch {
      try { fs.unlinkSync(temporary) } catch { /* Keep the original credential file. */ }
      throw new Error('The saved credential file could not be updated. Retry after checking access to Riot’s app-data folder.')
    }
  }
}
