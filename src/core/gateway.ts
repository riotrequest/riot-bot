import type { ContextView } from '../shared/types'
import { IMAGE_TOKEN_RESERVE } from './attachments'
import type { Database } from './db'
import { AppError, ConfigError, LimitError, PauseError, ProviderError, StopError } from './errors'
import { newId } from './ids'
import type { Logger } from './logger'
import type { ChatMessage, ModelProvider, ModelResponse, ToolDefinition } from './model'
import { redact } from './redact'
import { dollarBudgetEnabled, estimateCostUsd, estimateMessagesTokens, estimateTokens, fitTokens, knownPricing, localDay, type Settings } from './settings'

export interface GatewayInput {
  runId: string
  purpose: 'chat' | 'tool_continuation' | 'reply_continuation' | 'compaction' | 'bot_setup'
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  signal: AbortSignal
  onDelta?: (text: string) => void
  context?: ContextView | null
  /** When set, the 8,000 input budget is not a second ceiling. Output reserve is already reflected in an automatic input ceiling. */
  contextFit?: { mode: 'automatic' | 'manual'; inputCeiling: number; outputReserve: number; capacity: number | null }
  maxOutputTokens?: number
  maxModelCalls?: number
  stream?: boolean
}

interface Begun {
  requestId: string
  inputTokens: number
  reservedUsd: number
  price: ReturnType<typeof knownPricing>
  maxOutput: number
}

export class Gateway {
  constructor(
    private readonly deps: {
      db: Database
      provider: () => ModelProvider
      getSettings: () => Settings
      now: () => number
      secrets: () => string[]
      logger: Logger
    }
  ) {}

  async request(input: GatewayInput): Promise<ModelResponse> {
    const settings = this.deps.getSettings()
    if (!settings.model.trim()) throw new ConfigError('Enter a model ID in Settings. Riot Bot does not choose one for you.')
    let stream = input.stream ?? settings.streaming
    let tokenParameter: 'max_completion_tokens' | 'max_tokens' = 'max_completion_tokens'
    let parameterFallback = false
    let streamFallback = false
    let transientRetries = 0
    let attempt = 1

    while (true) {
      if (input.signal.aborted) throw new StopError('Stopped before the next model request was sent.')
      let begun: Begun | null = null
      let receivedDelta = false
      try {
        begun = this.begin(input, settings, attempt)
        const response = await this.deps.provider().complete({
          model: settings.model,
          messages: input.messages,
          tools: input.purpose === 'bot_setup' ? undefined : settings.toolsEnabled ? input.tools : undefined,
          stream,
          maxOutputTokens: begun.maxOutput,
          tokenParameter,
          signal: input.signal,
          onDelta: (text) => {
            if (text) receivedDelta = true
            input.onDelta?.(text)
          }
        })
        if (input.signal.aborted) throw new ProviderError('cancelled', 'Stopped.')
        this.succeed(begun, response, input.context ?? null)
        this.deps.logger.info('model finished', {
          runId: input.runId,
          purpose: input.purpose,
          outcome: response.finishReason === 'length' ? 'truncated' : 'completed',
          provider: this.deps.provider().name,
          model: settings.model
        })
        return response
      } catch (error) {
        if (!begun || error instanceof AppError) throw error
        const providerError =
          input.signal.aborted
            ? new ProviderError('cancelled', 'Stopped.')
            : error instanceof ProviderError
            ? error
            : new ProviderError('unknown', error instanceof Error ? error.message : 'The model request failed.')
        const beforeSend = providerError.kind === 'cancelled' && providerError.message.includes('before the request was sent')
        this.fail(begun, providerError, beforeSend)
        this.deps.logger.error('model failed', {
          runId: input.runId,
          purpose: input.purpose,
          outcome: providerError.kind,
          provider: this.deps.provider().name,
          model: settings.model
        })
        if (providerError.kind === 'cancelled') {
          throw new StopError(
            beforeSend
              ? 'Stopped before the next model request was sent.'
              : 'Stopped. Work already sent to the provider may still be billed.'
          )
        }
        if (providerError.kind === 'auth' || providerError.kind === 'credit' || providerError.kind === 'context_limit') throw providerError
        if (providerError.kind === 'unsupported_tools') {
          throw new PauseError(`This model does not support tools. Turn off tools in Settings or choose another model. ${providerError.message}`)
        }
        if (providerError.kind === 'unsupported_parameter' && !parameterFallback) {
          parameterFallback = true
          tokenParameter = 'max_tokens'
          attempt += 1
          continue
        }
        if (providerError.kind === 'unsupported_stream' && stream && !streamFallback) {
          streamFallback = true
          stream = false
          attempt += 1
          continue
        }
        if (providerError.kind === 'transient' && !receivedDelta && transientRetries < 2) {
          transientRetries += 1
          attempt += 1
          if (input.signal.aborted) throw new StopError('Stopped. Work already sent to the provider may still be billed.')
          continue
        }
        throw providerError
      }
    }
  }

