import fs from 'fs'
import path from 'path'
import { isId } from './ids'

export const BUILTIN_AVATARS = ['spark', 'leaf', 'moon', 'bolt', 'wave', 'star'] as const
export const AVATAR_COLORS = ['#d4544a', '#2f6f62', '#3a5f8a', '#8a5a32', '#6b4c7a', '#3f6b4a']

export type AvatarKind = 'builtin' | 'emoji' | 'image'

export interface AvatarChoice {
  kind: AvatarKind
  value: string
  background: string
}

const EMOJI_OK = /^\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?$/u

export function assignBuiltin(seed: string): AvatarChoice {
  let hash = 0
  for (const char of seed) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  return {
    kind: 'builtin',
    value: BUILTIN_AVATARS[hash % BUILTIN_AVATARS.length],
    background: AVATAR_COLORS[hash % AVATAR_COLORS.length]
  }
}

export function cleanAvatarChoice(input: AvatarChoice): AvatarChoice {
  const background = AVATAR_COLORS.includes(input.background) ? input.background : AVATAR_COLORS[0]
  if (input.kind === 'builtin' && (BUILTIN_AVATARS as readonly string[]).includes(input.value)) {
    return { kind: 'builtin', value: input.value, background }
  }
  if (input.kind === 'emoji') {
    const value = input.value.trim()
    if (EMOJI_OK.test(value)) return { kind: 'emoji', value, background }
  }
  return assignBuiltin(input.value || 'riot')
}

export interface RasterInfo {
  format: 'png' | 'jpeg' | 'gif' | 'webp'
  width: number
  height: number
}

export function inspectRaster(bytes: Buffer): RasterInfo {
  if (bytes.length === 0) throw new Error('Choose an image file.')
  if (bytes.length > 2_000_000) throw new Error('That image is larger than 2 MB.')
  const head = bytes.subarray(0, Math.min(bytes.length, 256)).toString('utf8').trim().toLowerCase()
  if (head.startsWith('<') || head.includes('<svg') || head.includes('<html') || head.includes('<!doctype') || head.includes('<?xml')) {
    throw new Error('Use a PNG, JPEG, GIF, or WebP image. SVG and HTML are not accepted.')
  }
  const info = dimensions(bytes)
  if (!info) throw new Error('That file is not a PNG, JPEG, GIF, or WebP image.')
  if (info.width < 1 || info.height < 1 || info.width > 4096 || info.height > 4096 || info.width * info.height > 8_000_000) {
    throw new Error('That image is too large. Use one that is 4096 pixels or smaller on each side.')
  }
  return info
}

/** Decode and resize to a PNG thumbnail. A small PNG is kept when this process cannot resize. */
export function thumbnailPng(bytes: Buffer): Buffer {
  const info = inspectRaster(bytes)
  const native = nativeImage()
  if (native) {
    const image = native.createFromBuffer(bytes)
    if (!image || image.isEmpty()) throw new Error('That image could not be decoded.')
    const size = image.getSize()
    if (!size.width || !size.height) throw new Error('That image could not be decoded.')
    const longest = Math.max(size.width, size.height)
    const resized = longest > 128 ? image.resize({ width: Math.max(1, Math.round((size.width * 128) / longest)), height: Math.max(1, Math.round((size.height * 128) / longest)) }) : image
    const png = resized.toPNG()
    if (!png.length || png.length > 500_000) throw new Error('That image could not be stored.')
    return Buffer.from(png)
  }
  if (info.format === 'png' && info.width <= 128 && info.height <= 128) return bytes
  throw new Error('That image needs the desktop app to resize it. Use a PNG that is 128 pixels or smaller.')
}

export function avatarFile(directory: string, botId: string): string {
  if (!isId(botId)) throw new Error('That bot was not found.')
  return path.join(directory, `${botId}.png`)
}

export function readAvatarFile(file: string): Buffer | null {
  try {
    const bytes = fs.readFileSync(file)
    inspectRaster(bytes)
    return bytes
  } catch {
    return null
  }
}

function dimensions(bytes: Buffer): RasterInfo | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') {
    return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (bytes.length >= 10 && bytes.toString('ascii', 0, 3) === 'GIF') {
    return { format: 'gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  }
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const kind = bytes.toString('ascii', 12, 16)
    if (kind === 'VP8X' && bytes.length >= 30) {
      return { format: 'webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
    }
    if (kind === 'VP8 ' && bytes.length >= 30) {
      return { format: 'webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    }
    if (kind === 'VP8L' && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21)
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1]
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2
        continue
      }
      const size = bytes.readUInt16BE(offset + 2)
      if (size < 2 || offset + 2 + size > bytes.length) return null
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { format: 'jpeg', width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
      }
      offset += 2 + size
    }
  }
  return null
}

interface NativeImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number; height: number }): NativeImage
  toPNG(): Uint8Array
}

function nativeImage(): { createFromBuffer(bytes: Buffer): NativeImage } | null {
  try {
    const electron = require('electron') as { nativeImage?: { createFromBuffer(bytes: Buffer): NativeImage } }
    if (electron.nativeImage && typeof electron.nativeImage.createFromBuffer === 'function') return electron.nativeImage
  } catch {
    return null
  }
  return null
}
