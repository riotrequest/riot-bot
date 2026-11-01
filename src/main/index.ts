import { app, BrowserWindow, clipboard, net, protocol, session, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { RiotApp } from '../core/app'
import { ConfigError } from '../core/errors'
import type { Logger } from '../core/logger'
import { createOpenAICompatibleProvider, MockProvider } from '../core/provider'
import { ElectronCredentialStore } from './credentials'
import { registerIpc } from './ipc'
import { contentSecurityPolicy, windowWebPreferences } from './security'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let window: BrowserWindow | null = null
let riot: RiotApp | null = null
let quitting = false

const devUrl = process.env.ELECTRON_RENDERER_URL

function rendererDirectory(): string {
  return path.join(__dirname, '../renderer')
}

function fileLogger(logPath: string): Logger {
  return {
    info(message, meta) {
      append(logPath, 'info', message, meta)
    },
    error(message, meta) {
      append(logPath, 'error', message, meta)
    }
  }
}

function append(file: string, level: string, message: string, meta?: Record<string, unknown>): void {
  fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`)
}

function registerAppProtocol(root: string): void {
  const normalizedRoot = path.normalize(`${root}${path.sep}`)
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname === '') pathname = '/index.html'
    const file = path.normalize(path.join(root, pathname))
    if (file !== path.normalize(root) && !file.startsWith(normalizedRoot)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

function allowedNavigation(url: string): boolean {
  if (devUrl) return url.startsWith(devUrl)
  return url.startsWith('app://local/')
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 880,
    minHeight: 640,
    show: false,
    backgroundColor: '#12141a',
    title: 'Riot Bot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      ...windowWebPreferences
    }
  })
  window.once('ready-to-show', () => window?.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowedNavigation(url)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  if (devUrl) await window.loadURL(devUrl)
  else await window.loadURL('app://local/index.html')
}

app.whenReady().then(async () => {
  app.setAppUserModelId('app.riotbot.desktop')
  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(userData, 'playwright-browsers')
  const logger = fileLogger(path.join(userData, 'riot-bot.log'))
  const credentials = await ElectronCredentialStore.open(userData)
  const providerFetch: typeof fetch = (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)
  riot = new RiotApp({
    dbPath: path.join(userData, 'riot-bot.sqlite'),
    provider: new MockProvider(),
    credentials,
    catalogFetchImpl: providerFetch,
    logger,
    openFolder: (folder) => {
      void shell.openPath(folder)
    },
    writeClipboard: (text) => {
      clipboard.writeText(text)
    },
    openLink: (url) => {
      void shell.openExternal(url)
    },
    createProvider: (settings) => {
      const key = credentials.get(settings.provider)
      if (!key) {
        throw new ConfigError('Add your API key in Settings. A ChatGPT or Cursor subscription does not provide this key.')
      }
      return createOpenAICompatibleProvider({ name: settings.provider, apiKey: key, fetchImpl: providerFetch })
    }
  })
  riot.boot()
  riot.onEvent((event) => {
    if (!window || window.isDestroyed()) return
    window.webContents.send('app:event', event)
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy(Boolean(devUrl))]
      }
    })
  })
  if (!devUrl) registerAppProtocol(rendererDirectory())
  registerIpc(
    () => {
      if (!riot) throw new Error('Riot Bot is still starting.')
      return riot
    },
    () => window,
    credentials
  )
  await createWindow()
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Riot Bot could not start.'
  console.error(message)
  app.quit()
})

app.on('second-instance', () => {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.on('before-quit', (event) => {
  if (!riot || quitting) return
  event.preventDefault()
  quitting = true
  void riot.close().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (!quitting) app.quit()
})
