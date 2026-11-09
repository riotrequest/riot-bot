import fs from 'fs'
import net from 'net'
import path from 'path'
import type { SavedServerLogin } from '../shared/types'

export interface ServerLoginDraft {
  host: string
  port: number
  username: string
  password: string
}

export interface CapturedServerLogin extends ServerLoginDraft {
  /** The message with the password replaced by {@link SAVED_PASSWORD}. */
  masked: string
}

export const SAVED_PASSWORD = '[saved password]'
const DEFAULT_PORT = 22

const PUTTY = /^(?:putty|plink|pscp|psftp|kitty|klink)(?:\.exe)?$/i
const PUTTY_WINDOW = /^(?:putty|kitty)/i
const SSH = /^(?:ssh|scp|sftp)(?:\.exe)?$/i
const COPY = /^(?:pscp|scp)/i
const PUTTY_VALUES = new Set(['-P', '-l', '-pw', '-pwfile', '-i', '-L', '-R', '-D', '-m', '-nc', '-load', '-hostkey', '-proxycmd', '-sercfg', '-sessionlog', '-sshlog', '-sshrawlog', '-loghost'])
const SSH_VALUES = new Set(['-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-p', '-P', '-Q', '-R', '-S', '-W', '-w', '-B'])
const SSHPASS_VALUES = new Set(['-p', '-P', '-f', '-d'])
const SSH_URL = /\b(?:ssh|sftp):\/\/([^\s:@/]+):([^\s@/]+)@(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?/gi
const USERNAME = /^[a-z0-9._\\][a-z0-9._\\$-]{0,99}$/i
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
const PLACEHOLDER = /^(?:<[^>]*>|\[[^\]]*\]|\{[^}]*\}|\$\{?\w+\}?|%\w+%|\*+)$/

interface Token { value: string; start: number; end: number }
interface Found { host: string; port: number; username: string; password: Token }

/**
 * Finds an SSH login in a command the user pasted into their own message: PuTTY, plink, pscp or psftp
 * with `-pw`, `sshpass -p` in front of ssh, scp or sftp, or an `ssh://user:password@host` address.
 * Quoted lines (`> …`) are skipped. Never call this on reference material such as emails or pages.
 */
export function serverLoginFromMessage(text: string): CapturedServerLogin | null {
  let offset = 0
  for (const line of text.split('\n')) {
    // A quoted line may be someone else's, and a line Riot Bot already masked must not overwrite the saved password.
    const found = /^\s*>/.test(line) || line.includes(SAVED_PASSWORD) ? null : fromCommand(split(line)) ?? fromAddress(line)
    if (found) {
      const start = offset + found.password.start
      return {
        host: found.host,
        port: found.port,
        username: found.username,
        password: found.password.value,
        masked: text.slice(0, start) + SAVED_PASSWORD + text.slice(offset + found.password.end)
      }
    }
    offset += line.length + 1
  }
  return null
}

/** PuTTY's command-line client from a standard install folder or a local folder on PATH. */
export function findPlink(env: NodeJS.ProcessEnv = process.env): string | null {
  const name = process.platform === 'win32' ? 'plink.exe' : 'plink'
  const installs = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]
    .filter((folder): folder is string => Boolean(folder))
    .map((folder) => path.join(folder, 'PuTTY'))
  const searchPath = (env.PATH ?? env.Path ?? '').split(path.delimiter)
  for (const folder of [...installs, ...searchPath]) {
    // A UNC folder would make Windows contact another computer just to look.
    if (!folder || !path.isAbsolute(folder) || folder.startsWith('\\\\')) continue
    const file = path.join(folder, name)
    try { if (fs.statSync(file).isFile()) return file } catch { /* Not here. */ }
  }
  return null
}

/** Where a saved login connects, as shown on the approval card. */
export function serverTarget(login: SavedServerLogin): string {
  return `ssh://${login.username}@${login.host.includes(':') ? `[${login.host}]` : login.host}:${login.port}`
}

/** plink arguments for one command. `-batch` refuses unknown or changed host keys instead of asking. */
export function plinkArgs(login: ServerLoginDraft, command: string): string[] {
  return ['-ssh', '-batch', '-P', String(login.port), '-l', login.username, '-pw', login.password, login.host, command]
}

