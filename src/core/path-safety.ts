import fs from 'fs'
import path from 'path'

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathEscapeError'
  }
}

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function sensitivePath(requested:string):boolean{
  return requested.split(/[\\/]/).some(part=>/^(?:\.env(?:\..*)?|\.ssh|\.aws|\.codex|credentials?(?:\.(?:json|ini|ya?ml|toml|txt))?|client_secret[^/\\]*\.json|auth\.json|id_(?:rsa|ed25519)(?:\..*)?|cookies|login data|local state)$/i.test(part)||/\.(?:pem|key|p12|pfx)$/i.test(part))
}

export function requireFileAccess(workspace:string,requested:string,allowSensitive=false):string{
  const full=resolveWorkspacePath(workspace,requested)
  if(!allowSensitive&&(sensitivePath(requested)||sensitivePath(path.relative(fs.realpathSync(workspace),full))))throw new Error('This file can contain credentials. Enable “Allow project secrets” once in Bot settings → Files & tools if you want its contents shared with this bot’s AI connection. Saved website logins stay in Riot’s encrypted login store.')
  return full
}

export function resolveWorkspacePath(workspace: string, requested: string): string {
  if (!workspace) throw new PathEscapeError('Choose a workspace folder in Settings first.')
  if (requested.includes('\0')) throw new PathEscapeError('That path is not valid.')
  let root: string
  try {
    root = fs.realpathSync(workspace)
    if (!fs.statSync(root).isDirectory()) throw new PathEscapeError('The workspace is not a folder.')
  } catch (error) {
    if (error instanceof PathEscapeError) throw error
    throw new PathEscapeError('The workspace folder could not be opened.')
  }

  const candidate = path.resolve(root, requested)
  if (!inside(root, candidate)) throw new PathEscapeError('That path is outside the workspace folder.')

  const relative = path.relative(root, candidate)
  const parts = relative.split(path.sep).filter((part) => part && part !== '.')
  let current = root
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === '..') throw new PathEscapeError('That path is outside the workspace folder.')
    if (RESERVED_NAME.test(part) || /[:<>"|?*\x00-\x1f]/.test(part) || part.endsWith('.') || part.endsWith(' ')) {
      throw new PathEscapeError('That path is not valid on Windows.')
    }
    const next = path.join(current, part)
    let stats: fs.Stats | null = null
    try {
      stats = fs.lstatSync(next)
    } catch {
      stats = null
    }
    if (!stats) return path.join(current, ...parts.slice(index))
    if (stats.isSymbolicLink()) {
      let real: string
      try {
        real = fs.realpathSync(next)
      } catch {
        throw new PathEscapeError('That shortcut could not be resolved.')
      }
      if (!inside(root, real)) {
        throw new PathEscapeError('That path leaves the workspace through a shortcut, symlink, or junction.')
      }
      current = real
      continue
    }
    current = next
  }

  try {
    const real = fs.realpathSync(current)
    if (!inside(root, real)) {
      throw new PathEscapeError('That path leaves the workspace through a shortcut, symlink, or junction.')
    }
    return real
  } catch (error) {
    if (error instanceof PathEscapeError) throw error
    return current
  }
}

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  if (relative === '') return true
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
