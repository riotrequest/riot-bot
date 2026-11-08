import { spawn, spawnSync, type ChildProcess } from 'child_process'

export interface TerminalResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  cancelled: boolean
  truncated: boolean
  note: string
}

export interface TerminalRunInput {
  /** The shell command line, or a readable description when `direct` is set. */
  command: string
  /** Runs this program with these arguments without a shell, so no argument is reinterpreted. */
  direct?: { program: string; args: string[] }
  cwd: string
  timeoutMs: number
  maxOutputChars: number
  signal: AbortSignal
}

export interface TerminalRunner {
  run(input: TerminalRunInput): Promise<TerminalResult>
  stop(): { ok: boolean; detail: string }
}

export class OsTerminal implements TerminalRunner {
  private active: ChildProcess | null = null
  private killNote = ''

  async run(input: TerminalRunInput): Promise<TerminalResult> {
    if (input.signal.aborted) {
      return { stdout: '', stderr: '', exitCode: null, timedOut: false, cancelled: true, truncated: false, note: 'Stopped before the command started.' }
    }
    const shell = process.platform === 'win32' ? process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh'
    const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', input.command] : ['-c', input.command]
    const child = spawn(input.direct?.program ?? shell, input.direct?.args ?? shellArgs, {
      cwd: input.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.active = child
    let stdout = ''
    let stderr = ''
    let truncated = false
    const take = (chunk: Buffer, target: 'out' | 'err'): void => {
      const text = chunk.toString('utf8')
      if (target === 'out') stdout += text
      else stderr += text
      if (stdout.length + stderr.length > input.maxOutputChars) {
        truncated = true
        stdout = stdout.slice(0, input.maxOutputChars)
        stderr = stderr.slice(0, Math.max(0, input.maxOutputChars - stdout.length))
        this.stop()
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => take(chunk, 'out'))
    child.stderr?.on('data', (chunk: Buffer) => take(chunk, 'err'))

    let timedOut = false
    let cancelled = false
    const timer = setTimeout(() => {
      timedOut = true
      this.stop()
    }, input.timeoutMs)
    const onAbort = (): void => {
      cancelled = true
      this.stop()
    }
    input.signal.addEventListener('abort', onAbort)
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once('close', (code) => resolve(code))
      child.once('error', () => resolve(null))
    })
    clearTimeout(timer)
    input.signal.removeEventListener('abort', onAbort)
    if (this.active === child) this.active = null
    const note = [timedOut ? 'The command reached its time limit and was stopped.' : '', cancelled ? 'Stop ended the command.' : '', truncated ? 'Output was cut at the size limit.' : '', this.killNote]
      .filter(Boolean)
      .join(' ')
    this.killNote = ''
    return { stdout, stderr, exitCode, timedOut, cancelled, truncated, note }
  }

  stop(): { ok: boolean; detail: string } {
    const child = this.active
    if (!child?.pid) return { ok: true, detail: 'No command was running.' }
    if (process.platform === 'win32') {
      const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' })
      if (killed.status !== 0) {
        const detail = `Stop could not confirm the process tree ended: ${(killed.stderr || killed.stdout || 'taskkill failed').trim()}`
        this.killNote = detail
        try {
          child.kill()
        } catch {
          /* already exiting */
        }
        return { ok: false, detail }
      }
      const detail = 'Stop asked Windows to end the command and programs it started.'
      this.killNote = detail
      return { ok: true, detail }
    }
    try {
      process.kill(-child.pid, 'SIGTERM')
      const detail = 'Stop signalled the command group. A process that left the group may still be running.'
      this.killNote = detail
      return { ok: true, detail }
    } catch {
      try {
        child.kill('SIGTERM')
        const detail = 'Stop signalled the shell only. Child programs may still be running if they left this process.'
        this.killNote = detail
        return { ok: false, detail }
      } catch (error) {
        const detail = `Stop could not signal the command: ${error instanceof Error ? error.message : 'unknown error'}`
        this.killNote = detail
        return { ok: false, detail }
      }
    }
  }
}
