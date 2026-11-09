import fs from 'node:fs/promises'
import path from 'node:path'
import { ConfigError, StopError } from './errors'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const DRIVE_LOOKUP_TIMEOUT_MS=20_000
const STOPPED='Stopped. Disk space was not read.'

/** Drive letters listed under a volume in mountvol's output. The rest of its text is localized and ignored. */
export function volumeRoots(output:string):string[]{
  const roots:string[]=[]
  let inVolume=false
  for(const line of output.split(/\r?\n/)){
    const text=line.trim()
    if(/^\\\\\?\\Volume\{[0-9A-Fa-f-]+\}\\$/.test(text))inVolume=true
    else if(!text)inVolume=false
    else if(inVolume&&/^[A-Za-z]:\\$/.test(text))roots.push(text.toUpperCase())
  }
  return roots
}

/**
 * Lists the drive letters of local volumes with Windows' built-in mountvol, a small native tool that needs no
 * administrator rights. Network drives and substituted drives are not volumes, so they never appear.
 */
export async function readLocalVolumes():Promise<string[]>{
  const {stdout}=await promisify(execFile)(path.join(process.env.SystemRoot??'C:\\Windows','System32','mountvol.exe'),[],{windowsHide:true,timeout:DRIVE_LOOKUP_TIMEOUT_MS,maxBuffer:100_000})
  return volumeRoots(stdout)
}

let volumes: {at:number;roots:Promise<string[]>}|null=null
async function localWindowsVolumes():Promise<string[]>{
  if(volumes&&Date.now()-volumes.at<10_000)return volumes.roots
  const roots=readLocalVolumes().catch(()=>{volumes=null;throw new ConfigError('Windows could not identify local drives. No filesystem query was sent to that location.')})
  volumes={at:Date.now(),roots}
  return roots
}

/** Check drive type and link targets before any operation can follow a network path. */
export async function localDiskPath(location:string,platform=process.platform,localRoots=localWindowsVolumes,depth=0):Promise<string>{
  if(depth>16)throw new ConfigError('That location contains too many filesystem links.')
  if(/^(?:\\\\|\/\/)|\0/.test(location))throw new ConfigError('Disk-space checks accept local drives and folders, not network shares or device paths.')
  const paths=platform==='win32'?path.win32:path,target=paths.resolve(location)
  const root=paths.parse(target).root
  if(platform==='win32'&&(!/^[A-Za-z]:\\$/.test(root)||!(await localRoots()).includes(root.toUpperCase())))throw new ConfigError('That drive is remote or unavailable. Choose a local drive or folder for this check.')
  let current=root
  const parts=target.slice(root.length).split(paths.sep).filter(Boolean)
  for(let index=0;index<parts.length;index++){
    current=paths.join(current,parts[index])
    const stat=await fs.lstat(current)
    if(stat.isSymbolicLink()){
      const link=await fs.readlink(current)
      return localDiskPath(paths.resolve(paths.dirname(current),link,...parts.slice(index+1)),platform,localRoots,depth+1)
    }
  }
  return target
}

/** Waits for the drive lookup unless the run is stopped first. The shared lookup keeps running for other callers. */
function untilStopped<T>(start:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return start()
  if(signal.aborted)return Promise.reject(new StopError(STOPPED))
  return new Promise((resolve,reject)=>{
    const stop=()=>reject(new StopError(STOPPED))
    signal.addEventListener('abort',stop,{once:true})
    start().then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop))
  })
}

/** Read local capacity counters. Windows drive classification uses a fixed, noninteractive OS helper, never model-provided commands. */
export async function getDiskSpace(location: string, signal?: AbortSignal, localRoots = localWindowsVolumes) {
  let target = path.resolve(location)
  let stats
  try { target=await localDiskPath(location,process.platform,()=>untilStopped(localRoots,signal));stats = await fs.statfs(target) }
  catch (error) {
    if(error instanceof ConfigError||error instanceof StopError)throw error
    const code = (error as NodeJS.ErrnoException).code || 'unavailable'
    throw new ConfigError(`Could not read disk space for ${target} (${code}). Check that this drive or folder exists and is available.`)
  }
  const totalBytes = stats.blocks * stats.bsize, freeBytes = stats.bfree * stats.bsize, availableBytes = stats.bavail * stats.bsize
  if (![totalBytes, freeBytes, availableBytes].every(Number.isSafeInteger) || totalBytes <= 0 || availableBytes < 0 || freeBytes < availableBytes || freeBytes > totalBytes) throw new ConfigError(`This filesystem did not return reliable disk-space values for ${target}. Do not interpret unavailable values as zero.`)
  return {
    filesystemContaining: target,
    measuredAt: new Date().toISOString(),
    totalBytes, usedBytes: totalBytes - freeBytes, availableBytes,
    totalGB: Number((totalBytes / 1e9).toFixed(1)), availableGB: Number((availableBytes / 1e9).toFixed(1)),
    units: 'GB are decimal: 1 GB = 1,000,000,000 bytes.',
    scope: 'Only the filesystem containing this location was checked. Other drives were not checked.'
  }
}
