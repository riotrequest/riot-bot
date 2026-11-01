const LABELS: Record<string, string> = {
  '👀': 'Eyes',
  '👍': 'Thumbs up',
  '👎': 'Thumbs down',
  '❤️': 'Heart',
  '❤': 'Heart',
  '😂': 'Face with tears of joy',
  '🎉': 'Party popper',
  '✅': 'Check mark',
  '🔥': 'Fire',
  '🙏': 'Thank you'
}

/** One emoji, not a sentence and not HTML. Phrases are not mapped to emoji here. */
export function acceptReactionEmoji(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 16) return null
  if (/[<>&A-Za-z0-9\s]/.test(trimmed)) return null
  const chars = [...trimmed]
  if (chars.length < 1 || chars.length > 4) return null
  if (!chars.some((char) => (char.codePointAt(0) ?? 0) > 127)) return null
  return trimmed
}

export function reactionLabel(emoji: string): string {
  const base = emoji.replace(/\uFE0F/g, '')
  return LABELS[emoji] ?? LABELS[base] ?? 'Emoji reaction'
}
