const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Readable folder name. Never a path. Empty and reserved results become "bot". */
export function folderSlug(label: string): string {
  const ascii = label.normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '')
  if (!slug || RESERVED.test(slug)) return 'bot'
  return slug
}

export function fallbackBotName(purpose: string): string {
  const words = purpose
    .replace(/[^a-zA-Z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .join(' ')
  const titled = words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  const name = titled.slice(0, 40).trim()
  return name.length >= 2 ? name : 'Assistant'
}

/** Display names are text. A slash, backslash, or parent-directory segment is rejected. */
export function cleanBotName(value: string): string | null {
  const raw = value.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
  if (raw.length < 2 || raw.length > 40) return null
  if (/[\\/]|\.\./.test(raw)) return null
  return raw
}

export function parseSetupReply(text: string): { name: string; instructions: string } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { name?: unknown; instructions?: unknown }
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.name !== 'string') return null
    const name = cleanBotName(parsed.name)
    if (!name) return null
    const instructions = typeof parsed.instructions === 'string' ? parsed.instructions.trim().slice(0, 4000) : ''
    return { name, instructions }
  } catch {
    return null
  }
}

export const SETUP_PROMPT = `You name a new personal assistant and write its initial instructions.

Reply with JSON only, no Markdown fence:
{"name":"short display name","instructions":"how this assistant should help"}

The name is 2 to 40 characters. It is a display name, not a file path. Do not include slashes, drive letters, or folders.
Instructions are two to four short sentences addressed to the assistant as "you". Give it a distinct voice that fits its purpose: its tone, how long its replies run, and one recognizable habit. Then say what it focuses on. They cannot grant permissions, raise budgets, approve commands, or change application rules.
Do not include secrets.`
