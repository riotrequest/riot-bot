import fs from 'fs/promises'
import path from 'path'
import { isId } from './ids'
import { inside } from './path-safety'

/** Delete only app-owned, per-bot paths. Never traverse an app-data junction. */
export async function removeBotFiles(dataDirectory: string, botId: string, workspace = ''): Promise<string[]> {
  if (!isId(botId)) throw new Error('That bot id is invalid.')
  const root = await fs.realpath(dataDirectory)
  const keptWorkspace = workspace ? await fs.realpath(workspace).catch(()=>path.resolve(workspace)) : ''
  const failed: string[] = []
  for (const [folder,name] of [['browser-profiles',botId],['artifacts',botId],['avatars',`${botId}.png`]]) {
    const parent = path.join(root,folder),target = path.resolve(parent,name)
    if (!inside(root,target) || path.dirname(target)!==parent) throw new Error('Refusing to remove a path outside this bot’s app data.')
    try {
      if (keptWorkspace && (inside(keptWorkspace,target) || inside(target,keptWorkspace))) throw new Error('Keep the project folder.')
      let parentStat
      try { parentStat = await fs.lstat(parent) } catch (error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') continue;throw error }
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !inside(root,await fs.realpath(parent))) throw new Error('App-data parent is a shortcut.')
      let stat
      try { stat = await fs.lstat(target) } catch (error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') continue;throw error }
      if (stat.isSymbolicLink()) await fs.unlink(target)
      else if (folder==='avatars') { if (!stat.isFile()) throw new Error('Unexpected avatar folder.');await fs.unlink(target) }
      else await fs.rm(target,{recursive:true,force:true})
    } catch { failed.push(target) }
  }
  return failed
}
