import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { editTextFile, searchFiles, undoFileEdit, writeTextFile } from '../src/core/files'
import { PathEscapeError, resolveWorkspacePath } from '../src/core/path-safety'

describe('workspace paths', () => {
  it('rejects traversal and junction escapes, and can undo an edit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-ws-'))
    const workspace = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    fs.mkdirSync(workspace)
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside-secret')
    fs.writeFileSync(path.join(workspace, 'notes.txt'), 'alpha')

    expect(() => resolveWorkspacePath(workspace, '../outside/secret.txt')).toThrow(PathEscapeError)
    expect(() => resolveWorkspacePath(workspace, path.join(outside, 'secret.txt'))).toThrow(PathEscapeError)

    const junction = path.join(workspace, 'linked')
    execFileSync('cmd.exe', ['/c', 'mklink', '/J', junction, outside], { windowsHide: true })
    expect(() => resolveWorkspacePath(workspace, path.join('linked', 'secret.txt'))).toThrow(PathEscapeError)
    expect(() => writeTextFile(workspace, 'linked/new/file.txt', 'blocked', true)).toThrow(PathEscapeError)
    expect(fs.existsSync(path.join(outside, 'new'))).toBe(false)
    const nested = writeTextFile(workspace, 'assets/css/style.css', 'body { color: gold }', true)
    expect('error' in nested).toBe(false)
    expect(fs.readFileSync(path.join(workspace, 'assets/css/style.css'), 'utf8')).toContain('gold')
    expect(searchFiles(workspace, 'color', 'assets/css/style.css')).toContain('style.css:1: body { color: gold }')
    expect(searchFiles(workspace, 'color', 'assets')).toContain('style.css:1: body { color: gold }')

    try {
      const fileLink = path.join(workspace, 'secret-link.txt')
      fs.symlinkSync(path.join(outside, 'secret.txt'), fileLink, 'file')
      expect(() => resolveWorkspacePath(workspace, 'secret-link.txt')).toThrow(PathEscapeError)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && !(error instanceof PathEscapeError)) throw error
    }

    const created = writeTextFile(workspace, 'notes.txt', 'beta', true)
    expect('error' in created).toBe(false)
    if ('error' in created) return
    expect(fs.readFileSync(path.join(workspace, 'notes.txt'), 'utf8')).toBe('beta')
    expect(created.diff).toContain('-alpha')
    expect(created.diff).toContain('+beta')
    const undone = undoFileEdit(workspace, { ...created, createdFile: false })
    expect(undone.ok).toBe(true)
    expect(fs.readFileSync(path.join(workspace, 'notes.txt'), 'utf8')).toBe('alpha')

    const blocked = writeTextFile(workspace, 'notes.txt', 'gamma', false)
    expect(blocked).toEqual({ error: expect.stringContaining('File editing is off') })
    const edited = editTextFile(workspace, 'notes.txt', 'alpha', 'alpha-2', true)
    expect('error' in edited).toBe(false)
  })
})
