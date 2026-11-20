import type { Database, MemoryRecord } from './db'
import { looksLikeSecret, redact } from './redact'

export type EmbedMemory = (texts: string[], signal: AbortSignal) => Promise<Float32Array[]>

const DIMENSIONS = 384
// Change the index key when the model, dimensions, or input formatting changes.
export const MEMORY_INDEX_KEY = 'bge-small-en-v1.5/c5ac6c3-int8/384/v1'
const BACKFILL_BATCH = 2
const MIN_SIMILARITY = 0.50

export async function findSemanticMemories(
  db: Database,
  botId: string,
  query: string,
  secrets: string[],
  signal: AbortSignal,
  embed: EmbedMemory
): Promise<MemoryRecord[]> {
  const safeText = (text: string): boolean =>
    !text.includes('[redacted') && !looksLikeSecret(text, secrets) && redact(text, secrets) === text
  const input = query.trim()
  if (!input || !safeText(input) || /^(?:hi|hey|hello|thanks|thank you|ok|okay|bye)[.!\s]*$/i.test(input)) return []
  const pending = db.unindexedMemories(botId, MEMORY_INDEX_KEY, 12)
    .filter(memory => safeText(memory.content)).slice(0, BACKFILL_BATCH)
  // ponytail: scan saved vectors in SQLite for up to 2,000 notes per bot; use a vector index if recall needs to cover a larger collection.
  const indexedLimit = 2000
  if (!pending.length && !db.memoryEmbeddings(botId, MEMORY_INDEX_KEY, 1).length) return []
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(6000)])
  const embeddings = await embed([
    `Represent this sentence for searching relevant passages: ${input.slice(0, 1600)}`,
    ...pending.map(memory => memory.content.slice(0, 2000))
  ], deadline)
  if (deadline.aborted || !db.getSettings(botId).semanticMemory) return []
  if (embeddings.length !== pending.length + 1) return []
  const vectors = embeddings.map(toBlob)
  const [queryVector, ...noteVectors] = vectors
  if (!queryVector) return []
  pending.forEach((memory, index) => {
    const vector = noteVectors[index]
    if (vector) db.saveMemoryEmbedding(memory, MEMORY_INDEX_KEY, vector)
  })
  const matches = db.memoryEmbeddings(botId, MEMORY_INDEX_KEY, indexedLimit)
    .filter(({ memory }) => safeText(memory.content))
    .map(({ memory, vector }) => {
      const score = dotProduct(queryVector, vector)
      const priority = memory.provenance !== 'automatic' ? 0.04 : 0
      return { memory, score, rank: score + priority }
    })
    .filter(hit => hit.score >= MIN_SIMILARITY)
  const cutoff = Math.max(...matches.map(hit => hit.score)) - 0.12
  return matches.filter(hit => hit.score >= cutoff)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5)
    .map(hit => hit.memory)
}

function toBlob(values: Float32Array): Buffer | null {
  if (!(values instanceof Float32Array) || values.length !== DIMENSIONS || !values.every(Number.isFinite)) return null
  const result = Buffer.alloc(DIMENSIONS * 4)
  values.forEach((value, index) => result.writeFloatLE(value, index * 4))
  return result
}

function dotProduct(query: Buffer, vector: Uint8Array): number {
  if (vector.length !== query.length) return 0
  const candidate = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
  let similarity = 0
  for (let offset = 0; offset < vector.length; offset += 4) {
    similarity += query.readFloatLE(offset) * candidate.readFloatLE(offset)
  }
  return similarity
}
