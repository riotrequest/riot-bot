import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const output = fileURLToPath(new URL('../memory-assets/', import.meta.url))
const model = 'https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/c5ac6c397e27c80e0229ec647987f2e553fc0ba9/'
const modelAssets = [
  ['onnx/model_quantized.onnx', 'model.onnx', 34014426, '6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4'],
  ['tokenizer.json', 'tokenizer.json', 711396, 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66'],
  ['tokenizer_config.json', 'tokenizer_config.json', 366, '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3']
]

await mkdir(output, { recursive: true })
await Promise.all(modelAssets.map(async ([remoteName, localName, size, digest]) => {
  const target = join(output, localName)
  const matches = bytes => bytes.length === size && createHash('sha256').update(bytes).digest('hex') === digest
  const cached = await readFile(target).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return Buffer.alloc(0)
  })
  if (matches(cached)) return

  const response = await fetch(new URL(remoteName, model), { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Model asset ${localName} returned HTTP ${response.status}.`)
  const chunks = []
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > size) throw new Error(`Model asset ${localName} exceeded its expected size.`)
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks, length)
  if (!matches(bytes)) throw new Error(`Model asset ${localName} failed its integrity check.`)
  const pending = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(pending, bytes, { flag: 'wx' })
    await rename(pending, target)
  } finally {
    await rm(pending, { force: true })
  }
}))

const runtime = dirname(require.resolve('onnxruntime-web'))
for (const filename of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  await copyFile(join(runtime, filename), join(output, filename))
}
await copyFile(join(dirname(require.resolve('@huggingface/tokenizers')), '..', 'LICENSE'), join(output, 'TOKENIZERS-LICENSE.txt'))
await writeFile(join(output, 'THIRD-PARTY-NOTICES.txt'), await readFile(new URL('../docs/semantic-memory-notices.txt', import.meta.url)))
