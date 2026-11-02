import type { PublicSettings } from '../shared/types'
import { DEFAULT_SEARCH_TEMPLATE } from './browser-policy'
import { validatePublicUrl } from './web'

export interface Settings extends PublicSettings {
  botId?: string
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  model: '',
  workspacePath: '',
  workspaceEditing: false,
  contextMode: 'automatic',
  contextTokenBudget: 8000,
  modelContextTokens: null,
  maxModelCallsPerTask: 24,
  maxOutputTokens: 2048,
  replyMode: 'automatic',
  maxToolOutputChars: 12_000,
  maxTaskDurationMs: 10 * 60 * 1000,
  maxEstimatedSpendPerTaskUsd: null,
  maxEstimatedSpendPerDayUsd: null,
  inputUsdPerMillion: null,
  outputUsdPerMillion: null,
  botSpendPerDayUsd: null,
  streaming: true,
  toolsEnabled: true,
  pinnedInstructions: '',
  maxFileReadBytes: 200_000,
  webFetchTimeoutMs: 15_000,
  webFetchMaxBytes: 500_000,
  terminalTimeoutMs: 30_000,
  terminalMaxOutputChars: 20_000,
  searchUrlTemplate: DEFAULT_SEARCH_TEMPLATE
}

export interface ModelPrice {
  inputPerMillion: number
  outputPerMillion: number
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function optionalMoney(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new Error('Dollar limits and prices must be blank or a non-negative number.')
  }
  return number
}

export function dollarBudgetEnabled(settings: Settings): boolean {
  return settings.maxEstimatedSpendPerTaskUsd != null || settings.maxEstimatedSpendPerDayUsd != null || settings.botSpendPerDayUsd != null
}

export function knownPricing(settings: Settings): ModelPrice | null {
  if (settings.inputUsdPerMillion == null || settings.outputUsdPerMillion == null) return null
  if (!Number.isFinite(settings.inputUsdPerMillion) || !Number.isFinite(settings.outputUsdPerMillion)) return null
  if (settings.inputUsdPerMillion < 0 || settings.outputUsdPerMillion < 0) return null
  return {
    inputPerMillion: settings.inputUsdPerMillion,
    outputPerMillion: settings.outputUsdPerMillion
  }
}

export function estimateCostUsd(inputTokens: number, outputTokens: number, price: ModelPrice): number {
  return (inputTokens / 1_000_000) * price.inputPerMillion + (outputTokens / 1_000_000) * price.outputPerMillion
}

export function sanitizeSettings(input: Partial<Settings>): Settings {
  const provider = input.provider === 'codex' ? 'codex' : input.provider === 'openrouter' ? 'openrouter' : 'openai'
  const model = String(input.model ?? '').replace(/[\r\n]/g, '').trim().slice(0, 200)
  return {
    provider,
    model,
    workspacePath: String(input.workspacePath ?? '').trim(),
    workspaceEditing: Boolean(input.workspaceEditing),
    contextMode: input.contextMode === 'manual' ? 'manual' : 'automatic',
    contextTokenBudget: finiteNumber(input.contextTokenBudget, DEFAULT_SETTINGS.contextTokenBudget, 500, 200_000),
    modelContextTokens: optionalTokens(input.modelContextTokens),
    maxModelCallsPerTask: Math.round(finiteNumber(input.maxModelCallsPerTask, DEFAULT_SETTINGS.maxModelCallsPerTask, 1, 100)),
    maxOutputTokens: Math.round(finiteNumber(input.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens, 16, 32_000)),
    replyMode: input.replyMode === 'manual' ? 'manual' : 'automatic',
    maxToolOutputChars: Math.round(finiteNumber(input.maxToolOutputChars, DEFAULT_SETTINGS.maxToolOutputChars, 500, 200_000)),
    maxTaskDurationMs: Math.round(finiteNumber(input.maxTaskDurationMs, DEFAULT_SETTINGS.maxTaskDurationMs, 10_000, 2 * 60 * 60 * 1000)),
    maxEstimatedSpendPerTaskUsd: optionalMoney(input.maxEstimatedSpendPerTaskUsd),
    maxEstimatedSpendPerDayUsd: optionalMoney(input.maxEstimatedSpendPerDayUsd),
    inputUsdPerMillion: optionalMoney(input.inputUsdPerMillion),
    outputUsdPerMillion: optionalMoney(input.outputUsdPerMillion),
    botSpendPerDayUsd: optionalMoney(input.botSpendPerDayUsd),
    streaming: input.streaming !== false,
    toolsEnabled: input.toolsEnabled !== false,
    pinnedInstructions: String(input.pinnedInstructions ?? '').slice(0, 8000),
    maxFileReadBytes: Math.round(finiteNumber(input.maxFileReadBytes, DEFAULT_SETTINGS.maxFileReadBytes, 1000, 2_000_000)),
    webFetchTimeoutMs: Math.round(finiteNumber(input.webFetchTimeoutMs, DEFAULT_SETTINGS.webFetchTimeoutMs, 1000, 60_000)),
    webFetchMaxBytes: Math.round(finiteNumber(input.webFetchMaxBytes, DEFAULT_SETTINGS.webFetchMaxBytes, 1000, 2_000_000)),
    terminalTimeoutMs: Math.round(finiteNumber(input.terminalTimeoutMs, DEFAULT_SETTINGS.terminalTimeoutMs, 1000, 120_000)),
    terminalMaxOutputChars: Math.round(
      finiteNumber(input.terminalMaxOutputChars, DEFAULT_SETTINGS.terminalMaxOutputChars, 500, 200_000)
    ),
    searchUrlTemplate: cleanSearchTemplate(input.searchUrlTemplate)
  }
}

function optionalTokens(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 1024 || number > 2_000_000) {
    throw new Error('Model context capacity must be blank or a number from 1024 to 2000000.')
  }
  return Math.round(number)
}

function cleanSearchTemplate(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return DEFAULT_SEARCH_TEMPLATE
  if (!text.includes('{query}') || text.length > 500) return DEFAULT_SEARCH_TEMPLATE
  try {
    const probe = new URL(text.replaceAll('{query}', 'test'))
    if (probe.protocol !== 'https:') return DEFAULT_SEARCH_TEMPLATE
    validatePublicUrl(probe.toString())
  } catch {
    return DEFAULT_SEARCH_TEMPLATE
  }
  return text
}

export function localDay(now: number): string {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Extra margin used only to decide whether a request fits. It is not a provider measurement. */
export const FIT_MARGIN = 1.2

/** Conservative token estimate with headroom. Unknown tokenizers must not be treated as exact. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const byChars = Math.ceil(text.length / 3)
  return Math.max(1, Math.ceil(byChars * 1.15))
}

export function fitTokens(estimate: number): number {
  return Math.ceil(estimate * FIT_MARGIN)
}

/** The input working budget. The reply token limit is not subtracted from it. */
export function inputRoom(contextTokenBudget: number, _maxOutputTokens = 0): number {
  return contextTokenBudget
}

export function estimateMessagesTokens(messages: { content: string; extra?: string; imageTokens?: number }[], reserve = 0): number {
  const body = messages.reduce((sum, message) => sum + estimateTokens(message.content) + estimateTokens(message.extra ?? '') + (message.imageTokens ?? 0) + 8, 0)
  return body + reserve
}
