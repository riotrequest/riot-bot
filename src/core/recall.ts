import type { MemoryRecord } from './db'

/**
 * Memory recall for one bot. The latest message picks candidate memories. When it points back to
 * earlier work ("the same setup as last time"), the recent conversation and the active project
 * decide which candidate it means, or show that the reference is ambiguous. Everything here is
 * local SQLite search and counting: no model call, and the caller scopes the search to one bot.
 */

/** Words that name nothing on their own. Reference words ("same", "last", "again") are included: they say that the user means earlier work, not which work. */
const STOP = new Set(
  ('a about after again all also am an and any are as at back be been before being but by can could did do does done for from get go going got had has have he her here hey hi him his how i if in into is it its just last let lets like me more my need no not now of off ok okay on once one only or our out over please previous previously same see she should so some still such sure than thank thanks that the their them then there these they thing this those time to too up us use used using usual very want was way we were what when where which while who why will with would yes yet you your')
    .split(' ')
)

/** Phrases that refer to earlier specifics instead of naming them. "Thanks again" is not one. */
const FOLLOW_UP = [
  /\bsame\s+(?:\w+\s+)?(?:as|way|setup|set-up|steps|settings|config(?:uration)?|approach|process|format|template|stack|options|plan|thing|one|again)\b/i,
  /\b(?:as|like)\s+(?:last\s+time|before|usual|previously|we\s+(?:did|discussed|agreed|decided|said)|you\s+did)\b/i,
  /\blast\s+time\b|\bthe\s+usual\b|\bthe\s+(?:old|previous)\s+(?:setup|config|settings|way|approach|plan)\b/i,
  /\bwe\s+(?:used|agreed\s+on|decided\s+on|settled\s+on|set\s+up)\b/i,
  /\b(?:do|run|deploy|build|ship|publish|send|repeat|set\s+(?:it|that|this)\s+up)\b(?:\s+[\w'’-]+){0,3}\s+again\b/i
]

const SUFFIXES = ['ments', 'ment', 'ings', 'ing', 'ations', 'ation', 'ions', 'ion', 'ences', 'ence', 'ances', 'ance', 'ed', 'es', 's']
/** Candidates read per recall. Small, because each bot's memory list is short notes. */
const CANDIDATES = 25
const MAX_TERMS = 40

export interface RecallContext {
  /** The newest user message. */
  latest: string
  /** Earlier user and assistant messages from this conversation, oldest first. Leave out tool output. */
  recent: string[]
  /** What the bot is working on now, such as the summary's objective and the workspace folder name. */
  project: string[]
}

/** How a follow-up resolved. `none` means the latest message names its own subject. */
export type RecallReference = 'none' | 'resolved' | 'ambiguous' | 'missing'

export interface Recall {
  /** Unpinned memories for the request, best first. Pinned memories are always sent separately. */
  memories: MemoryRecord[]
  reference: RecallReference
  /** The memories a follow-up points to: one when resolved, the close candidates when ambiguous. These can be pinned. */
  ids: string[]
}

/** Runs an FTS5 expression against this bot's memories, best match first, scoped before the limit. */
export type MemorySearch = (match: string, limit: number) => MemoryRecord[]

interface Term { text: string; prefix: boolean }

export function refersBack(text: string): boolean {
  return FOLLOW_UP.some(pattern => pattern.test(text))
}

export function recallMemories(search: MemorySearch, context: RecallContext, limit = 5): Recall {
  const focus = terms(context.latest)
  if (!refersBack(context.latest)) {
    const memories = focus.length ? search(ftsQuery(focus), CANDIDATES).filter(memory => !memory.pinned).slice(0, limit) : []
    return { memories, reference: 'none', ids: [] }
  }

  // Context terms carry weight by how close they are to the latest message. Terms already in it count only as focus.
  const weights = new Map<string, { term: Term; weight: number }>()
  const known = new Set(focus.map(term => term.text))
  const add = (text: string, weight: number): void => {
    for (const term of terms(text.slice(0, 1200))) {
      if (known.has(term.text) || (weights.get(term.text)?.weight ?? 0) >= weight) continue
      weights.set(term.text, { term, weight })
    }
  }
  const recent = context.recent.filter(text => text.trim()).slice(-6)
  recent.forEach((text, index) => add(text, index >= recent.length - 2 ? 2 : 1))
  for (const text of context.project) add(text, 1)
  const evidence = [...weights.values()].sort((a, b) => b.weight - a.weight).slice(0, Math.max(0, MAX_TERMS - focus.length))

  const query = [...focus, ...evidence.map(item => item.term)]
  const found = query.length ? search(ftsQuery(query), CANDIDATES) : []
  if (!found.length) return { memories: [], reference: 'missing', ids: [] }

  const words = found.map(memory => new Set(tokens(memory.content)))
  const matching = (index: number, term: Term): boolean => [...words[index]].some(word => (term.prefix ? word.startsWith(term.text) : word === term.text))
  // A term found in fewer candidates tells them apart better.
  const rarity = new Map(query.map(term => [term.text, 1 / Math.max(1, found.filter((_, index) => matching(index, term)).length)]))
  const scored = found.map((memory, index) => ({
    memory,
    anchor: focus.reduce((sum, term) => sum + (matching(index, term) ? rarity.get(term.text)! : 0), 0),
    support: evidence.reduce((sum, item) => sum + (matching(index, item.term) ? item.weight * rarity.get(item.term.text)! : 0), 0)
  }))

  // With subject words ("the same setup"), only memories about that subject compete. Without them ("do it again"), any match can.
  const competing = focus.length ? scored.filter(item => item.anchor > 0) : scored
  if (!competing.length) return { memories: [], reference: 'missing', ids: [] }
  competing.sort((a, b) => b.support - a.support || b.anchor - a.anchor)
  const [top, next] = competing
  const others = scored.filter(item => !competing.includes(item)).sort((a, b) => b.anchor * 3 + b.support - (a.anchor * 3 + a.support))
  const unpinned = (items: typeof scored): MemoryRecord[] => items.map(item => item.memory).filter(memory => !memory.pinned).slice(0, limit)

  if (!next || (top.support > 0 && top.support >= 2 * next.support)) {
    // A clear match. Leave out the competitors it beat, so the request does not invite a guess between them.
    return { memories: unpinned([top, ...others]), reference: 'resolved', ids: [top.memory.id] }
  }
  const close = competing.filter(item => item.support * 2 >= top.support).slice(0, 3)
  return { memories: unpinned([...close, ...others]), reference: 'ambiguous', ids: close.map(item => item.memory.id) }
}

/** Guidance for the model about a follow-up. It names memory ids only; memory text stays in the untrusted notes block. */
export function recallNote(recall: Recall, historyTool = 'search_history'): string {
  switch (recall.reference) {
    case 'resolved':
      return `The user is referring back to earlier work. Memory ${recall.ids[0]} best matches the recent conversation. If it fits, reuse it and say in a few words which earlier setup you are following. If it does not fit, ask.`
    case 'ambiguous':
      return `The user is referring back to earlier work, and memories ${recall.ids.join(', ')} fit about equally. The conversation does not settle which one they mean. Before acting, ask one short question that names the options. Do not guess.`
    case 'missing':
      return `The user is referring back to earlier work, but no saved memory matches it. Use the recent conversation, or ${historyTool} for older originals. If those do not settle it, ask instead of guessing.`
    default:
      return ''
  }
}

/** The lines of a conversation summary that describe the active work. */
export function summaryFocus(summary: string): string {
  const lines = summary.split('\n').filter(line => /^\s*(?:objective|unfinished)\s*:/i.test(line))
  return (lines.length ? lines.join('\n') : summary).slice(0, 600)
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function terms(text: string): Term[] {
  const seen = new Map<string, Term>()
  for (const word of tokens(text)) {
    if (word.length < 2 || STOP.has(word)) continue
    const stem = stemOf(word)
    const term = stem.length >= 4 ? { text: stem, prefix: true } : { text: word, prefix: false }
    if (!seen.has(term.text)) seen.set(term.text, term)
  }
  return [...seen.values()]
}

/** A light English stem, matched as a prefix, so "preference" finds "prefer" and "deployment" finds "deploy". */
function stemOf(word: string): string {
  for (const suffix of SUFFIXES) if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length)
  return word
}

function ftsQuery(query: Term[]): string {
  return query.slice(0, MAX_TERMS).map(term => `"${term.text}"${term.prefix ? '*' : ''}`).join(' OR ')
}
