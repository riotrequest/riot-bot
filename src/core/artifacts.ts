import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { ArtifactView } from '../shared/types'
import type { ArtifactRecord, Database, JobRecord } from './db'
import { newId } from './ids'
import { resolveWorkspacePath, withWorkspaceFile } from './path-safety'

const MAX_FILE_BYTES = 20_000_000
const MAX_JOB_BYTES = 100_000_000
const SKIP = /^(?:\.|node_modules$|vendor$|credentials|secrets?(?:\.|$)|auth(?:\.|$)|cookies$|local state$|id_rsa|id_ed25519)|\.(?:pem|key|p12|pfx)$/i

/** Bounded inventory; never follow workspace shortcuts or collect credential files. */
export function workspaceInventory(workspace: string): Map<string, string> {
  const files = new Map<string, string>()
  if (!workspace) return files
  let visited = 0
  const walk = (folder: string, depth: number): void => {
    if (depth > 12 || visited++ > 2000 || files.size >= 1000) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(folder, { withFileTypes:true }) } catch { return }
    for (const entry of entries) {
      if (files.size >= 1000) break
      if (entry.isSymbolicLink() || SKIP.test(entry.name)) continue
      const requested = path.relative(workspace,path.join(folder,entry.name))
      try {
        const file = resolveWorkspacePath(workspace,requested)
        if (entry.isDirectory()) walk(file,depth+1)
        else if (entry.isFile()) {
          const stat = fs.statSync(file)
          if (stat.size <= MAX_FILE_BYTES) files.set(requested,`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`)
        }
      } catch { /* A disappearing or inaccessible file is not an artifact. */ }
    }
  }
  walk(workspace,0)
  return files
}

export function captureArtifacts(input: {
  db: Database
  job: JobRecord
  workspace: string
  libraryRoot: string
  before: Map<string,string>
  secrets: string[]
  now: number
}): number {
  if (!input.workspace) return 0
  const after = workspaceInventory(input.workspace)
  const changed = new Set([...after].filter(([file,stamp])=>input.before.get(file)!==stamp).map(([file])=>file))
  for (const file of input.db.jobFilePaths(input.job.id)) changed.add(path.relative(input.workspace,file))
  let total = 0, saved = 0
  for (const requested of changed) {
    if (saved >= 100 || total >= MAX_JOB_BYTES) break
    const parts = requested.split(/[\\/]/)
    if (parts.some(part=>SKIP.test(part))) continue
    let storagePath: string | null = null
    try {
      const file = resolveWorkspacePath(input.workspace,requested)
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES || total+stat.size > MAX_JOB_BYTES) continue
      const data = withWorkspaceFile(file,'r',fd=>fs.readFileSync(fd))
      if (data.length>MAX_FILE_BYTES || total+data.length>MAX_JOB_BYTES) continue
      if (input.secrets.some(secret=>secret.length>=8&&data.includes(Buffer.from(secret)))) continue
      const id = newId()
      const storageKey = `${input.job.botId}/${id}/${path.basename(file)}`
      fs.mkdirSync(input.libraryRoot,{recursive:true})
      const folder = resolveWorkspacePath(input.libraryRoot,`${input.job.botId}/${id}`)
      fs.mkdirSync(folder,{recursive:true})
      storagePath = resolveWorkspacePath(input.libraryRoot,storageKey)
      fs.writeFileSync(storagePath,data,{flag:'wx',mode:0o600})
      const record = input.db.addArtifact({
        id,botId:input.job.botId,jobId:input.job.id,runId:input.job.runId,name:path.basename(file),
        relativePath:requested.split(path.sep).join('/'),workspaceRoot:fs.realpathSync(input.workspace),storageKey,
        bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),createdAt:input.now
      })
      if (record.id!==id) fs.unlinkSync(storagePath)
      total += data.length
      saved++
      storagePath = null
    } catch {
      if (storagePath) { try { fs.unlinkSync(storagePath) } catch { /* Keep the original workspace file. */ } }
    }
  }
  return saved
}

export function artifactFile(libraryRoot: string, record: ArtifactRecord): string {
  const file = resolveWorkspacePath(libraryRoot,record.storageKey)
  if (!fs.statSync(file).isFile()) throw new Error('That saved result is no longer available.')
  return file
}

export function artifactView(record: ArtifactRecord): ArtifactView {
  const { workspaceRoot: _workspace,storageKey: _storage,...view } = record
  return view
}
