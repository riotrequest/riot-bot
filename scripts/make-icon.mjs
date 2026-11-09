// Draws the app icon (the same "R" mark as the tray bitmap in src/main/index.ts) and writes
// build/icon.ico, which electron-builder picks up for the app and its installer.
// Run: node scripts/make-icon.mjs [preview.png]
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BACKGROUND = [74, 84, 212]
const MARK = [245, 235, 230]
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const SAMPLES = 4

// Geometry on the tray's 24-unit grid: a rounded square from 2 to 22 holding the letter.
function inside(u, v) {
  const radius = 4
  const dx = Math.max(2 + radius - u, 0, u - (22 - radius))
  const dy = Math.max(2 + radius - v, 0, v - (22 - radius))
  return u >= 2 && u < 22 && v >= 2 && v < 22 && dx * dx + dy * dy <= radius * radius
}

function mark(u, v) {
  return u >= 7 && u < 11 && v >= 6 && v < 19 ||
    v >= 6 && v < 10 && u >= 9 && u < 17 ||
    u >= 14 && u < 17 && v >= 9 && v < 13 ||
    v >= 11 && v < 14 && u >= 9 && u < 17 ||
    v >= 14 && v < 19 && u - v >= -2 && u - v < 2
}

/** Straight-alpha RGBA pixels, top row first, antialiased by supersampling. */
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let covered = 0
    let marked = 0
    for (let sy = 0; sy < SAMPLES; sy++) for (let sx = 0; sx < SAMPLES; sx++) {
      const u = (x + (sx + 0.5) / SAMPLES) * 24 / size
      const v = (y + (sy + 0.5) / SAMPLES) * 24 / size
      if (!inside(u, v)) continue
      covered++
      if (mark(u, v)) marked++
    }
    if (!covered) continue
    const blend = marked / covered
    const offset = (y * size + x) * 4
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = Math.round(MARK[channel] * blend + BACKGROUND[channel] * (1 - blend))
    }
    pixels[offset + 3] = Math.round(255 * covered / (SAMPLES * SAMPLES))
  }
  return pixels
}

function png(size, pixels) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(zlib.crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** A classic icon bitmap: 32-bit BGRA rows from the bottom up, then an empty 1-bit mask. */
function bitmap(size, pixels) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const color = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const from = ((size - 1 - y) * size + x) * 4
    color.set([pixels[from + 2], pixels[from + 1], pixels[from], pixels[from + 3]], (y * size + x) * 4)
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size)
  return Buffer.concat([header, color, mask])
}

const images = SIZES.map(size => {
  const pixels = draw(size)
  return { size, data: size === 256 ? png(size, pixels) : bitmap(size, pixels) }
})
const directory = Buffer.alloc(6 + images.length * 16)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(images.length, 4)
let offset = directory.length
images.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16
  directory.set([size % 256, size % 256], entry) // 0 means 256
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(data.length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += data.length
})

const target = path.join(import.meta.dirname, '..', 'build', 'icon.ico')
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, Buffer.concat([directory, ...images.map(image => image.data)]))
if (process.argv[2]) fs.writeFileSync(process.argv[2], png(256, draw(256)))
console.log(`Wrote ${target}`)
