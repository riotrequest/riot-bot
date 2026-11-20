import { loadMemoryModel } from './memory-model'

const port = process.parentPort
let model: ReturnType<typeof loadMemoryModel> | undefined

port.on('message', async ({ data }: { data: string[] }) => {
  try {
    model ??= loadMemoryModel(process.argv[2])
    const embed = await model
    port.postMessage(await embed(data))
  } catch {
    port.postMessage(null)
  }
})