  private begin(input: GatewayInput, settings: Settings, attempt: number): Begun {
    const toolReserve =
      settings.toolsEnabled && input.tools && input.tools.length > 0 ? estimateTokens(JSON.stringify(input.tools)) : 0
    const inputTokens = estimateMessagesTokens(
      input.messages.map((message) => ({
        content: message.content,
        extra: message.toolCalls ? JSON.stringify(message.toolCalls) : '',
        imageTokens: (message.images?.length ?? 0) * IMAGE_TOKEN_RESERVE
      })),
      toolReserve
    )
    return this.deps.db.transaction(() => {
      const run = this.deps.db.getRun(input.runId)
      if (!run || run.status !== 'running' || run.stopRequested) throw new StopError('Stopped before the next model request was sent.')
      if (run.trigger !== 'user_message' && run.trigger !== 'provider_check' && run.trigger !== 'bot_setup') {
        throw new PauseError('Blocked a model call that was not started by a message you sent.')
      }
      const now = this.deps.now()
      const maxOutput = Math.min(settings.maxOutputTokens, input.maxOutputTokens ?? settings.maxOutputTokens)
      const maxCalls = Math.min(settings.maxModelCallsPerTask, input.maxModelCalls ?? settings.maxModelCallsPerTask)
      if (now - run.startedAt > settings.maxTaskDurationMs) {
        throw new LimitError('This task reached its time limit. Send another message when you want to continue.')
      }
      if (run.modelCalls >= maxCalls) {
        throw new LimitError(
          `This task reached its limit of ${maxCalls} model calls. Compaction, retries, and tool follow-ups all count toward that limit.`
        )
      }
      const fitted = fitTokens(inputTokens)
      if (input.contextFit) {
        if (fitted > input.contextFit.inputCeiling) {
          throw new PauseError(
            input.contextFit.mode === 'manual'
              ? 'This request does not fit the input working budget, so it was not sent. Open Settings and raise the input working budget. The original conversation is still saved.'
              : 'This request does not fit the model context after automatic fitting, so it was not sent. The original conversation is still saved. This is not a spending limit.'
          )
        }
        if (input.contextFit.mode === 'manual' && input.contextFit.capacity != null && fitted + input.contextFit.outputReserve > input.contextFit.capacity) {
          throw new PauseError(
            `This request plus the reserved reply tokens would exceed the model context capacity of ${input.contextFit.capacity}. Lower the reply token limit or choose a model with a larger documented context. This is not a spending limit.`
          )
        }
      } else if (fitted > settings.contextTokenBudget) {
        throw new PauseError(
          'This request does not fit the input working budget, so it was not sent. Open Settings and raise the input working budget. The original conversation is still saved.'
        )
      } else if (settings.modelContextTokens != null && fitted + fitTokens(maxOutput) > settings.modelContextTokens) {
        throw new PauseError(
          `This request plus the reserved reply tokens would exceed the model context capacity of ${settings.modelContextTokens}. Open Settings and raise that capacity or lower the reply token limit. Nothing was sent.`
        )
      }
      const price = knownPricing(settings)
      if (dollarBudgetEnabled(settings) && !price) {
        throw new LimitError(
          'Dollar limits are on, but this model has no price entered. Add an input price and an output price per million tokens, or turn the dollar limits off. Call and token limits still work without prices.'
        )
      }
      const reservedUsd = price ? estimateCostUsd(inputTokens, maxOutput, price) : 0
      const day = localDay(now)
      if (dollarBudgetEnabled(settings) && price) {
        if (
          settings.maxEstimatedSpendPerTaskUsd != null &&
          this.deps.db.sumSpend({ runId: input.runId }) + reservedUsd > settings.maxEstimatedSpendPerTaskUsd
        ) {
          throw new LimitError('This task would pass its estimated spend limit, so the request was not sent. This is an estimate, not the provider invoice.')
        }
        if (settings.maxEstimatedSpendPerDayUsd != null && this.deps.db.sumSpend({ day }) + reservedUsd > settings.maxEstimatedSpendPerDayUsd) {
          throw new LimitError('This request would pass today’s estimated spend limit, so it was not sent. This is an estimate, not the provider invoice.')
        }
        if (
          settings.botSpendPerDayUsd != null &&
          settings.botId &&
          this.deps.db.sumSpend({ day, botId: settings.botId }) + reservedUsd > settings.botSpendPerDayUsd
        ) {
          throw new LimitError('This request would pass this bot’s estimated daily limit, so it was not sent. The app-wide ceiling still applies to every bot.')
        }
      }
      const requestId = newId()
      this.deps.db.insertModelRequest({
        id: requestId,
        runId: input.runId,
        trigger: run.trigger,
        purpose: input.purpose,
        provider: this.deps.provider().name,
        model: settings.model,
        startedAt: now,
        attempt,
        day,
        reservedUsd: price ? reservedUsd : null,
        contextJson: input.context ? JSON.stringify(input.context) : null
      })
      if (price) {
        this.deps.db.insertReservation({ id: newId(), runId: input.runId, requestId, day, reservedUsd, createdAt: now })
      }
      this.deps.db.incrementModelCalls(input.runId)
      return { requestId, inputTokens, reservedUsd, price, maxOutput }
    })
  }

