import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BrowserWindow, IpcMainInvokeEvent, MenuItemConstructorOptions, PopupOptions } from 'electron'
import type { RiotService } from '../src/core/service'
import type { ElectronCredentialStore } from '../src/main/credentials'
import type { Bot } from '../src/shared/types'
import { DeleteBotDialog, RenameBotDialog } from '../src/renderer/src/App'

const native = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(),
  template: [] as MenuItemConstructorOptions[],
  popup: null as PopupOptions | null
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => native.handlers.set(name, handler) },
  Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => { native.template = template; return { popup: (options: PopupOptions) => { native.popup = options } } } },
  clipboard: {}, dialog: {}, nativeImage: {}
}))
import { registerIpc } from '../src/main/ipc'

const first = { id: '11111111-1111-4111-8111-111111111111', name: 'Riot', workspacePath: 'C:\\projects\\riot' } as Bot
const second = { id: '22222222-2222-4222-8222-222222222222', name: 'Scout & Co', workspacePath: 'C:\\projects\\scout' } as Bot
let active = first, running: string[] = []
const updateBot = vi.fn(patch => ({ ...active, ...patch }))
const window = { webContents: { getZoomFactor: () => 1.25 }, isDestroyed: () => false, getContentBounds: () => ({ x: 1000, y: 200, width: 880, height: 640 }) } as unknown as BrowserWindow
const event = { sender: window.webContents, senderFrame: { url: 'app://local/index.html' } } as IpcMainInvokeEvent
const invoke = (channel: string, ...args: unknown[]) => native.handlers.get(channel)!(event, ...args)

beforeEach(() => {
  active = first; running = []; updateBot.mockClear(); native.handlers.clear(); native.popup = null; native.template = []
  registerIpc(() => ({ getSnapshot: () => ({ bot: active, bots: [first, second], runningBotIds: running }), updateBot }) as unknown as RiotService, () => window, { secretValues: () => [] } as unknown as ElectronCredentialStore)
})

describe('bot context actions', () => {
  it('targets the clicked bot without changing selection, and resolves a chosen action after menu close', async () => {
    const result = invoke('bots:menu', second.id, { x: 80, y: 140 })
    expect(active.id).toBe(first.id)
    expect(native.template[0].label).toBe('Scout && Co')
    expect(native.popup).toMatchObject({ window, x: 100, y: 175 })
    native.popup!.callback!()
    native.template.find(item => item.label === 'Rename bot…')!.click!({} as never, window, {} as never)
    expect(await result).toBe('rename')
    expect(updateBot).not.toHaveBeenCalled()
  })

  it('dismisses without an action and disables deletion only for the running target', async () => {
    running = [first.id]
    const other = invoke('bots:menu', second.id, { x: 0, y: 0 })
    expect(native.template.find(item => item.label === 'Delete bot…')!.enabled).toBe(true)
    native.popup!.callback!(); expect(await other).toBeNull()
    const busy = invoke('bots:menu', first.id, { x: 0, y: 0 })
    expect(native.template.find(item => item.label?.includes('stop work first'))!.enabled).toBe(false)
    native.popup!.callback!(); expect(await busy).toBeNull()
  })

  it('rejects unknown bots and invalid positions, and keeps menu coordinates within the window', async () => {
    await expect(invoke('bots:menu', '33333333-3333-4333-8333-333333333333', { x: 1, y: 1 })).rejects.toThrow('no longer available')
    await expect(invoke('bots:menu', first.id, { x: Infinity, y: 1 })).rejects.toThrow('position')
    expect(native.popup).toBeNull()
    const result = invoke('bots:menu', first.id, { x: -500, y: 9000 })
    expect(native.popup).toMatchObject({ x: 0, y: 640 })
    native.popup!.callback!(); await result
  })

  it('refuses a stale rename target instead of renaming the currently selected bot', async () => {
    await expect(invoke('bots:rename', second.id, 'New name')).rejects.toThrow('Select this bot again')
    expect(updateBot).not.toHaveBeenCalled()
    active = second
    expect(await invoke('bots:rename', second.id, 'New name')).toMatchObject({ id: second.id, name: 'New name' })
    expect(updateBot).toHaveBeenCalledWith({ name: 'New name' })
  })

  it('rejects menu requests from an unexpected renderer', async () => {
    await expect(native.handlers.get('bots:menu')!({ ...event, sender: {} } as IpcMainInvokeEvent, first.id, { x: 0, y: 0 })).rejects.toThrow('unexpected message')
    expect(native.popup).toBeNull()
  })

  it('shows the exact delete target with one explicit confirmation and keeps Cancel as the default focus', () => {
    const html = renderToStaticMarkup(createElement(DeleteBotDialog, { bot: second, onCancel: () => undefined, onDelete: async () => undefined }))
    expect(html).toContain('Delete Scout &amp; Co?')
    expect(html).toContain('permanently removes')
    expect(html).toContain('Working folder kept:')
    expect(html).toMatch(/<button[^>]*autofocus=""[^>]*>Cancel<\/button>/)
    expect(html).toContain('Delete bot</button>')
    expect(html).not.toContain('<input')
    const rename = renderToStaticMarkup(createElement(RenameBotDialog, { bot: second, onCancel: () => undefined, onRename: async () => undefined }))
    expect(rename).toContain('value="Scout &amp; Co"')
    expect(rename).toContain('Save name')
  })
})
