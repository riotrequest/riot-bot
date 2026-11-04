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
  const unique = [...new Set(secrets.filter(Boolean))]
  unique.sort((a, b) => b.length - a.length)
  for (const secret of unique) {
    out = secret.length>=6?out.split(secret).join('[redacted]'):out.replace(new RegExp(`(?<![A-Za-z0-9])${secret.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![A-Za-z0-9])`,'g'),'[redacted]')
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

/** Hold known-secret and token prefixes so chunk boundaries cannot expose a secret. */
export class RedactingStream {
  private pending=''
  constructor(private readonly secrets:string[],private readonly emit:(text:string)=>void){}
  push(text:string):void{
    this.pending+=text
    let keep=this.pending.match(/\b(?:sk?(?:-[A-Za-z0-9_-]*)?|B|Be|Bea|Bear|Beare|Bearer(?:\s+[A-Za-z0-9._~+/=-]*)?|(?:api[_-]?key|authorization|access_token|refresh_token|id_token)(?:["']?\s*[=:]\s*["']?[^\s"',}]*)?)$/i)?.[0].length??0
    for(const secret of this.secrets){
      for(let length=Math.min(secret.length,this.pending.length);length>keep;length--){
        if(this.pending.endsWith(secret.slice(0,length))){keep=length;break}
      }
    }
    let cut=this.pending.length-keep
    for(const secret of this.secrets){const index=this.pending.lastIndexOf(secret);if(index>=0&&index<cut&&index+secret.length>cut)cut=index}
    if(cut){this.emit(redact(this.pending.slice(0,cut),this.secrets));this.pending=this.pending.slice(cut)}
  }
  finish():void{
    let text=this.pending
    for(const secret of this.secrets)for(let length=Math.min(secret.length-1,text.length);length>=4;length--)if(text.endsWith(secret.slice(0,length))){text=text.slice(0,-length)+'[redacted]';break}
    if(text)this.emit(redact(text,this.secrets))
    this.pending=''
  }
}

export function looksLikeSecret(text: string, secrets: string[] = []): boolean {
  if (secrets.length && redact(text,secrets)!==redact(text)) return true
  return /sk-[A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=]\s*\S+|bearer\s+[A-Za-z0-9._~+/=-]{8,}|password\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(
    text
  )
}

export function publicErrorMessage(error: unknown, secrets: string[] = []): string {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return redact(message, secrets)
}
