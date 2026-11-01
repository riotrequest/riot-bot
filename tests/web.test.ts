import { describe, expect, it } from 'vitest'
import { fetchPublicUrl, isPrivateAddress, validatePublicUrl } from '../src/core/web'

describe('web fetch', () => {
  it('blocks local, private, and redirected-to-private addresses', async () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('10.1.2.3')).toBe(true)
    expect(isPrivateAddress('192.168.0.8')).toBe(true)
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(() => validatePublicUrl('http://127.0.0.1/')).toThrow(/private|Local/)
    expect(() => validatePublicUrl('http://localhost/secret')).toThrow(/private|Local/)
    expect(() => validatePublicUrl('file:///C:/Windows/win.ini')).toThrow(/http/)
    expect(() => validatePublicUrl('http://user:pass@example.com/')).toThrow(/username/)

    const seen: string[] = []
    const lookupHost = async (host: string) => (host === 'sneaky.example' ? ['127.0.0.1'] : ['93.184.216.34'])
    await expect(
      fetchPublicUrl({
        url: 'https://sneaky.example/hidden',
        lookupHost,
        timeoutMs: 1000,
        maxBytes: 1000,
        signal: new AbortController().signal,
        fetchImpl: async () => {
          throw new Error('should not fetch')
        }
      })
    ).rejects.toThrow(/private/)

    await expect(
      fetchPublicUrl({
        url: 'https://public.example/start',
        lookupHost,
        timeoutMs: 1000,
        maxBytes: 1000,
        signal: new AbortController().signal,
        fetchImpl: async (url) => {
          seen.push(String(url))
          return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
        }
      })
    ).rejects.toThrow(/private|Local/)
    expect(seen).toEqual(['https://public.example/start'])
  })

  it('cancels and enforces the size limit', async () => {
    const lookupHost = async () => ['93.184.216.34']
    const controller = new AbortController()
    const pending = fetchPublicUrl({
      url: 'https://public.example/slow',
      lookupHost,
      timeoutMs: 5000,
      maxBytes: 1000,
      signal: controller.signal,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        })
    })
    controller.abort()
    await expect(pending).rejects.toThrow(/Stopped/)

    await expect(
      fetchPublicUrl({
        url: 'https://public.example/big',
        lookupHost,
        timeoutMs: 1000,
        maxBytes: 8,
        signal: new AbortController().signal,
        fetchImpl: async () => new Response('0123456789', { status: 200, headers: { 'content-type': 'text/plain' } })
      })
    ).rejects.toThrow(/larger than/)
  })
})
