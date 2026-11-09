import type { BrowserWindow } from 'electron'

export interface ShutdownParts {
  /** Refuses renderer requests from now on, before they reach the service. */
  ipc: { close(): void } | null
  window: Pick<BrowserWindow, 'isDestroyed' | 'destroy'> | null
  /** Pauses queued jobs, waits for running ones and closes SQLite last. */
  service: { close(): Promise<void> }
  /** A verified update installer waiting for a clean shutdown. */
  install?: (() => void) | null
}

/**
 * Quits in a fixed order. The window refreshes jobs and the snapshot whenever jobs change, and
 * shutting the service down changes jobs, so the window and its requests go first. Otherwise a
 * refresh can arrive after SQLite has closed. The update installer runs only after the service
 * closed cleanly.
 */
export async function shutDown(parts: ShutdownParts): Promise<void> {
  parts.ipc?.close()
  if (parts.window && !parts.window.isDestroyed()) parts.window.destroy()
  await parts.service.close()
  parts.install?.()
}
