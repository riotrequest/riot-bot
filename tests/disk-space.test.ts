import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DRIVE_LOOKUP_TIMEOUT_MS,getDiskSpace,localDiskPath,readLocalVolumes,volumeRoots } from '../src/core/disk-space'
import { StopError } from '../src/core/errors'
import { FakeTerminal, makeApp, tempDir } from './helpers'

// Most of these run the real Windows drive lookup; allow it its full time limit.
describe('built-in disk-space check', { timeout: DRIVE_LOOKUP_TIMEOUT_MS + 10_000 }, () => {
  it('rejects UNC, device paths, mapped drives and remote link targets before statfs',async()=>{
    const statfs=vi.spyOn(fs,'statfs')
    try{
      for(const location of ['\\\\collector.invalid\\share\\','//collector.invalid/share','\\\\?\\UNC\\collector.invalid\\share','\\\\.\\UNC\\collector.invalid\\share'])await expect(getDiskSpace(location)).rejects.toThrow(/local|network|device/i)
      await expect(localDiskPath('Z:\\folder','win32',async()=>['C:\\'])).rejects.toThrow(/remote/)
      const link=vi.spyOn(fs,'lstat').mockResolvedValue({isSymbolicLink:()=>true} as never)
      const readlink=vi.spyOn(fs,'readlink').mockResolvedValue('\\\\collector.invalid\\share')
      try{await expect(localDiskPath('C:\\redirect\\folder','win32',async()=>['C:\\'])).rejects.toThrow(/local|network/)}finally{link.mockRestore();readlink.mockRestore()}
      expect(statfs).not.toHaveBeenCalled()
    }finally{statfs.mockRestore()}
  })

  it('reads drive letters only from volume entries in mountvol output', () => {
    // The help text around the volume list is localized; only volume entries count.
    const output = [
      'Creates, deletes, or lists a volume mount point.',
      '    X:\\',
      '',
      'Possible values for VolumeName along with current mount points are:',
      '',
      '    \\\\?\\Volume{0364f2b6-8278-4c58-a717-443574c49c12}\\',
      '        c:\\',
      '        C:\\mnt\\data\\',
      '',
      '    \\\\?\\Volume{84fd1593-c4ac-4826-8297-4f831a8bada4}\\',
      '        *** NO MOUNT POINTS ***',
      '',
      '    \\\\?\\Volume{602bf635-8db4-11f0-944f-50c2e87f015a}\\',
      '        F:\\',
      '        G:\\'
    ].join('\r\n')
    expect(volumeRoots(output)).toEqual(['C:\\', 'F:\\', 'G:\\'])
  })

  it.runIf(process.platform === 'win32')('lists only real local volumes, so a substituted drive letter is refused before statfs', async () => {
    const subst = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'subst.exe')
    const letter = await freeDriveLetter(), dir = tempDir()
    execFileSync(subst, [`${letter}:`, dir], { windowsHide: true })
    const statfs = vi.spyOn(fs, 'statfs')
    try {
      await expect(fs.access(`${letter}:\\`)).resolves.toBeUndefined()
      const roots = await readLocalVolumes()
      expect(roots).toContain(path.parse(path.resolve(dir)).root.toUpperCase())
      expect(roots).not.toContain(`${letter}:\\`)
      await expect(getDiskSpace(`${letter}:\\`)).rejects.toThrow(/remote or unavailable/)
      expect(statfs).not.toHaveBeenCalled()
    } finally {
      statfs.mockRestore()
      execFileSync(subst, [`${letter}:`, '/D'], { windowsHide: true })
    }
  })

  it('reads the actual filesystem capacity and labels the location and units', async () => {
    const location = tempDir(), stats = await fs.statfs(location)
    const result = await getDiskSpace(location)
    expect(result.filesystemContaining).toBe(path.resolve(location))
    expect(result.totalBytes).toBe(stats.blocks * stats.bsize)
    expect(result.totalBytes).toBeGreaterThan(0)
    expect(result.availableBytes).toBeGreaterThanOrEqual(0)
    expect(result.availableBytes).toBeLessThanOrEqual(result.totalBytes)
    expect(result.availableGB).toBe(Number((result.availableBytes / 1e9).toFixed(1)))
    expect(result.scope).toContain('Other drives were not checked')
  })

  it('distinguishes a full disk from missing capacity values and reserved space', async () => {
    const stat = vi.spyOn(fs, 'statfs').mockResolvedValue({ bsize: 1000, blocks: 100, bfree: 0, bavail: 0 } as never)
    try {
      expect(await getDiskSpace(tempDir())).toMatchObject({ totalBytes: 100000, availableBytes: 0, usedBytes: 100000 })
      stat.mockResolvedValue({ bsize: 1000, blocks: 100, bfree: 20, bavail: 10 } as never)
      expect(await getDiskSpace(tempDir())).toMatchObject({ totalBytes: 100000, availableBytes: 10000, usedBytes: 80000 })
      stat.mockResolvedValue({ bsize: 0, blocks: 0, bfree: 0, bavail: 0 } as never)
      await expect(getDiskSpace(tempDir())).rejects.toThrow('did not return reliable disk-space values')
    } finally { stat.mockRestore() }
  })

  it('stops waiting for a slow drive lookup when the run is stopped, and starts none once stopped', async () => {
    const statfs = vi.spyOn(fs, 'statfs')
    try {
      let lookups = 0
      const slow = () => { lookups++; return new Promise<string[]>(() => {}) }
      const controller = new AbortController()
      const pending = getDiskSpace(tempDir(), controller.signal, slow)
      setTimeout(() => controller.abort(), 50)
      const started = Date.now()
      await expect(pending).rejects.toBeInstanceOf(StopError)
      expect(Date.now() - started).toBeLessThan(2000)
      await expect(getDiskSpace(tempDir(), controller.signal, slow)).rejects.toThrow('Stopped. Disk space was not read.')
      expect(lookups).toBe(1)
      expect(statfs).not.toHaveBeenCalled()
    } finally { statfs.mockRestore() }
  })

  it('reports a missing or unavailable location clearly', async () => {
    await expect(getDiskSpace(path.join(tempDir(), 'not-present'))).rejects.toThrow('Check that this drive or folder exists')
  })

  it('lets an API bot check capacity with file editing off and no command approval', async () => {
    const terminal = new FakeTerminal(), { app, provider, dir } = makeApp({ terminal })
    try {
      app.updateSettings({ workspacePath: dir, workspaceEditing: false })
      let approvals = 0
      app.onEvent(event => { if (event.type === 'approval' && event.approval) approvals++ })
      provider.handler = input => {
        expect(input.tools?.some(tool => tool.name === 'get_disk_space')).toBe(true)
        if (input.messages.at(-1)?.role === 'tool') {
          const result = JSON.parse(input.messages.at(-1)!.content)
          expect(result.totalBytes).toBeGreaterThan(0)
          expect(result.filesystemContaining).toBe(dir)
          return { content: `You have ${result.availableGB} GB available on the drive containing your working folder.`, toolCalls: [] }
        }
        return { content: '', toolCalls: [{ id: 'disk-check', name: 'get_disk_space', arguments: '{}' }] }
      }
      const run = await app.sendMessage(app.getSnapshot().current!.conversation.id, 'How much disk space do I have available?')
      expect(run.status).toBe('completed')
      expect(approvals).toBe(0)
      expect(terminal.ran).toHaveLength(0)
    } finally { await app.close() }
  })
})

async function freeDriveLetter(): Promise<string> {
  for (const letter of 'QRSTUVWXY') if (!(await fs.access(`${letter}:\\`).then(() => true, () => false))) return letter
  throw new Error('No free drive letter for the subst test.')
}
