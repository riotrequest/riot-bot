const KEY_PATTERNS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(api[_-]?key\s*[=:]\s*)([^\s"',]+)/gi,
  /(authorization\s*[=:]\s*)([^\s"',]+)/gi,
  /((?:access_token|refresh_token|id_token)["']?\s*[=:]\s*["']?)([^\s"',}]+)/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
]

export function redact(text: string, secrets: string[] = []): string {
  let out = text
  const unique = [...new Set(secrets.map((secret) => secret.trim()).filter((secret) => secret.length >= 6))]
  unique.sort((a, b) => b.length - a.length)
  for (const secret of unique) {
    out = out.split(secret).join('[redacted]')
  }
  for (const pattern of KEY_PATTERNS) {
    out = out.replace(pattern, (match, prefix: string | undefined) => {
      if (typeof prefix === 'string' && match.startsWith(prefix)) return `${prefix}[redacted]`
      if (/^bearer\s+/i.test(match)) return 'Bearer [redacted]'
      if (match.includes('PRIVATE KEY')) return '[redacted key block]'
      return '[redacted]'
    })
  }
  return out
}

export function looksLikeSecret(text: string, secrets: string[] = []): boolean {
  if (secrets.some((secret) => secret.length >= 6 && text.includes(secret))) return true
  return /sk-[A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=]\s*\S+|bearer\s+[A-Za-z0-9._~+/=-]{8,}|password\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(
    text
  )
}

export function publicErrorMessage(error: unknown, secrets: string[] = []): string {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return redact(message, secrets)
}
