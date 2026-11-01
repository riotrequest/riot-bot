import { describe, expect, it } from 'vitest'
import { classifyProviderFailure, consumeSseBuffer, createOpenAICompatibleProvider, responseFromJson } from '../src/core/provider'
import { MemoryLogger } from '../src/core/logger'

describe('providers', () => {
  it('classifies auth, credit, and streaming usage without logging the key', async () => {
    expect(classifyProviderFailure(401, JSON.stringify({ error: { message: 'Incorrect API key', code: 'invalid_api_key' } })).kind).toBe('auth')
    expect(classifyProviderFailure(429, 'slow down').kind).toBe('transient')
    expect(classifyProviderFailure(402, JSON.stringify({ error: { message: 'Insufficient credits' } })).kind).toBe('credit')
    const { events } = consumeSseBuffer(
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1,"cost":0.02}}\n\n' +
        'data: [DONE]\n\n'
    )
    expect(events).toHaveLength(2)
    expect(responseFromJson({ choices: [{ message: { content: 'Hi' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }).usage?.inputTokens).toBe(3)

    const logger = new MemoryLogger()
    const key = 'sk-test-secret-value'
    const seen: { url?: string; authorization?: string; title?: string }[] = []
    const provider = createOpenAICompatibleProvider({
      name: 'openrouter',
      apiKey: key,
      logger,
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers)
        seen.push({ url: String(url), authorization: headers.get('authorization') ?? '', title: headers.get('x-title') ?? '' })
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'))
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":4,"completion_tokens":2,"cost":0.01}}\n\n')
            )
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
            controller.close()
          }
        })
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
    })
    const result = await provider.complete({
      model: 'custom/model',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
      maxOutputTokens: 32,
      tokenParameter: 'max_completion_tokens',
      signal: new AbortController().signal
    })
    expect(result.content).toBe('Hello')
    expect(result.usage?.reportedCostUsd).toBe(0.01)
    expect(seen[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(seen[0].authorization).toBe(`Bearer ${key}`)
    expect(seen[0].title).toBe('Riot Bot')
    expect(logger.lines.join('\n')).not.toContain(key)

    const openai = createOpenAICompatibleProvider({
      name: 'openai',
      apiKey: key,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: `bad ${key}`, code: 'invalid_api_key' } }), { status: 401 })
    })
    await expect(
      openai.complete({
        model: 'custom/model',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
        maxOutputTokens: 16,
        tokenParameter: 'max_completion_tokens',
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/will not retry/)
  })
})
