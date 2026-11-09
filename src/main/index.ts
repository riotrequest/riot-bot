import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, net, protocol, screen, session, shell, Tray, type IpcMainEvent } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { NsisUpdater } from 'electron-updater'
import { dismissNotice, mainWindowIsFocused, noticePopupBounds, noticesMaySurface, pushNotice, reconcileAttention, reminderNotice, seedAttention, type MainWindowPresence } from '../core/notices'
import { RiotService } from '../core/service'
import type { AppNotice } from '../shared/types'
import { ConfigError } from '../core/errors'
import type { Logger } from '../core/logger'
import { createOpenAICompatibleProvider, MockProvider } from '../core/provider'
import { createCustomEndpointProvider } from '../core/custom-endpoint'
import { ElectronCredentialStore } from './credentials'
import { registerIpc, type IpcGate } from './ipc'
import { contentSecurityPolicy, windowWebPreferences } from './security'
import { shutDown } from './shutdown'
import { AppUpdates, verifyWindowsPublisher } from './updates'

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
let ipc: IpcGate | null = null
let tray: Tray | null = null
let quitting = false
let quitReady = false
let installAfterShutdown: (() => void) | null = null
let windowShown = false
let popup: BrowserWindow | null = null
let popupReady = false
let popupContentHeight = 150
let notices: AppNotice[] = []

const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL

function showWindow(): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function listNotices(): AppNotice[] {
  return notices.map((item) => ({ ...item }))
}

function mainPresence(): MainWindowPresence | null {
  if (!window || window.isDestroyed()) return null
  return { destroyed: false, visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused() }
}

function shouldFloat(): boolean {
  return noticesMaySurface({ windowShown, quitting, focused: mainWindowIsFocused(mainPresence()), count: notices.length })
}

function placePopup(height = popupContentHeight): void {
  if (!popup || popup.isDestroyed()) return
  if (Number.isFinite(height)) popupContentHeight = height
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const bounds = noticePopupBounds(area, popupContentHeight)
  popup.setBounds(bounds)
  if (popup.isVisible()) popup.setBounds(bounds)
}

function revealPopup(): void {
  if (!popup || popup.isDestroyed() || !popupReady || !shouldFloat()) return
  placePopup()
  if (!popup.isVisible()) popup.showInactive()
  placePopup()
}

function syncPopup(): void {
  if (!shouldFloat()) {
    if (popup && !popup.isDestroyed() && popup.isVisible()) popup.hide()
    return
  }
  void ensurePopup().then(() => revealPopup()).catch(() => { /* a later notice or job event asks again */ })
}

function publishNotices(): void {
  const current = listNotices()
  if (window && !window.isDestroyed()) window.webContents.send('app:event', { type: 'notices-changed', notices: current })
  if (popup && !popup.isDestroyed() && popupReady) popup.webContents.send('notices:update', current)
  syncPopup()
}

function fromPopup(event: IpcMainEvent): boolean {
  const frame = event.senderFrame
  return Boolean(popup && !popup.isDestroyed() && event.sender === popup.webContents && frame === popup.webContents.mainFrame && frame && allowedNavigation(frame.url))
}

