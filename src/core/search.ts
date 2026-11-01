export function toFtsQuery(raw: string): string | null {
  return ftsTerms(raw, ' AND ')
}

export function toFtsOrQuery(raw: string): string | null {
  return ftsTerms(raw, ' OR ')
}

function ftsTerms(raw: string, joiner: string): string | null {
  const terms = raw.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu)
  if (!terms || terms.length === 0) return null
  return [...new Set(terms)].slice(0, 8).map((term) => `"${term.replaceAll('"', '')}"`).join(joiner)
}

export function snippetAround(content: string, query: string, radius = 160): string {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []
  const lower = content.toLowerCase()
  let index = -1
  for (const term of terms) {
    index = lower.indexOf(term)
    if (index >= 0) break
  }
  if (index < 0) {
    return content.length > radius * 2 ? `${content.slice(0, radius * 2)}…` : content
  }
  const start = Math.max(0, index - radius)
  const end = Math.min(content.length, index + radius)
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`
}
