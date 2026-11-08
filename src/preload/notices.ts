import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppNotice, NoticeBridge } from '../shared/types'

try {
  document.documentElement.classList.add('notice-host')
  const markNoticeHost = (): void => { document.body?.classList.add('notice-host') }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markNoticeHost)
  else markNoticeHost()
} catch { /* The notice page adds this class again when it renders. */ }

const api: NoticeBridge = {
  onChange: (handler) => {
    const listener = (_event: IpcRendererEvent, notices: AppNotice[]): void => handler(notices)
    ipcRenderer.on('notices:update', listener)
    return () => ipcRenderer.removeListener('notices:update', listener)
  },
  dismiss: (id) => { ipcRenderer.send('notices:dismiss', id) },
  open: (id) => { ipcRenderer.send('notices:open', id) },
  resize: (height) => { ipcRenderer.send('notices:resize', height) }
}

contextBridge.exposeInMainWorld('riotNotices', api)
