import fs from 'fs'
import path from 'path'
import { inside, openWorkspaceFile, PathEscapeError, requireFileAccess, resolveWorkspacePath,sensitivePath, withWorkspaceFile } from './path-safety'

const MAX_WRITE_BYTES = 1_000_000

export interface FileChange {
  path: string
  beforeText: string | null
  afterText: string
  createdFile: boolean
  diff: string
}

export function listFiles(workspace: string, requested = '.'): string {
  const dir = resolveWorkspacePath(workspace, requested)
  let real = dir
  try {
    real = fs.realpathSync(dir)
  } catch {
    throw new PathEscapeError('That folder could not be opened.')
  }
  const root = fs.realpathSync(workspace)
  if (!inside(root, real)) throw new PathEscapeError('That path leaves the workspace through a shortcut, symlink, or junction.')
  if (!fs.statSync(real).isDirectory()) return 'That path is a file, not a folder.'
  const entries = fs.readdirSync(real, { withFileTypes: true })
  const shown = entries.slice(0, 200)
  if (shown.length === 0) return 'The folder is empty.'
  const lines = shown.map((entry) => {
    const kind = entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'folder' : 'file'
    return `${kind}\t${entry.name}`
  })
  if (entries.length > shown.length) lines.push(`… ${entries.length - shown.length} more not shown`)
  return lines.join('\n')
}

export function searchFiles(workspace: string, query: string, requested = '.',allowSensitive=false): string {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return 'Use at least 2 characters to search files.'
  const root = fs.realpathSync(workspace)
  const start = resolveWorkspacePath(workspace, requested)
  const matches: string[] = []
  let scanned = 0

  const walk = (target: string): void => {
    if (matches.length >= 40 || scanned >= 2000) return
    let real: string
    try {
      real = fs.realpathSync(target)
    } catch {
      return
    }
    if (!inside(root, real)) return
    if(!allowSensitive&&sensitivePath(path.relative(root,real)))return
    const stat = fs.statSync(real)
    if (stat.isFile()) {
      scanned += 1
      if (stat.size > 1_000_000 || stat.nlink > 1) return
      let content: string | null
      try {
        content = withWorkspaceFile(real, 'r', (fd, opened) => opened.isFile() && opened.size <= 1_000_000 ? fs.readFileSync(fd, 'utf8') : null)
      } catch {
        return
      }
      if (content === null || content.includes('\0')) return
      const lines = content.split(/\r?\n/)
      const line = lines.findIndex(item => item.toLowerCase().includes(needle))
      if (line >= 0) matches.push(`${path.relative(root, real)}:${line + 1}: ${lines[line].trim().slice(0, 250)}`)
      return
    }
    if (!stat.isDirectory()) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(real, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (matches.length >= 40 || scanned >= 2000) return
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory() || entry.isFile()) walk(path.join(real, entry.name))
    }
  }

  walk(start)
  if (matches.length === 0) return scanned >= 2000 ? 'No matches in the first 2000 text files.' : 'No matches in text files.'
  return matches.join('\n')
}

export function readTextFile(workspace: string, requested: string, maxBytes: number,allowSensitive=false): string {
  const full = requireFileAccess(workspace, requested,allowSensitive)
  return withWorkspaceFile(full, 'r', (fd, stat) => {
    if (!stat.isFile()) throw new Error('That path is not a file.')
    if (stat.size > maxBytes) throw new Error(`The file is ${stat.size} bytes, above the ${maxBytes} byte read limit.`)
    const buffer = fs.readFileSync(fd)
    if (buffer.subarray(0, 8000).includes(0)) throw new Error('That file looks binary, so it was not read as text.')
    return buffer.toString('utf8')
  })
}

/** Replaces a file's contents through the handle that passed the checks, not by reopening the path. */
function replaceContents(fd: number, content: string): void {
  const bytes = Buffer.from(content, 'utf8')
  fs.ftruncateSync(fd, 0)
  let written = 0
  while (written < bytes.length) written += fs.writeSync(fd, bytes, written, bytes.length - written, written)
}