/** A next step for the user when plink stops before running the command. */
export function plinkHint(output: string): string {
  if (/host key is not cached|not in the cache/i.test(output)) return 'Riot Bot does not accept a new server key on its own. Open this server once in PuTTY, check the key and accept it, then ask again.'
  if (/host key does not match|POTENTIAL SECURITY BREACH/i.test(output)) return 'The server’s key has changed. That happens after a reinstall, but it can also mean someone is intercepting the connection. Check it in PuTTY before trying again.'
  if (/access denied|authentication failed|password.*(?:incorrect|refused)/i.test(output)) return 'The server refused the saved password. Paste the command again with the current password to update it.'
  return ''
}

function fromCommand(tokens: Token[]): Found | null {
  const at = tokens.findIndex((token) => PUTTY.test(program(token)) || program(token).toLowerCase().replace(/\.exe$/, '') === 'sshpass')
  if (at < 0) return null
  const client = program(tokens[at])
  if (PUTTY.test(client)) {
    const options = parseOptions(tokens, at + 1, PUTTY_VALUES, PUTTY_WINDOW.test(client))
    return finish(options, COPY.test(client), options.values.get('-pw'), options.values.get('-P'))
  }
  let password: Token | undefined
  let index = at + 1
  for (; index < tokens.length && tokens[index].value.startsWith('-'); index += 1) {
    const { value, start, end } = tokens[index]
    if (value.startsWith('-p') && value.length > 2) password = { value: value.slice(2), start: start + 2, end }
    else if (SSHPASS_VALUES.has(value)) { if (value === '-p') password = tokens[index + 1]; index += 1 }
  }
  const ssh = tokens[index]
  if (!password || !ssh || !SSH.test(program(ssh))) return null
  const options = parseOptions(tokens, index + 1, SSH_VALUES, false)
  return finish(options, COPY.test(program(ssh)), password, options.values.get(/^scp|^sftp/i.test(program(ssh)) ? '-P' : '-p'))
}

function fromAddress(line: string): Found | null {
  for (const match of line.matchAll(SSH_URL)) {
    const [whole, user, secret, host, port] = match
    const start = match.index + whole.indexOf(`:${secret}@`) + 1
    let password = secret
    try { password = decodeURIComponent(secret) } catch { /* Keep it as written. */ }
    const found = complete(host, user, password, port, { value: password, start, end: start + secret.length })
    if (found) return found
  }
  return null
}

/** Reads options until the first argument, or through every argument for PuTTY's window, which has no command part. */
function parseOptions(tokens: Token[], from: number, takesValue: Set<string>, anywhere: boolean) {
  const values = new Map<string, Token>()
  const positional: string[] = []
  for (let index = from; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.value.length > 1 && token.value.startsWith('-') && (anywhere || !positional.length)) {
      if (takesValue.has(token.value) && tokens[index + 1]) values.set(token.value, tokens[(index += 1)])
      continue
    }
    positional.push(token.value)
  }
  return { values, positional }
}

function finish(options: ReturnType<typeof parseOptions>, copy: boolean, password: Token | undefined, port: Token | undefined): Found | null {
  // Copy commands name the server in a `user@host:path` argument; the others start with the server.
  const target = copy ? options.positional.find((item) => /^[^\\/]+:/.test(item) && !/^[a-z]:/i.test(item)) : options.positional[0]
  const match = target && /^(?:([^@\s]+)@)?(\[[0-9a-f:.]+\]|[^:@\s\\/]+)/i.exec(target)
  if (!match || !password) return null
  return complete(match[2], match[1] ?? options.values.get('-l')?.value, password.value, port?.value, password)
}

function complete(rawHost: string, username: string | undefined, password: string, rawPort: string | undefined, token: Token): Found | null {
  const host = rawHost.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  const port = rawPort === undefined ? DEFAULT_PORT : Number(rawPort)
  const validHost = host.includes(':') ? net.isIPv6(host) : HOSTNAME.test(host)
  if (!validHost || !username || !USERNAME.test(username) || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!password || password.length > 500 || /[\r\n\0]/.test(password) || PLACEHOLDER.test(password) || password === SAVED_PASSWORD) return null
  return { host, port, username, password: { ...token, value: password } }
}

/** Splits a command line like a shell would for plain and quoted words, keeping each word's position. */
function split(line: string): Token[] {
  return [...line.replace(/`/g, ' ').matchAll(/"([^"]*)"|'([^']*)'|[^\s"']+/g)].map((match) => ({
    value: match[1] ?? match[2] ?? match[0],
    start: match.index,
    end: match.index + match[0].length
  }))
}

function program(token: Token): string {
  return path.win32.basename(token.value)
}