async function ensurePopup(): Promise<void> {
  if (!shouldFloat()) return
  const existing = Boolean(popup && !popup.isDestroyed())
  if (!existing) {
    popupReady = false
    const host = new BrowserWindow({
      width: 360,
      height: 150,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      thickFrame: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/notices.js'),
        ...windowWebPreferences,
        backgroundThrottling: false
      }
    })
    popup = host
    host.setAlwaysOnTop(true, 'floating')
    host.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    host.webContents.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) event.preventDefault() })
    host.webContents.on('will-attach-webview', (event) => event.preventDefault())
    host.on('closed', () => { if (popup === host) { popup = null; popupReady = false } })
    host.webContents.on('did-finish-load', () => {
      if (popup !== host) return
      popupReady = true
      host.webContents.send('notices:update', listNotices())
      const fallback = setTimeout(() => { if (popup === host) revealPopup() }, 400)
      host.once('closed', () => clearTimeout(fallback))
    })
    host.once('ready-to-show', () => { if (popup === host && popupReady) revealPopup() })
    const url = devUrl ? `${devUrl}${devUrl.includes('?') ? '&' : '?'}notices=1` : 'app://local/index.html?notices=1'
    try { await host.loadURL(url) } catch { if (popup === host) host.destroy() }
    return
  }
  revealPopup()
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
  try{return devUrl ? new URL(url).origin===new URL(devUrl).origin : new URL(url).protocol==='app:'&&new URL(url).host==='local'}catch{return false}
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
  window.once('ready-to-show', () => { windowShown = true; window?.show(); syncPopup() })
  window.on('show', syncPopup)
  window.on('hide', syncPopup)
  window.on('minimize', syncPopup)
  window.on('restore', syncPopup)
  window.on('focus', syncPopup)
  window.on('blur', syncPopup)
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
  const updater = process.platform === 'win32' && app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))
    ? new NsisUpdater()
    : null
  const updates = new AppUpdates(app.getVersion(), updater, (update) => {
    if (window && !window.isDestroyed()) window.webContents.send('app:event', { type: 'update-state', update })
  }, verifyWindowsPublisher, (install) => {
    if (quitting || !riot || riot.hasUpdateBlockingWork()) {
      throw new ConfigError('Finish or pause pending work before restarting to update.')
    }
    installAfterShutdown = install
    app.quit()
  })
  if (updater) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    updater.verifyUpdateCodeSignature = async (_publisher, installer) =>
      await verifyWindowsPublisher(installer) ? null : 'Windows could not verify the update’s publisher signature.'
    updater.on('download-progress', ({ percent }) => updates.progress(percent))
    updater.on('error', (error) => logger.error('Riot Bot updater error.', { name: error.name }))
  }
  const credentials = await ElectronCredentialStore.open(userData)
  const providerFetch: typeof fetch = (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)
  riot = new RiotService({
    dbPath: path.join(userData, 'riot-bot.sqlite'),
    provider: new MockProvider(),
    credentials,
    catalogFetchImpl: providerFetch,
    gmailFetchImpl: providerFetch,
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
    createProvider: (settings, connection) => {
      if (settings.provider === 'codex') throw new ConfigError('Codex uses its native connection. It cannot use an API key.')
      // The custom endpoint never uses providerFetch: its own transport pins the checked addresses and refuses redirects.
      if (settings.provider === 'custom') return createCustomEndpointProvider({ baseUrl: connection.customBaseUrl, apiKey: credentials.get('custom') })
      const key = credentials.get(settings.provider)
      if (!key) {
        throw new ConfigError('Add your API key in Settings. A ChatGPT or Cursor subscription does not provide this key.')
      }
      return createOpenAICompatibleProvider({ name: settings.provider, apiKey: key, fetchImpl: providerFetch })
    }
  })
  riot.boot()
  createTray()
  // Jobs from earlier sessions are not new events; only later changes raise a card.
  let notifiedJobs = seedAttention(riot.listJobs('app'))
  ipcMain.on('notices:dismiss', (event, id: unknown) => {
    if (!fromPopup(event) || typeof id !== 'string') return
    notices = dismissNotice(notices, id)
    publishNotices()
  })
  ipcMain.on('notices:open', (event, id: unknown) => {
    if (!fromPopup(event) || typeof id !== 'string') return
    const notice = notices.find((item) => item.id === id)
    if (!notice) return
    notices = dismissNotice(notices, id)
    showWindow()
    if (window && !window.isDestroyed()) window.webContents.send('app:event', notice.kind === 'reminder' ? { type: 'open-schedule', botId: notice.botId } : { type: 'open-jobs', botId: notice.botId })
    publishNotices()
  })
  ipcMain.on('notices:resize', (event, height: unknown) => {
    if (!fromPopup(event) || typeof height !== 'number') return
    placePopup(height)
    revealPopup()
  })
  riot.onEvent((event) => {
    if (event.type === 'reminder-fired' && !quitting) {
      notices = pushNotice(notices, reminderNotice(event.schedule))
      publishNotices()
    }
    // Shutdown pauses queued jobs. That needs no tray text or notice, and the database is about to close.
    if (event.type === 'jobs-changed' && riot && !quitting) {
      const jobs = riot.listJobs('app')
      const running = jobs.filter((job) => job.status === 'running')
      tray?.setToolTip(`Riot Bot · ${running.length ? `${running.length} working` : 'Ready'}`)
      const result = reconcileAttention(notices, jobs, notifiedJobs, !quitting && !mainWindowIsFocused(mainPresence()))
      notifiedJobs = result.notified
      if (result.changed) {
        notices = result.notices
        publishNotices()
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
  ipc = registerIpc(
    () => {
      if (!riot) throw new Error('Riot Bot is still starting.')
      return riot
    },
    () => window,
    credentials,
    {
      list: listNotices,
      dismiss: (id) => {
        notices = dismissNotice(notices, id)
        publishNotices()
        return listNotices()
      }
    },
    updates
  )
  await createWindow()
  void updates.check()
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
  popup?.destroy()
  popup = null
  tray?.destroy()
  tray = null
  void shutDown({ ipc, window, service: riot, install: installAfterShutdown }).catch(() => {
    console.error('Riot Bot could not finish shutdown cleanly. Unfinished jobs will need review on restart.')
  }).finally(() => {
    quitReady = true
    setImmediate(() => app.quit())
  })
})

app.on('window-all-closed', () => { /* The tray owns the desktop service until explicit Quit. */ })
