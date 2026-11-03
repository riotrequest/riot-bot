import fs from 'node:fs/promises'
import path from 'node:path'
import { ConfigError } from './errors'

/** Read capacity counters only. Does not read files, run commands, or change permissions. */
export async function getDiskSpace(location: string) {
  const target = path.resolve(location)
  let stats
  try { stats = await fs.statfs(target) }
  catch (error) {
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
