import { ProviderError, type ProviderErrorKind } from './errors'
import type { ModelCompleteInput, ModelProvider, ModelResponse, ModelUsage, ToolCall } from './model'
import { redact } from './redact'
import type { Logger } from './logger'
import { silentLogger } from './logger'

export type MockHandler = (input: ModelCompleteInput) => ModelResponse | Promise<ModelResponse>

export class MockProvider implements ModelProvider {
  readonly name = 'mock'
  readonly calls: ModelCompleteInput[] = []
  script: MockHandler[] = []
  handler: MockHandler | null = null

  async complete(input: ModelCompleteInput): Promise<ModelResponse> {
    this.calls.push(input)
    if (input.signal.aborted) throw new ProviderError('cancelled', 'Stopped before the request was sent.')
    if (this.handler) return this.handler(input)
    const next = this.script.shift()
    if (!next) return { content: 'Mock reply.', toolCalls: [], usage: { inputTokens: 12, outputTokens: 4 } }
    return next(input)
  }
}

export function classifyProviderFailure(status: number, body: string): ProviderError {
  let message = body.slice(0, 600)
  let code = ''
  try {
    const json = JSON.parse(body) as { error?: { message?: string; code?: string; type?: string } }
    if (json.error?.message) message = String(json.error.message)
    code = `${json.error?.code ?? ''} ${json.error?.type ?? ''}`
  } catch {
    /* the body was not JSON */
  }
  const hay = `${status} ${code} ${message}`.toLowerCase()
  if (status === 401 || hay.includes('invalid_api_key') || hay.includes('invalid api key') || hay.includes('incorrect api key')) {
    return new ProviderError('auth', 'The API key was rejected. Check the key in Settings. Riot Bot will not retry this.', status)
  }
  if (
    status === 402 ||
    hay.includes('insufficient_quota') ||
    hay.includes('insufficient quota') ||
    hay.includes('insufficient credit') ||
    hay.includes('exceeded your current quota') ||
    hay.includes('payment required')
  ) {
    return new ProviderError('credit', 'The provider reported a billing or credit problem. Riot Bot will not retry this.', status)
  }
  if (hay.includes('context_length') || hay.includes('maximum context') || hay.includes('context length') || hay.includes('too many tokens')) {
    return new ProviderError('context_limit', message, status)
  }
  if (hay.includes('max_completion_tokens') || (hay.includes('max_tokens') && hay.includes('unsupported')) || hay.includes('unknown parameter') || hay.includes('unsupported parameter')) {
    return new ProviderError('unsupported_parameter', message, status)
  }
  if ((hay.includes('tool') || hay.includes('function')) && (hay.includes('not support') || hay.includes('unsupported') || hay.includes('does not support'))) {
    return new ProviderError('unsupported_tools', message, status)
  }
  if (hay.includes('stream') && (hay.includes('not support') || hay.includes('unsupported') || hay.includes('does not support'))) {
    return new ProviderError('unsupported_stream', message, status)
  }
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return new ProviderError('transient', message || `The provider returned status ${status}.`, status)
  }
  return new ProviderError('unknown', message || `The provider returned status ${status}.`, status)
}

export function consumeSseBuffer(buffer: string): { events: unknown[]; rest: string; done: boolean } {
  const parts = buffer.split(/\r?\n\r?\n/)
  const rest = parts.pop() ?? ''
  const events: unknown[] = []
  for (const part of parts) {
    const data = part
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    if (data === '[DONE]') return { events, rest: '', done: true }
    try {
      events.push(JSON.parse(data) as unknown)
    } catch {
      throw new ProviderError('unknown', 'The provider returned malformed stream data. No tool actions were executed.')
    }
  }
  return { events, rest, done: false }
}

