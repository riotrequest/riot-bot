import type { MessageRecord } from './db'
import { fitTokens } from './settings'

/** Preferred fitted input size in automatic mode. Older chat is compacted toward this. It is not a model window. */
export const AUTOMATIC_ASSEMBLY_TARGET = 12_000

/**
 * Used only when no documented or configured model capacity exists.
 * This is not a claim about what any model supports.
 */
export const CONSERVATIVE_FALLBACK_CAPACITY = 32_768

/** Characters of a tool result placed in the next model request. The full text stays stored. */
export const TOOL_PREVIEW_CHARS = 1_600

export const TIGHT_TOOL_PREVIEW_CHARS = 600

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export interface CatalogRow {
  contextTokens: number | null
  source: string
  fetchedAt: number
}

export interface ContextPlan {
  mode: 'automatic' | 'manual'
  /** Documented or user-entered model window. Null when unknown. */
  capacity: number | null
  source: 'provider' | 'configured' | 'fallback' | 'manual'
  /** Fitted input tokens this request may reach. Output reserve is already removed when the mode is automatic. */
  inputCeiling: number
  /** Fitted input tokens automatic mode tries to stay under by compacting older chat. */
  assemblyTarget: number
  outputReserve: number
  fallback: boolean
}

export function outputReserve(maxOutputTokens: number): number {
  return fitTokens(Math.max(0, maxOutputTokens))
}

export function planContext(input: {
  mode: 'automatic' | 'manual'
  contextTokenBudget: number
  maxOutputTokens: number
  configuredCapacity: number | null
  providerCapacity: number | null
}): ContextPlan {
  const reserve = outputReserve(input.maxOutputTokens)
  if (input.mode === 'manual') {
    return {
      mode: 'manual',
      capacity: input.configuredCapacity,
      source: 'manual',
      inputCeiling: input.contextTokenBudget,
      assemblyTarget: input.contextTokenBudget,
      outputReserve: reserve,
      fallback: false
    }
  }
  const capacity = input.configuredCapacity ?? input.providerCapacity
  const source = input.configuredCapacity != null ? 'configured' : capacity != null ? 'provider' : 'fallback'
  const window = capacity ?? CONSERVATIVE_FALLBACK_CAPACITY
  const usable = Math.max(0, window - reserve)
  return {
    mode: 'automatic',
    capacity,
    source,
    inputCeiling: usable,
    assemblyTarget: Math.min(usable, AUTOMATIC_ASSEMBLY_TARGET),
    outputReserve: reserve,
    fallback: capacity == null
  }
}

export function catalogIsFresh(row: CatalogRow, now: number): boolean {
  const age = now - row.fetchedAt
  if (row.contextTokens != null) return age < WEEK_MS
  return age < DAY_MS
}

export function continuityExcerpt(summary: string, maxChars = 900): string {
  const text = summary.trim()
  if (!text) return ''
  const labeled = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(objective|decisions|constraints|unfinished|preferences)\b/i.test(line))
  const chosen = (labeled.length > 0 ? labeled.join('\n') : text).trim()
  if (chosen.length <= maxChars) return chosen
  return `${chosen.slice(0, maxChars).trim()}…`
}

export function previewToolContent(message: Pick<MessageRecord, 'role' | 'content' | 'toolCallId' | 'id'>, limit?: number): string {
  if (message.role !== 'tool' || !limit || message.content.length <= limit) return message.content
  const id = message.toolCallId || message.id
  return `${message.content.slice(0, limit)}\n\n[${message.content.length} characters are stored locally. Call read_tool_result with id ${id} to read another section. The omitted text was not sent.]`
}

export type ToolGroupName = 'files' | 'terminal' | 'browser' | 'schedules' | 'email'

export function selectToolGroups(text: string, browserOpen: boolean, extra: Iterable<string>): ToolGroupName[] {
  const hay = text.toLowerCase()
  const enabled = new Set(extra)
  const groups: ToolGroupName[] = []
  if (enabled.has('files') || /\b(file|folder|code|edit|workspace|readme|src|html|css|javascript|typescript|python|project|repo)\b/.test(hay) || /\b(build|create|redesign|develop|update|fix)\b.{0,80}\b(website|site|page|app)\b/.test(hay)) groups.push('files')
  if (enabled.has('terminal') || /\b(terminal|command|shell|powershell|npm|git)\b/.test(hay)) groups.push('terminal')
  if (enabled.has('browser') || browserOpen || /\b(browser|click|tab|website|web page|open the|open a|open this|logins?|log[ -]in(?:to)?|sign[ -]in(?:to)?|saved credentials)\b/.test(hay)) groups.push('browser')
  if (enabled.has('schedules') || /\b(remind|reminder|schedule|scheduled|routine|recurring|every|each|daily|weekly|weekdays|tomorrow|tonight)\b/.test(hay)) groups.push('schedules')
  if (enabled.has('email') || /\b(email|emails|e-mail|gmail|inbox|mailbox|recipient|unread)\b/.test(hay) || (/\brepl(?:y|ies)\b/.test(hay) && /\b(automatic(?:ally)?|yourself|on its own|without asking|rule)\b/.test(hay))) groups.push('email')
  return groups
}

export async function lookupProviderContext(input: {
  provider: 'openai' | 'openrouter'
  model: string
  fetchImpl: typeof fetch
  signal?: AbortSignal
}): Promise<{ contextTokens: number | null; maxOutputTokens?: number; source: 'provider' | 'unavailable' }> {
  if (input.provider !== 'openrouter' || !input.model.trim()) return { contextTokens: null, source: 'unavailable' }
  const timeout = AbortSignal.timeout(10_000)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  const response = await input.fetchImpl('https://openrouter.ai/api/v1/models', { signal })
  if (!response.ok) return { contextTokens: null, source: 'unavailable' }
  const body = (await response.json()) as { data?: { id?: string; context_length?: number; top_provider?: { max_completion_tokens?: number } }[] }
  const match = body.data?.find((item) => item.id === input.model)
  const length = match?.context_length
  const output = match?.top_provider?.max_completion_tokens
  const cap = typeof output === 'number' && Number.isFinite(output) && output >= 16 ? { maxOutputTokens: Math.floor(output) } : {}
  if (typeof length !== 'number' || !Number.isFinite(length) || length < 1024) return { contextTokens: null, source: 'unavailable' }
  return { contextTokens: Math.round(length), source: 'provider', ...cap }
}
