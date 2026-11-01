import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, windowWebPreferences } from '../src/main/security'

describe('electron security policy', () => {
  it('keeps the renderer sandbox and a restrictive content policy', () => {
    expect(windowWebPreferences.contextIsolation).toBe(true)
    expect(windowWebPreferences.nodeIntegration).toBe(false)
    expect(windowWebPreferences.sandbox).toBe(true)
    expect(windowWebPreferences.webSecurity).toBe(true)
    expect(windowWebPreferences.webviewTag).toBe(false)
    const policy = contentSecurityPolicy(false)
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(contentSecurityPolicy(true)).toMatch(/script-src[^;]*unsafe-inline/)
    expect(policy).toContain("object-src 'none'")
    expect(policy).not.toContain('unsafe-eval')
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const credentials = fs.readFileSync(path.join(process.cwd(), 'src/main/credentials.ts'), 'utf8')
    const markdown = fs.readFileSync(path.join(process.cwd(), 'src/renderer/src/markdown.tsx'), 'utf8')
    expect(main).toContain('windowWebPreferences')
    expect(main).not.toContain('nodeIntegration: true')
    expect(credentials).toContain('isAsyncEncryptionAvailable')
    expect(credentials).not.toContain('isEncryptionAvailable(')
    expect(markdown).not.toContain('rehype-raw')
    expect(markdown).not.toContain('dangerouslySetInnerHTML')
  })
})
