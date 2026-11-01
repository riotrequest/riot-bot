import fs from 'fs'
import os from 'os'
import path from 'path'
import { folderSlug } from './slug'

const MAX_PATH = 240

export function defaultWorkspaceRoot(home = os.homedir()): string {
  return path.join(home, 'RiotBot', 'workspaces')
}

export interface AllocatedWorkspace {
  workspacePath: string
  created: boolean
}

/** Create a new empty folder under the workspace root. Never overwrites an existing folder or file. */
export function allocateWorkspace(root: string, label: string): AllocatedWorkspace {
  const base = path.resolve(root)
  if (base.length > 180) throw new Error('The workspace folder location is too long.')
  fs.mkdirSync(base, { recursive: true })
  const slug = folderSlug(label)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt.toString(36)}`
    const folder = path.join(base, `${slug}${suffix}`)
    if (folder.length > MAX_PATH) throw new Error('That workspace path is too long for Windows.')
    if (!inside(base, folder)) throw new Error('The workspace path left its folder.')
    try {
      fs.mkdirSync(folder)
      return { workspacePath: folder, created: true }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error('Could not find a free folder name for this bot.')
}

/** Use a folder the user already chose. Do not create, rename, or move anything inside it. */
export function useExistingWorkspace(folder: string): string {
  if (!folder.trim()) throw new Error('Choose a workspace folder.')
  if (folder.includes('\0')) throw new Error('That path is not valid.')
  if (!path.isAbsolute(folder)) throw new Error('Choose a full folder path.')
  if (folder.length > MAX_PATH) throw new Error('That workspace path is too long for Windows.')
  let real: string
  try {
    const stat = fs.statSync(folder)
    if (!stat.isDirectory()) throw new Error('The workspace must be a folder.')
    real = fs.realpathSync(folder)
  } catch (error) {
    if (error instanceof Error && /must be a folder|not valid|too long|full folder/.test(error.message)) throw error
    throw new Error('That workspace folder could not be opened.')
  }
  if (real.length > MAX_PATH) throw new Error('That workspace path is too long for Windows.')
  return real
}

export function removeEmptyFolder(folder: string): void {
  try {
    const entries = fs.readdirSync(folder)
    if (entries.length === 0) fs.rmdirSync(folder)
  } catch {
    /* the folder may already be gone */
  }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  if (relative === '') return true
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}
