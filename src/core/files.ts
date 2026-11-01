import fs from 'fs'
import path from 'path'
import { inside, PathEscapeError, resolveWorkspacePath } from './path-safety'

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

export function searchFiles(workspace: string, query: string, requested = '.'): string {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return 'Use at least 2 characters to search files.'
  const root = fs.realpathSync(workspace)
  const start = resolveWorkspacePath(workspace, requested)
  const matches: string[] = []
  let scanned = 0

  const walk = (dir: string): void => {
    if (matches.length >= 40 || scanned >= 2000) return
    let real: string
    try {
      real = fs.realpathSync(dir)
    } catch {
      return
    }
    if (!inside(root, real)) return
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
      const full = path.join(real, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      scanned += 1
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (!inside(root, full) || stat.size > 1_000_000) continue
      let content: string
      try {
        content = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      if (content.includes('\0')) continue
      if (!content.toLowerCase().includes(needle)) continue
      const line = content.split(/\r?\n/).findIndex((item) => item.toLowerCase().includes(needle)) + 1
      matches.push(`${path.relative(root, full)}:${line}`)
    }
  }

  walk(start)
  if (matches.length === 0) return scanned >= 2000 ? 'No matches in the first 2000 text files.' : 'No matches in text files.'
  return matches.join('\n')
}

export function readTextFile(workspace: string, requested: string, maxBytes: number): string {
  const full = resolveWorkspacePath(workspace, requested)
  const stat = fs.statSync(full)
  if (!stat.isFile()) throw new Error('That path is not a file.')
  if (stat.size > maxBytes) throw new Error(`The file is ${stat.size} bytes, above the ${maxBytes} byte read limit.`)
  const buffer = fs.readFileSync(full)
  if (buffer.subarray(0, 8000).includes(0)) throw new Error('That file looks binary, so it was not read as text.')
  return buffer.toString('utf8')
}

export function writeTextFile(workspace: string, requested: string, content: string, editing: boolean): FileChange | { error: string } {
  if (!editing) {
    return { error: 'File editing is off. Turn it on in Settings before Riot Bot creates or changes files.' }
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) return { error: 'That file is above the 1 MB write limit.' }
  const full = resolveWorkspacePath(workspace, requested)
  const exists = fs.existsSync(full)
  let before: string | null = null
  if (exists) {
    const stat = fs.lstatSync(full)
    if (stat.isSymbolicLink()) {
      const real = fs.realpathSync(full)
      const root = fs.realpathSync(workspace)
      if (!inside(root, real)) {
        return { error: 'That path leaves the workspace through a shortcut, symlink, or junction.' }
      }
    }
    const fileStat = fs.statSync(full)
    if (!fileStat.isFile()) return { error: 'That path is not a file.' }
    if (fileStat.size > MAX_WRITE_BYTES) return { error: 'The existing file is too large to replace safely.' }
    const bytes = fs.readFileSync(full)
    before = bytes.toString('utf8')
    if (bytes.includes(0) || !Buffer.from(before, 'utf8').equals(bytes)) {
      return { error: 'The existing file is binary or is not UTF-8 text, so it was not replaced.' }
    }
  } else if (!fs.existsSync(path.dirname(full)) || !fs.statSync(path.dirname(full)).isDirectory()) {
    return { error: 'The folder for that file does not exist yet.' }
  }
  fs.writeFileSync(full, content, 'utf8')
  return { path: full, beforeText: before, afterText: content, createdFile: !exists, diff: previewDiff(full, before ?? '', content) }
}

export function editTextFile(
  workspace: string,
  requested: string,
  oldText: string,
  newText: string,
  editing: boolean
): FileChange | { error: string } {
  if (!editing) return { error: 'File editing is off. Turn it on in Settings before Riot Bot creates or changes files.' }
  if (!oldText) return { error: 'The edit needs the exact text to replace.' }
  let current: string
  try {
    current = readTextFile(workspace, requested, MAX_WRITE_BYTES)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The file could not be read.' }
  }
  const hits = current.split(oldText).length - 1
  if (hits === 0) return { error: 'That text was not found in the file.' }
  if (hits > 1) return { error: 'That text appears more than once. Include more surrounding lines so the edit matches one place.' }
  const next = current.replace(oldText, newText)
  return writeTextFile(workspace, requested, next, true)
}

export function undoFileEdit(workspace: string, edit: { path: string; beforeText: string | null; afterText: string; createdFile: boolean }): { ok: true } | { ok: false; message: string } {
  let full: string
  try {
    full = resolveWorkspacePath(workspace, edit.path)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The edited path is no longer in the workspace.' }
  }
  if (!fs.existsSync(full)) return { ok: false, message: 'The file is no longer there, so it was not undone.' }
  const current = fs.readFileSync(full)
  if (!current.equals(Buffer.from(edit.afterText, 'utf8'))) {
    return { ok: false, message: 'The file changed after this edit, so Riot Bot did not undo it.' }
  }
  if (edit.createdFile) fs.unlinkSync(full)
  else fs.writeFileSync(full, edit.beforeText ?? '', 'utf8')
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
