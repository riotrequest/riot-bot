import path from 'path'
import { inspectRaster, nativeImage } from './avatar'

export const MAX_ATTACHMENT_BYTES = 8_000_000
export const MAX_TEXT_BYTES = 1_000_000
export const MAX_ATTACHMENTS = 4
export const IMAGE_TOKEN_RESERVE = 16_384

export interface PreparedAttachment {
  name: string
  kind: 'image' | 'text'
  mimeType: string
  size: number
  width: number | null
  height: number | null
  previewUrl: string | null
  data: Buffer
}

export function prepareAttachment(name: string, bytes: Buffer): PreparedAttachment {
  const cleanName = path.win32.basename(path.posix.basename(name)).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180) || 'attachment.txt'
  if (!bytes.length) throw new Error('That attachment is empty.')
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must be 8 MB or smaller.')
  const imageFile = /\.(png|jpe?g|webp|gif)$/i.test(cleanName)
  const imageHeader = bytes[0] === 0x89 || (bytes[0] === 0xff && bytes[1] === 0xd8) || bytes.toString('ascii', 0, 3) === 'GIF' || bytes.toString('ascii', 0, 4) === 'RIFF'
  if (imageFile || imageHeader) {
    const info = inspectRaster(bytes, { bytes: MAX_ATTACHMENT_BYTES, side: 8192, pixels: 32_000_000 })
    if (info.format !== 'png' && info.format !== 'jpeg') throw new Error('Use PNG or JPEG for chat images. Convert GIF or WebP to PNG first.')
    const native = nativeImage()
    if (!native) {
      // Node tests can keep a small PNG; desktop uploads always go through the real decoder.
      if (info.format !== 'png' || info.width > 256 || info.height > 256) throw new Error('Open the desktop app to decode that image.')
      return { name: cleanName, kind: 'image', mimeType: 'image/png', size: bytes.length, width: info.width, height: info.height, previewUrl: `data:image/png;base64,${bytes.toString('base64')}`, data: bytes }
    }
    const decoded = native.createFromBuffer(bytes)
    if (decoded.isEmpty()) throw new Error('That image could not be decoded.')
    const { width, height } = decoded.getSize()
    if (width < 1 || height < 1 || width * height > 32_000_000) throw new Error('That image is too large to decode.')
    const ratio = Math.min(1, 2048 / Math.max(width, height))
    const resized = ratio < 1 ? decoded.resize({ width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }) : decoded
    const data = Buffer.from(resized.toPNG())
    if (!data.length || data.length > MAX_ATTACHMENT_BYTES) throw new Error('The decoded image is larger than 8 MB. Choose a smaller image.')
    const size = resized.getSize()
    const thumbnailRatio = Math.min(1, 192 / Math.max(size.width, size.height))
    const thumb = resized.resize({ width: Math.max(1, Math.round(size.width * thumbnailRatio)), height: Math.max(1, Math.round(size.height * thumbnailRatio)) })
    return { name: cleanName, kind: 'image', mimeType: 'image/png', size: data.length, width: size.width, height: size.height, previewUrl: `data:image/png;base64,${Buffer.from(thumb.toPNG()).toString('base64')}`, data }
  }
  if (bytes.length > MAX_TEXT_BYTES) throw new Error('Text attachments must be 1 MB or smaller.')
  if (bytes.includes(0) || /\.(pdf|docx?|xlsx?|pptx?|zip|exe|dll|mp[34]|wav|sqlite|db)$/i.test(cleanName)) {
    throw new Error('Use an image or a UTF-8 text/code file. PDF, Office, archives, audio, and other binary files are not supported yet.')
  }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('That file is not UTF-8 text. Save it as UTF-8, or attach a screenshot.') }
  if (!text.trim() || /[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('That file does not contain supported text.')
  return { name: cleanName, kind: 'text', mimeType: 'text/plain', size: bytes.length, width: null, height: null, previewUrl: null, data: Buffer.from(text, 'utf8') }
}