export function usageFromApi(usage: unknown): ModelUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const details = record.prompt_tokens_details as Record<string, unknown> | undefined
  const reported = numberOrUndefined(record.cost)
  const inputTokens = numberOrUndefined(record.prompt_tokens ?? record.input_tokens)
  const outputTokens = numberOrUndefined(record.completion_tokens ?? record.output_tokens)
  const cacheTokens = numberOrUndefined(details?.cached_tokens ?? record.cache_read_input_tokens)
  if (inputTokens == null && outputTokens == null && cacheTokens == null && reported == null) return undefined
  return { inputTokens, outputTokens, cacheTokens, reportedCostUsd: reported }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function mapToolCall(value: unknown, index: number): ToolCall {
  const record = (value ?? {}) as Record<string, unknown>
  const fn = (record.function ?? {}) as Record<string, unknown>
  return {
    id: typeof record.id === 'string' && record.id ? record.id : `call_${index + 1}`,
    name: typeof fn.name === 'string' ? fn.name : '',
    arguments: typeof fn.arguments === 'string' ? fn.arguments : ''
  }
}

export function responseFromJson(json: unknown): ModelResponse {
  const failure = streamError(json)
  if (failure) throw new ProviderError('unknown', failure)
  const record = (json ?? {}) as Record<string, unknown>
  const choice = Array.isArray(record.choices) ? (record.choices[0] as Record<string, unknown> | undefined) : undefined
  if (!choice?.message || typeof choice.message !== 'object') {
    throw new ProviderError('unknown', 'The provider returned no completion message.')
  }
  const message = (choice?.message ?? {}) as Record<string, unknown>
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls.map((call, index) => mapToolCall(call, index)) : []
  const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined
  return {
    content: typeof message.content === 'string' ? message.content : '',
    toolCalls: calls.filter((call) => call.name),
    usage: usageFromApi(record.usage),
    finishReason: finish
  }
}

export interface StreamState {
  content: string
  tools: ToolCall[]
  usage?: ModelUsage
  finishReason?: string
}

export function streamError(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null
  const record = event as Record<string, unknown>
  const error = record.error
  if (!error) {
    const choices = Array.isArray(record.choices) ? record.choices : []
    return choices.some((choice) => choice?.finish_reason === 'error') ? 'The provider reported a stream error.' : null
  }
  if (typeof error !== 'object') return 'The provider reported a stream error.'
  const message = (error as Record<string, unknown>).message
  return typeof message === 'string' && message.trim() ? message : 'The provider reported a stream error.'
}

export function applyStreamEvent(state: StreamState, event: unknown): void {
  const record = (event ?? {}) as Record<string, unknown>
  const choice = Array.isArray(record.choices) ? (record.choices[0] as Record<string, unknown> | undefined) : undefined
  const delta = (choice?.delta ?? {}) as Record<string, unknown>
  if (typeof delta.content === 'string' && delta.content) state.content += delta.content
  if (typeof choice?.finish_reason === 'string' && choice.finish_reason) state.finishReason = choice.finish_reason
  const deltas = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
  for (const tool of deltas) {
    const item = tool as Record<string, unknown>
    const index = toolIndex(state, item)
    if (!Number.isInteger(index) || index < 0 || index >= 128) {
      throw new ProviderError('unknown', 'The provider returned an invalid tool call index.')
    }
    const current = state.tools[index] ?? { id: '', name: '', arguments: '' }
    if (typeof item.id === 'string' && item.id) current.id = item.id
    const fn = (item.function ?? {}) as Record<string, unknown>
    if (typeof fn.name === 'string' && fn.name) current.name += fn.name
    if (typeof fn.arguments === 'string' && fn.arguments) current.arguments += fn.arguments
    state.tools[index] = current
  }
  const usage = usageFromApi(record.usage)
  if (usage) state.usage = usage
}

function toolIndex(state: StreamState, item: Record<string, unknown>): number {
  if (typeof item.index === 'number' && item.index >= 0) return item.index
  if (typeof item.id === 'string' && item.id) {
    const existing = state.tools.findIndex((tool) => tool?.id === item.id)
    if (existing >= 0) return existing
    return state.tools.length
  }
  return state.tools.length === 0 ? 0 : state.tools.length - 1
}

