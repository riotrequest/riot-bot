import { createCustomEndpointFetch } from './custom-endpoint'
import type { Database, MemoryRecord } from './db'
import { looksLikeSecret, redact } from './redact'

const OLLAMA_ORIGIN = 'http://127.0.0.1:11434'
const MODEL = 'embeddinggemma:300m'
const DIMENSIONS = 768
// Change the index key when the model, dimensions, or input formatting changes.
const INDEX_KEY = `${MODEL}/${DIMENSIONS}/v1`
const BACKFILL_BATCH = 12
const MIN_SIMILARITY = 0.24
const localFetch = createCustomEndpointFetch({ baseUrl: OLLAMA_ORIGIN })

export async function findSemanticMemories(
  db: Database,
  botId: string,
  query: string,
  secrets: string[],
  signal: AbortSignal,
  fetchImpl = localFetch
): Promise<MemoryRecord[]> {
  const safeText = (text: string): boolean =>
    !text.includes('[redacted') && !looksLikeSecret(text, secrets) && redact(text, secrets) === text
  const input = query.trim()
  if (!input || !safeText(input) || /^(?:hi|hey|hello|thanks|thank you|ok|okay|bye)[.!\s]*$/i.test(input)) return []
  const pending = db.unindexedMemories(botId, INDEX_KEY, BACKFILL_BATCH).filter(memory => safeText(memory.content))
  // ponytail: scan saved vectors in SQLite for up to 2,000 notes per bot; use a vector index if recall needs to cover a larger collection.
  const indexedLimit = 2000
  if (!pending.length && !db.memoryEmbeddings(botId, INDEX_KEY, 1).length) return []
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(6000)])
  const response = await fetchImpl(`${OLLAMA_ORIGIN}/api/embed`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      dimensions: DIMENSIONS,
      input: [
        `task: search result | query: ${input.slice(0, 1600)}`,
        ...pending.map(memory => `title: none | text: ${memory.content.slice(0, 2000)}`)
      ]
    }),
    signal: deadline
  })
  if (!response.ok || deadline.aborted) return []
  const payload = await response.json() as { embeddings?: unknown }
  if (deadline.aborted || !db.getSettings(botId).semanticMemory) return []
  if (!Array.isArray(payload?.embeddings) || payload.embeddings.length !== pending.length + 1) return []
  const vectors = payload.embeddings.map(normalize)
  const [queryVector, ...noteVectors] = vectors
  if (!queryVector) return []
  pending.forEach((memory, index) => {
    const vector = noteVectors[index]
    if (vector) db.saveMemoryEmbedding(memory, INDEX_KEY, vector)
  })
  const matches = db.memoryEmbeddings(botId, INDEX_KEY, indexedLimit)
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

function normalize(values: unknown): Buffer | null {
  if (!Array.isArray(values) || values.length !== DIMENSIONS || !values.every(value => typeof value === 'number' && Number.isFinite(value))) return null
  const magnitude = Math.hypot(...values)
  if (!Number.isFinite(magnitude) || magnitude === 0) return null
  const result = Buffer.alloc(DIMENSIONS * 4)
  values.forEach((value, index) => result.writeFloatLE(value / magnitude, index * 4))
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
