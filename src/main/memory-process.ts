import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, net, utilityProcess, type UtilityProcess } from 'electron'
import type { EmbedMemory } from '../core/semantic-memory'

const IDLE_MS = 30_000

export class MemoryEmbeddingProcess {
  private child: UtilityProcess | undefined
  private idle: ReturnType<typeof setTimeout> | undefined
  private queue = Promise.resolve()
  private preparing?: Promise<void>

  prepare(): Promise<void> {
    if (app.isPackaged) return Promise.resolve()
    if (!this.preparing) {
      // Source builds have the installer script and development dependencies. Releases bundle verified assets.
      const script = pathToFileURL(path.join(app.getAppPath(), 'scripts', 'prepare-memory-model.mjs')).href
      this.preparing = import(script).then(module => module.prepareMemoryModel(
        (url: URL, init: RequestInit) => net.fetch(url.href, init)
      )).catch(() => {
        this.preparing = undefined
        throw new Error('Could not prepare semantic memory. Check your connection and retry, or run npm run memory:prepare in the source checkout.')
      })
    }
    return this.preparing!
  }

  readonly embed: EmbedMemory = (input, signal) => {
    // One CPU session shared by the active bots. The child retains weights only.
    const work = this.queue.then(async () => {
      signal.throwIfAborted()
      await this.prepare()
      return this.run(input, signal)
    })
    this.queue = work.then(() => undefined, () => undefined)
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      void work.then(value => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      }, error => {
        signal.removeEventListener('abort', abort)
        reject(error)
      })
    })
  }

  private run(input: string[], signal: AbortSignal): Promise<Float32Array[]> {
    signal.throwIfAborted()
    clearTimeout(this.idle)
    if (!this.child) {
      const assets = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'memory-assets')
      const entry = path.join(app.getAppPath(), 'out', 'main', 'memory-worker.js')
      const child = utilityProcess.fork(entry, [assets], { serviceName: 'Riot Bot semantic memory' })
      this.child = child
      child.once('exit', () => {
        if (this.child === child) this.child = undefined
      })
    }
    const child = this.child
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        child.off('message', result)
        child.off('exit', exit)
        signal.removeEventListener('abort', abort)
      }
      const result = (vectors: Float32Array[] | null) => {
        cleanup()
        if (!Array.isArray(vectors)) {
          this.close()
          reject(new Error('The bundled semantic-memory model could not run.'))
          return
        }
        this.idle = setTimeout(() => this.close(), IDLE_MS)
        this.idle.unref()
        resolve(vectors)
      }
      const exit = () => {
        cleanup()
        reject(new Error('The semantic-memory process exited.'))
      }
      const abort = () => {
        cleanup()
        this.close()
        reject(signal.reason)
      }
      child.once('message', result)
      child.once('exit', exit)
      signal.addEventListener('abort', abort, { once: true })
      try {
        child.postMessage(input)
      } catch (error) {
        cleanup()
        this.close()
        reject(error)
      }
    })
  }

  close(): void {
    clearTimeout(this.idle)
    const child = this.child
    this.child = undefined
    child?.kill()
  }
}
