import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { workspaceInventory } from '../src/core/artifacts'
import { editTextFile, readTextFile,searchFiles, undoFileEdit, writeTextFile } from '../src/core/files'
import { openWorkspaceFile, PathEscapeError, requireFileAccess, resolveWorkspacePath } from '../src/core/path-safety'
import { previewAsset } from '../src/core/website-check'

/** A disposable workspace beside an "outside" folder on the same NTFS volume, so real hard links work. */
function linkedWorkspace(): { workspace: string; outside: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-hardlink-'))
  const workspace = path.join(root, 'workspace')
  const outside = path.join(root, 'outside')
  fs.mkdirSync(workspace)
  fs.mkdirSync(outside)
  return { workspace, outside }
}

describe('hard links into the workspace', () => {
  it('does not read an outside file through a hard link', () => {
    const { workspace, outside } = linkedWorkspace()
    fs.writeFileSync(path.join(outside, 'diary.txt'), 'outside-only-text')
    fs.linkSync(path.join(outside, 'diary.txt'), path.join(workspace, 'notes.txt'))
    expect(fs.statSync(path.join(workspace, 'notes.txt')).nlink).toBe(2)

    expect(() => resolveWorkspacePath(workspace, 'notes.txt')).toThrow(PathEscapeError)
    expect(() => readTextFile(workspace, 'notes.txt', 1000)).toThrow(/hard link/)
    expect(searchFiles(workspace, 'outside-only')).toMatch(/No matches/)
    expect(previewAsset(workspace, 'https://riot-preview.invalid/notes.txt').status).toBe(404)
    expect(workspaceInventory(workspace).has('notes.txt')).toBe(false)
  })

  it('does not serve an outside file to the website preview under a page name', () => {
    const { workspace, outside } = linkedWorkspace()
    fs.writeFileSync(path.join(outside, 'private.html'), '<p>outside-only-page</p>')
    fs.linkSync(path.join(outside, 'private.html'), path.join(workspace, 'index.html'))
    const served = previewAsset(workspace, 'https://riot-preview.invalid/index.html')
    expect(served.status).toBe(404)
    expect(String(served.body)).not.toContain('outside-only-page')
  })

  it('does not write, append, edit or undo through a hard link to an outside file', () => {
    const { workspace, outside } = linkedWorkspace()
    const target = path.join(outside, 'config.txt')
    fs.writeFileSync(target, 'outside-original')
    fs.linkSync(target, path.join(workspace, 'config.txt'))

    expect(() => writeTextFile(workspace, 'config.txt', 'replaced', true)).toThrow(/hard link/)
    expect(() => writeTextFile(workspace, 'config.txt', '-appended', true, true)).toThrow(/hard link/)
    expect(editTextFile(workspace, 'config.txt', 'outside-original', 'edited', true)).toEqual({ error: expect.stringMatching(/hard link/) })
    expect(fs.readFileSync(target, 'utf8')).toBe('outside-original')

    // An edit made to an ordinary workspace file cannot be undone into a hard link swapped in later.
    const made = writeTextFile(workspace, 'draft.txt', 'after-edit', true)
    expect('error' in made).toBe(false)
    if ('error' in made) return
    const victim = path.join(outside, 'victim.txt')
    fs.writeFileSync(victim, 'after-edit')
    fs.unlinkSync(path.join(workspace, 'draft.txt'))
    fs.linkSync(victim, path.join(workspace, 'draft.txt'))
    expect(undoFileEdit(workspace, { ...made, beforeText: 'overwritten-by-undo', createdFile: false })).toEqual({ ok: false, message: expect.stringMatching(/hard link/) })
    expect(fs.readFileSync(victim, 'utf8')).toBe('after-edit')
    expect(undoFileEdit(workspace, made)).toEqual({ ok: false, message: expect.stringMatching(/hard link/) })
    expect(fs.existsSync(victim)).toBe(true)
  })

  it('does not expose a credential file under an innocent name, even with the workspace secrets grant', () => {
    const { workspace, outside } = linkedWorkspace()
    fs.writeFileSync(path.join(outside, '.env'), 'API_KEY=fixture-only-secret')
    fs.linkSync(path.join(outside, '.env'), path.join(workspace, 'readme.txt'))

    expect(() => requireFileAccess(workspace, 'readme.txt')).toThrow(/hard link/)
    expect(() => readTextFile(workspace, 'readme.txt', 1000)).toThrow(/hard link/)
    expect(() => readTextFile(workspace, 'readme.txt', 1000, true)).toThrow(/hard link/)
    expect(searchFiles(workspace, 'fixture-only-secret')).toMatch(/No matches/)
    expect(searchFiles(workspace, 'fixture-only-secret', '.', true)).toMatch(/No matches/)
    expect(() => writeTextFile(workspace, 'readme.txt', 'API_KEY=changed', true, false, true)).toThrow(/hard link/)
    expect(fs.readFileSync(path.join(outside, '.env'), 'utf8')).toBe('API_KEY=fixture-only-secret')
  })

  it('checks the opened handle, so a hard link swapped in after path checks is still refused', () => {
    const { workspace, outside } = linkedWorkspace()
    fs.writeFileSync(path.join(workspace, 'notes.txt'), 'ordinary')
    const resolved = resolveWorkspacePath(workspace, 'notes.txt')
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside-only-text')
    fs.unlinkSync(resolved)
    fs.linkSync(path.join(outside, 'secret.txt'), resolved)
    expect(() => openWorkspaceFile(resolved, 'r')).toThrow(PathEscapeError)
  })

  it('keeps working on an ordinary file once its other name is gone', () => {
    const { workspace, outside } = linkedWorkspace()
    fs.writeFileSync(path.join(workspace, 'notes.txt'), 'shared')
    fs.linkSync(path.join(workspace, 'notes.txt'), path.join(outside, 'copy.txt'))
    expect(() => readTextFile(workspace, 'notes.txt', 1000)).toThrow(/hard link/)
    fs.unlinkSync(path.join(outside, 'copy.txt'))
    expect(readTextFile(workspace, 'notes.txt', 1000)).toBe('shared')
    const changed = writeTextFile(workspace, 'notes.txt', 'mine', true)
    expect('error' in changed).toBe(false)
    if (!('error' in changed)) expect(undoFileEdit(workspace, changed)).toEqual({ ok: true })
    expect(fs.readFileSync(path.join(workspace, 'notes.txt'), 'utf8')).toBe('shared')
  })
})

describe('workspace paths', () => {
  it('keeps credential files out of normal reads and searches while supporting a saved workspace grant',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'riot-private-files-'))
    fs.writeFileSync(path.join(root,'.env'),'PASSWORD=fixture-only-secret')
    fs.writeFileSync(path.join(root,'notes.txt'),'ordinary text')
    expect(()=>readTextFile(root,'.env',1000)).toThrow(/Allow project secrets/)
    expect(searchFiles(root,'fixture-only-secret')).toMatch(/No matches/)
    expect(readTextFile(root,'.env',1000,true)).toBe('PASSWORD=fixture-only-secret')
    const changed=writeTextFile(root,'.env','PASSWORD=new-fixture',true,false,true)
    expect('error' in changed).toBe(false)
    if(!('error' in changed))expect(undoFileEdit(root,changed)).toEqual({ok:true})
    expect(readTextFile(root,'.env',1000,true)).toBe('PASSWORD=fixture-only-secret')
  })
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