  private succeed(begun: Begun, response: ModelResponse, context: ContextView | null): void {
    const outputText = `${response.content}${response.toolCalls.map((call) => `${call.name}${call.arguments}`).join('')}`
    const reportedIn = response.usage?.inputTokens
    const reportedOut = response.usage?.outputTokens
    const inputTokens = reportedIn ?? begun.inputTokens
    const outputTokens = reportedOut ?? estimateTokens(outputText)
    const tokenSource = reportedIn != null || reportedOut != null ? 'reported' : 'estimated'
    const estimated = begun.price ? estimateCostUsd(inputTokens, outputTokens, begun.price) : null
    const reported = response.usage?.reportedCostUsd
    const costLabel = reported != null ? 'reported' : estimated != null ? 'estimated' : 'unknown'
    if (begun.price) {
      this.deps.db.settleReservation(begun.requestId, reported ?? estimated ?? begun.reservedUsd, costLabel === 'unknown' ? 'estimated' : costLabel)
    }
    if (context) {
      this.deps.db.updateRequestContext(
        begun.requestId,
        JSON.stringify({ ...context, reportedInputTokens: response.usage?.inputTokens ?? null })
      )
    }
    this.deps.db.finishModelRequest(begun.requestId, {
      endedAt: this.deps.now(),
      outcome: response.finishReason === 'length' ? 'truncated' : 'completed',
      inputTokens,
      outputTokens,
      cacheTokens: response.usage?.cacheTokens ?? null,
      tokenSource,
      estimatedCostUsd: estimated,
      reportedCostUsd: reported ?? null,
      costLabel,
      error: null
    })
  }

  private fail(begun: Begun, error: ProviderError, beforeSend: boolean): void {
    const message = redact(error.message, this.deps.secrets()).slice(0, 600)
    let settled = 0
    let costLabel = 'unknown'
    if (!begun.price || beforeSend) {
      this.deps.db.releaseReservation(begun.requestId)
      costLabel = beforeSend ? 'released' : 'unknown'
    } else if (error.kind === 'auth' || error.kind === 'credit') {
      settled = 0
      costLabel = 'estimated'
      this.deps.db.settleReservation(begun.requestId, settled, costLabel)
    } else if (error.kind === 'context_limit') {
      settled = estimateCostUsd(begun.inputTokens, 0, begun.price)
      costLabel = 'estimated'
      this.deps.db.settleReservation(begun.requestId, settled, costLabel)
    } else {
      settled = begun.reservedUsd
      costLabel = 'estimated'
      this.deps.db.settleReservation(begun.requestId, settled, costLabel)
    }
    this.deps.db.finishModelRequest(begun.requestId, {
      endedAt: this.deps.now(),
      outcome: beforeSend ? 'cancelled' : error.kind,
      inputTokens: begun.inputTokens,
      outputTokens: 0,
      cacheTokens: null,
      tokenSource: 'estimated',
      estimatedCostUsd: begun.price ? settled : null,
      reportedCostUsd: null,
      costLabel,
      error: message
    })
  }
}
