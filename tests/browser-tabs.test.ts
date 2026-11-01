import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openPlaywrightBrowser } from '../src/core/browser-playwright'
import { tempDir } from './helpers'

const launch = vi.hoisted(() => vi.fn())
vi.mock('playwright-core', () => ({ chromium: { executablePath: () => process.execPath, launchPersistentContext: launch } }))

describe('Playwright tab lifecycle', () => {
  it.each(['chrome', 'msedge'] as const)('uses installed %s in a separate bot profile when Chromium is missing', async (channel) => {
    launch.mockClear()
    const profile = tempDir()
    const context = Object.assign(new EventEmitter(), { route: async () => undefined, pages: () => [], close: async () => undefined })
    launch.mockResolvedValue(context)
    const suffix = channel === 'chrome' ? path.join('Google', 'Chrome', 'Application', 'chrome.exe') : path.join('Microsoft', 'Edge', 'Application', 'msedge.exe')
    const exists = vi.spyOn(fs, 'existsSync').mockImplementation((file) => String(file).endsWith(suffix))
    try {
      const browser = await openPlaywrightBrowser({ profileDir: profile, proxyUrl: 'http://127.0.0.1:9', browsersPath: tempDir() })
      expect(launch).toHaveBeenCalledWith(path.join(profile, channel), expect.objectContaining({ channel, headless: false, chromiumSandbox: true, acceptDownloads: false }))
      expect(browser.name).toBe(channel === 'chrome' ? 'Google Chrome' : 'Microsoft Edge')
      await browser.close()
    } finally { exists.mockRestore() }
  })

  it('reports missing browsers without trying a download', async () => {
    launch.mockClear()
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    try {
      await expect(openPlaywrightBrowser({ profileDir: tempDir(), proxyUrl: 'http://127.0.0.1:9', browsersPath: tempDir() })).rejects.toThrow(/No supported browser/)
      expect(launch).not.toHaveBeenCalled()
    } finally { exists.mockRestore() }
  })

  it('removes closed tabs, selects a live tab, and can open another after all close', async () => {
    class Page extends EventEmitter {
      setDefaultTimeout(): void {}
      setDefaultNavigationTimeout(): void {}
      async close(): Promise<void> { this.emit('close') }
    }
    const first = new Page()
    const context = Object.assign(new EventEmitter(), {
      route: async () => undefined,
      pages: () => [first],
      newPage: async () => { const page = new Page(); context.emit('page', page); return page },
      close: async () => undefined
    })
    launch.mockResolvedValue(context)
    const browser = await openPlaywrightBrowser({ profileDir: tempDir(), proxyUrl: 'http://127.0.0.1:9', browsersPath: tempDir() })
    const original = browser.current()
    const second = await browser.openPage()
    expect(browser.pages()).toHaveLength(2)
    await second.close()
    expect(browser.pages()).toEqual([original])
    expect(browser.current()).toBe(original)
    await original!.close()
    expect(browser.pages()).toEqual([])
    expect(browser.current()).toBeNull()
    const third = await browser.openPage()
    expect(browser.pages()).toEqual([third])
    expect(browser.current()).toBe(third)
    await browser.close()
  })
})