export function createOpenAICompatibleProvider(options: {
  name: 'openai' | 'openrouter'
  apiKey: string
  fetchImpl?: typeof fetch
  logger?: Logger
}): ModelProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const logger = options.logger ?? silentLogger
  const url = options.name === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions'
  return {
    name: options.name,
    async complete(input: ModelCompleteInput): Promise<ModelResponse> {
      if (input.signal.aborted) throw new ProviderError('cancelled', 'Stopped before the request was sent.')
      const body: Record<string, unknown> = {
        model: input.model,
        messages: input.messages.map(toApiMessage),
        [input.tokenParameter]: input.maxOutputTokens
      }
      if (input.tools && input.tools.length > 0) {
        body.tools = input.tools.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        }))
        body.tool_choice = 'auto'
      }
      if (input.stream) {
        body.stream = true
        body.stream_options = { include_usage: true }
      }
      logger.info('model request', { provider: options.name, model: input.model, stream: input.stream })
      let response: Response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          signal: input.signal,
          headers: headers(options.name, options.apiKey),
          body: JSON.stringify(body)
        })
      } catch (error) {
        if (input.signal.aborted) throw new ProviderError('cancelled', 'Stopped.')
        const message = error instanceof Error ? error.message : 'network error'
        throw new ProviderError('transient', redact(message, [options.apiKey]))
      }
      if (!response.ok) {
        const text = await response.text()
        throw classifyProviderFailure(response.status, redact(text, [options.apiKey]))
      }
      if (!input.stream) {
        const json = await response.json()
        if (input.signal.aborted) throw new ProviderError('cancelled', 'Stopped.')
        const failure = streamError(json)
        if (failure) throw new ProviderError('unknown', redact(failure, [options.apiKey]))
        return responseFromJson(json)
      }
      return readStream(response, input, [options.apiKey])
    }
  }
}

function headers(name: 'openai' | 'openrouter', apiKey: string): Record<string, string> {
  const result: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
  if (name === 'openrouter') {
    result['HTTP-Referer'] = 'http://localhost'
    result['X-Title'] = 'Riot Bot'
  }
  return result
}

function toApiMessage(message: ModelCompleteInput['messages'][number]): Record<string, unknown> {
  if (message.role === 'user' && message.images?.length) return {
    role: 'user',
    content: [{ type: 'text', text: message.content }, ...message.images.map((url) => ({ type: 'image_url', image_url: { url } }))]
  }
  if (message.role === 'tool') return { role: 'tool', content: message.content, tool_call_id: message.toolCallId }
  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments }
      }))
    }
  }
  return { role: message.role, content: message.content }
}

async function readStream(response: Response, input: ModelCompleteInput, secrets: string[]): Promise<ModelResponse> {
  const reader = response.body?.getReader()
  if (!reader) throw new ProviderError('unknown', 'The provider returned an empty stream.')
  const decoder = new TextDecoder()
  const state: StreamState = { content: '', tools: [] }
  let buffer = ''
  let done = false
  const apply = (event: unknown): void => {
    const failure = streamError(event)
    if (failure) throw new ProviderError('unknown', redact(failure, secrets))
    const before = state.content
    applyStreamEvent(state, event)
    if (state.content !== before) input.onDelta?.(state.content.slice(before.length))
  }
  const onAbort = (): void => { void reader.cancel().catch(() => undefined) }
  input.signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (!done) {
      if (input.signal.aborted) throw new ProviderError('cancelled', 'Stopped.')
      const next = await reader.read()
      if (input.signal.aborted) throw new ProviderError('cancelled', 'Stopped.')
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      if (buffer.length > 2_000_000) throw new ProviderError('unknown', 'The provider stream event exceeded the size limit.')
      const consumed = consumeSseBuffer(buffer)
      buffer = consumed.rest
      done = consumed.done
      for (const event of consumed.events) apply(event)
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      const flushed = consumeSseBuffer(`${buffer}\n\n`)
      done = flushed.done
      for (const event of flushed.events) apply(event)
    }
    if (input.signal.aborted) throw new ProviderError('cancelled', 'Stopped.')
    if (!done && !state.finishReason) {
      throw new ProviderError('unknown', 'The provider stream ended before completion. The reply may be incomplete; no tool actions were executed.')
    }
    const tools = state.tools.filter((tool) => tool?.name).map((tool, index) => ({ ...tool, id: tool.id || `call_${index + 1}` }))
    return { content: state.content, toolCalls: tools, usage: state.usage, finishReason: state.finishReason }
  } finally {
    input.signal.removeEventListener('abort', onAbort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export function providerFailureKind(error: unknown): ProviderErrorKind | null {
  return error instanceof ProviderError ? error.kind : null
}
