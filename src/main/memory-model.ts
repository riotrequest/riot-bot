import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Tokenizer } from '@huggingface/tokenizers'
import * as ort from 'onnxruntime-web'

const MAX_TOKENS = 512
const DIMENSIONS = 384

export async function loadMemoryModel(assets: string) {
  const [tokenizerJson, tokenizerConfig] = await Promise.all([
    readFile(path.join(assets, 'tokenizer.json'), 'utf8'),
    readFile(path.join(assets, 'tokenizer_config.json'), 'utf8')
  ])
  const tokenizer = new Tokenizer(JSON.parse(tokenizerJson), JSON.parse(tokenizerConfig))
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = {
    mjs: pathToFileURL(path.join(assets, 'ort-wasm-simd-threaded.mjs')),
    wasm: pathToFileURL(path.join(assets, 'ort-wasm-simd-threaded.wasm'))
  }
  const session = await ort.InferenceSession.create(path.join(assets, 'model.onnx'), { executionProviders: ['wasm'] })
  const asTensor = (values: number[]) => new ort.Tensor('int64', BigInt64Array.from(values, value => BigInt(value)), [1, values.length])

  return async (texts: string[]): Promise<Float32Array[]> => {
    const vectors: Float32Array[] = []
    for (const text of texts) {
      const { ids } = tokenizer.encode(text)
      const tokens = ids.slice(0, MAX_TOKENS)
      // Keep BERT's final separator even when truncating the note.
      if (ids.length > MAX_TOKENS) tokens[MAX_TOKENS - 1] = ids[ids.length - 1]
      const inputs: Record<string, ort.Tensor> = {
        input_ids: asTensor(tokens),
        attention_mask: asTensor(tokens.map(() => 1))
      }
      if (session.inputNames.includes('token_type_ids')) inputs.token_type_ids = asTensor(tokens.map(() => 0))
      const { last_hidden_state: hidden } = await session.run(inputs)
      if (!(hidden?.data instanceof Float32Array) || hidden.dims.at(-1) !== DIMENSIONS) {
        throw new Error('Unexpected semantic-memory model output.')
      }
      const cls = hidden.data.slice(0, DIMENSIONS)
      const magnitude = Math.hypot(...cls)
      if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error('Invalid semantic-memory vector.')
      vectors.push(cls.map(value => value / magnitude))
    }
    return vectors
  }
}
