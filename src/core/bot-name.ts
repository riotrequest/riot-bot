import { cleanBotName } from './slug'

// A request has to open its sentence, after at most a short greeting or a polite lead-in.
const LEAD = String.raw`^(?:(?:hey|hi|yo|ok(?:ay)?|alright|so|now|actually|also|and|please|pls|from now on)[\s,!.]+)*(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:i(?:['’]d|\s+would)?\s+(?:like|want)\s+you\s+to\s+)?`
// The bot’s own name. "the name" alone usually means a file, field or variable.
const OWN_NAME = String.raw`(?:your|(?:the|this|my)\s+bot(?:['’]s)?)\s+(?:display\s+)?name`
const EXPLICIT = [
  new RegExp(String.raw`${LEAD}(?:change|set|update|make)\s+${OWN_NAME}\s+(?:to|as|into)\s+(.+)$`, 'i'),
  new RegExp(String.raw`${LEAD}rename\s+(?:yourself|(?:the|this|my)\s+bot)(?:\s+(?:to|as))?\s+(.+)$`, 'i'),
  new RegExp(String.raw`${LEAD}(?:call yourself|name yourself|go by the name(?:\s+of)?)\s+(.+)$`, 'i'),
  new RegExp(String.raw`${LEAD}your\s+(?:new\s+(?:display\s+)?name\s+(?:is|should be|will be)|(?:display\s+)?name\s+(?:is now|should be|will be|is going to be))\s+(.+)$`, 'i')
]
const VAGUE = /^(?:something|anything|whatever|a|an|another|some|any|one|better|cooler|new|different|shorter|longer|you|yourself|it)$/i
const PROPER = /^[\p{Lu}\p{Lt}\p{Lo}\p{N}]/u
const CHOOSE = /\b(?:give yourself a (?:new )?name|(?:pick|choose)\s+(?:yourself\s+a\s+(?:new\s+)?name|a\s+(?:new\s+)?name\s+for\s+yourself|your\s+(?:own\s+|new\s+)?name)|name yourself|rename yourself|(?:change|set|update)\s+(?:your|(?:the|this|my)\s+bot(?:['’]s)?)\s+(?:display\s+)?name)\b/i

/**
 * A direct chat request to set this bot’s display name. Quoted or fenced text is not a request.
 * `name` saves immediately, so it needs an unambiguous request and a capitalized or quoted name.
 * A clear request with a vague or lowercase name is `choose`: the model picks one with rename_bot.
 */
export function nameChangeRequest(text: string): { name: string } | { choose: true } | null {
  if (!text || text.length > 400 || /```|^\s*>/m.test(text)) return null
  if (/\b(?:don['’]t|do not|never|stop)\b[\s\S]{0,40}\b(?:change|rename|name)\b/i.test(text)) return null
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).map(item => item.trim()).filter(Boolean)) {
    const found = explicitName(sentence)
    if (found === 'choose') return { choose: true }
    if (found) {
      const name = cleanBotName(found)
      return name ? { name } : null
    }
  }
  return CHOOSE.test(text) ? { choose: true } : null
}

function explicitName(sentence: string): string | 'choose' | null {
  for (const pattern of EXPLICIT) {
    const match = sentence.match(pattern)
    if (!match) continue
    const rest = match[1].trim()
    const name = cleanupName(rest)
    if (!name || VAGUE.test(name.split(/\s+/)[0]) || (!/^["“'‘]/.test(rest) && !PROPER.test(name))) return 'choose'
    return name
  }
  return null
}

function cleanupName(value: string): string {
  const first = value.split(/[.!?\n]/)[0] ?? ''
  const kept: string[] = []
  for (const word of first.replace(/[“”"'‘]/g, '').trim().split(/\s+/).filter(Boolean)) {
    if (/^(?:please|pls|bro|on|here|in|the|app|riot|from|now|and|but|then|so|because|instead|also|for|with|if|when|thanks|thank|ok|okay|lol|right)$/i.test(word) && kept.length) break
    if (!/^[\p{L}\p{N}][\p{L}\p{N}'’.-]{0,30}$/u.test(word)) break
    kept.push(word.replace(/[.,]+$/g, ''))
    if (kept.length === 4) break
  }
  return kept.join(' ')
}
