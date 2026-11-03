import { app, BrowserWindow, clipboard, Menu, nativeImage, net, Notification, protocol, session, shell, Tray } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { RiotService } from '../core/service'
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
let riot: RiotService | null = null
let tray: Tray | null = null
let quitting = false
let quitReady = false
const reminderNotifications = new Set<Notification>()

const devUrl = process.env.ELECTRON_RENDERER_URL

function showWindow(): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function createTray(): void {
  // A small bitmap keeps the tray independent of packaged resource paths.
  const pixels = Buffer.alloc(24 * 24 * 4)
  for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) {
    const offset = (y * 24 + x) * 4
    const mark = x >= 7 && x <= 10 && y >= 6 && y <= 18 || y >= 6 && y <= 9 && x >= 9 && x <= 16 || x >= 14 && x <= 16 && y >= 9 && y <= 12 || y >= 11 && y <= 13 && x >= 9 && x <= 16 || y >= 14 && y <= 18 && x >= y - 2 && x <= y + 1
    pixels.set(mark ? [245, 235, 230, 255] : [74, 84, 212, 255], offset)
  }
  tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 24, height: 24 }))
  tray.setToolTip('Riot Bot · Ready')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Riot Bot', click: showWindow },
    { label: 'Stop all work', click: () => riot?.stopAll() },
    { type: 'separator' },
    { label: 'Quit Riot Bot', click: () => app.quit() }
  ]))
  tray.on('double-click', showWindow)
}

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
    backgroundColor: '#191c1e',
    title: 'Riot Bot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      ...windowWebPreferences
    }
  })
  window.once('ready-to-show', () => window?.show())
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window?.hide()
  })
  window.on('closed', () => { window = null })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowedNavigation(url)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  if (devUrl) await window.loadURL(devUrl)
  else await window.loadURL('app://local/index.html')
}

app.whenReady().then(async () => {
  app.setAppUserModelId(app.isPackaged ? 'app.riotbot.desktop' : process.execPath)
  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(userData, 'playwright-browsers')
  const logger = fileLogger(path.join(userData, 'riot-bot.log'))
  const credentials = await ElectronCredentialStore.open(userData)
  const providerFetch: typeof fetch = (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)
  riot = new RiotService({
    dbPath: path.join(userData, 'riot-bot.sqlite'),
    provider: new MockProvider(),
    credentials,
    catalogFetchImpl: providerFetch,
    logger,
    openFolder: (folder) => {
      void shell.openPath(folder)
    },
    revealFile: (file) => shell.showItemInFolder(file),
    writeClipboard: (text) => {
      clipboard.writeText(text)
    },
    openLink: (url) => {
      void shell.openExternal(url)
    },
    createProvider: (settings) => {
      if (settings.provider === 'codex') throw new ConfigError('Codex uses its native connection. It cannot use an API key.')
      const key = credentials.get(settings.provider)
      if (!key) {
        throw new ConfigError('Add your API key in Settings. A ChatGPT or Cursor subscription does not provide this key.')
      }
      return createOpenAICompatibleProvider({ name: settings.provider, apiKey: key, fetchImpl: providerFetch })
    }
  })
  riot.boot()
  createTray()
  const notifiedJobs = new Set<string>()
  riot.onEvent((event) => {
    if (event.type === 'reminder-fired' && !quitting) {
      const reminder = event.schedule
      if (!Notification.isSupported()) riot?.noteReminderDelivery(reminder.id, 'Desktop notifications are unavailable. This reminder is saved in Schedule.')
      else {
        const notification = new Notification({ title: reminder.title, body: reminder.instructions, timeoutType: 'never' })
        reminderNotifications.add(notification)
        notification.once('close', () => reminderNotifications.delete(notification))
        notification.once('failed', () => { reminderNotifications.delete(notification); riot?.noteReminderDelivery(reminder.id, 'Windows could not show this notification. The reminder is saved in Schedule.') })
        notification.once('click', () => { showWindow(); window?.webContents.send('app:event', { type: 'open-schedule', botId: reminder.botId }) })
        notification.show()
      }
    }
    if (event.type === 'jobs-changed' && riot) {
      const jobs = riot.listJobs('app')
      const running = jobs.filter((job) => job.status === 'running')
      tray?.setToolTip(`Riot Bot · ${running.length ? `${running.length} working` : 'Ready'}`)
      for (const job of jobs) {
        const state = job.awaitingApproval ? 'approval' : job.status
        const key = `${job.id}:${job.attempt}:${state}`
        if (notifiedJobs.has(key) || !['approval', 'completed', 'failed', 'paused'].includes(state)) continue
        notifiedJobs.add(key)
        if (window?.isVisible() || quitting || !Notification.isSupported()) continue
        const notification = new Notification({ title: 'Riot Bot', body: state === 'approval' ? 'A bot needs your approval. Open Riot Bot to review it.' : state === 'completed' ? 'A job finished. Open Riot Bot to see the result.' : 'A job needs attention. Open Riot Bot to review it.' })
        notification.on('click', showWindow)
        notification.show()
      }
    }
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

app.on('second-instance', showWindow)
app.on('activate', showWindow)

app.on('before-quit', (event) => {
  if (!riot || quitReady) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  tray?.destroy()
  tray = null
  void riot.close().catch(() => console.error('Riot Bot could not finish shutdown cleanly. Unfinished jobs will need review on restart.')).finally(() => { quitReady = true;app.quit() })
})

app.on('window-all-closed', () => { /* The tray owns the desktop service until explicit Quit. */ })