export function writeTextFile(workspace: string, requested: string, content: string, editing: boolean, append = false,allowSensitive=false): FileChange | { error: string } {
  if (!editing) {
    return { error: 'File editing is off. Turn it on in Settings before Riot Bot creates or changes files.' }
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) return { error: 'That file is above the 1 MB write limit.' }
  const full = requireFileAccess(workspace, requested,allowSensitive)
  const exists = fs.existsSync(full)
  if (append && !exists) return { error: 'Create the file before appending another chunk.' }
  let before: string | null = null
  let fd: number | null = null
  try {
    if (exists) {
      const stat = fs.lstatSync(full)
      if (stat.isSymbolicLink()) {
        const real = fs.realpathSync(full)
        const root = fs.realpathSync(workspace)
        if (!inside(root, real)) {
          return { error: 'That path leaves the workspace through a shortcut, symlink, or junction.' }
        }
      }
      if (!fs.statSync(full).isFile()) return { error: 'That path is not a file.' }
      const opened = openWorkspaceFile(full, 'r+')
      fd = opened.fd
      if (!opened.stat.isFile()) return { error: 'That path is not a file.' }
      if (opened.stat.size > MAX_WRITE_BYTES) return { error: 'The existing file is too large to replace safely.' }
      const bytes = fs.readFileSync(fd)
      before = bytes.toString('utf8')
      if (bytes.includes(0) || !Buffer.from(before, 'utf8').equals(bytes)) {
        return { error: 'The existing file is binary or is not UTF-8 text, so it was not replaced.' }
      }
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true })
      resolveWorkspacePath(workspace, requested)
    }
    if (append) content = (before ?? '') + content
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) return { error: 'The complete file would exceed the 1 MB write limit.' }
    // A new file is created exclusively, so nothing (including a hard link) can be planted at the path first.
    if (fd === null) fd = fs.openSync(full, 'wx')
    replaceContents(fd, content)
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
  return { path: full, beforeText: before, afterText: content, createdFile: !exists, diff: previewDiff(full, before ?? '', content) }
}

export function editTextFile(
  workspace: string,
  requested: string,
  oldText: string,
  newText: string,
  editing: boolean,
  allowSensitive=false
): FileChange | { error: string } {
  if (!editing) return { error: 'File editing is off. Turn it on in Settings before Riot Bot creates or changes files.' }
  if (!oldText) return { error: 'The edit needs the exact text to replace.' }
  let current: string
  try {
    current = readTextFile(workspace, requested, MAX_WRITE_BYTES,allowSensitive)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The file could not be read.' }
  }
  const hits = current.split(oldText).length - 1
  if (hits === 0) return { error: 'That text was not found in the file.' }
  if (hits > 1) return { error: 'That text appears more than once. Include more surrounding lines so the edit matches one place.' }
  const next = current.replace(oldText, newText)
  return writeTextFile(workspace, requested, next, true,false,allowSensitive)
}

export function undoFileEdit(workspace: string, edit: { path: string; beforeText: string | null; afterText: string; createdFile: boolean }): { ok: true } | { ok: false; message: string } {
  let full: string
  try {
    full = resolveWorkspacePath(workspace, edit.path)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The edited path is no longer in the workspace.' }
  }
  if (!fs.existsSync(full)) return { ok: false, message: 'The file is no longer there, so it was not undone.' }
  let opened: { fd: number; stat: fs.Stats }
  try {
    opened = openWorkspaceFile(full, edit.createdFile ? 'r' : 'r+')
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The file could not be opened, so it was not undone.' }
  }
  let open = true
  try {
    if (!opened.stat.isFile()) return { ok: false, message: 'That path is no longer a file, so it was not undone.' }
    const current = fs.readFileSync(opened.fd)
    if (!current.equals(Buffer.from(edit.afterText, 'utf8'))) {
      return { ok: false, message: 'The file changed after this edit, so Riot Bot did not undo it.' }
    }
    if (edit.createdFile) {
      fs.closeSync(opened.fd)
      open = false
      fs.unlinkSync(full)
    } else replaceContents(opened.fd, edit.beforeText ?? '')
  } finally {
    if (open) fs.closeSync(opened.fd)
  }
  return { ok: true }
}

export function previewDiff(filePath: string, before: string, after: string): string {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > 400 || b.length > 400) return `${filePath}\n${a.length} lines -> ${b.length} lines`
  const lcs = buildLcs(a, b)
  const lines = [`--- ${filePath}`, `+++ ${filePath}`]
  let i = 0
  let j = 0
  let k = 0
  while (i < a.length && j < b.length) {
    if (k < lcs.length && a[i] === lcs[k] && b[j] === lcs[k]) {
      lines.push(` ${a[i]}`)
      i += 1
      j += 1
      k += 1
    } else if (k < lcs.length && a[i] !== lcs[k]) {
      lines.push(`-${a[i]}`)
      i += 1
    } else if (k < lcs.length && b[j] !== lcs[k]) {
      lines.push(`+${b[j]}`)
      j += 1
    } else if (i < a.length && (j >= b.length || a[i] !== b[j])) {
      lines.push(`-${a[i]}`)
      i += 1
    } else {
      lines.push(`+${b[j]}`)
      j += 1
    }
  }
  while (i < a.length) lines.push(`-${a[i++]}`)
  while (j < b.length) lines.push(`+${b[j++]}`)
  const text = lines.join('\n')
  return text.length > 8000 ? `${text.slice(0, 8000)}\n… diff truncated` : text
}

function buildLcs(a: string[], b: string[]): string[] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i])
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1
    else j += 1
  }
  return out
}
