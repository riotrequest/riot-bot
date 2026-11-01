import { looksLikeSecret } from './redact'

export function memoryRejection(content: string, secrets: string[] = []): string | null {
  const trimmed = content.trim()
  if (trimmed.length < 3) return 'That memory is empty.'
  if (trimmed.length > 2000) return 'That memory is too long. Keep it to a short confirmed fact.'
  if (looksLikeSecret(trimmed, secrets)) {
    return 'That matches a common secret pattern, so it was not saved. This check does not catch every secret. Remove the secret and ask again if the rest is worth keeping.'
  }
  return null
}

export function explicitRemember(userText: string, previous: string | null): string | null {
  const trimmed = userText.trim()
  const labeled = trimmed.match(/^(?:please\s+)?remember(?:\s+this|\s+that)?\s*:\s*(.+)$/is)
  if (labeled?.[1]) return labeled[1].trim()
  if (/^(?:please\s+)?remember(?:\s+this|\s+that)?[.!]?$/i.test(trimmed)) return previous?.trim() || null
  const inline = trimmed.match(/^(?:please\s+)?remember(?:\s+this|\s+that)?\s+(.+)$/is)
  if (inline?.[1]) return inline[1].trim()
  return null
}
