import type { LoginDraft, SavedLogin, SavedServerLogin } from '../shared/types'
import type { CredentialStore } from './credentials'
import type { ServerLoginDraft } from './server-logins'
import { ConfigError } from './errors'
import { isId, newId } from './ids'
import { validatePublicUrl } from './web'

export function trustedSite(value: string): string {
  const input=value.trim()
  const url=validatePublicUrl(/^[a-z][a-z0-9+.-]*:/i.test(input)?input:'https://'+input)
  if(url.protocol!=='https:')throw new ConfigError('Save logins and site permissions for HTTPS websites only.')
  return url.origin
}

const MAX_SAVED = 100

/** One bot's password entries in the protected credential store. An unreadable list is reported, never overwritten. */
abstract class ProtectedList<T extends {id:string;password:string}> {
  constructor(private readonly credentials: CredentialStore, private readonly prefix: 'logins'|'server-logins', private readonly noun: string) {}
  protected abstract valid(item: Record<string, unknown>): boolean
  protected entries(botId:string): T[] {
    const text=this.credentials.get(this.key(botId))
    if(!text)return []
    try {
      const data=JSON.parse(text)
      if(!Array.isArray(data)||data.some(item=>!item||typeof item!=='object'||!isId(item.id)||typeof item.password!=='string'||!this.valid(item)))throw new Error()
      return data
    }catch{throw new ConfigError(`This bot’s saved ${this.noun}s could not be read. They were not changed.`)}
  }
  /** Adds the entry, replacing `previous`, and reports whether protected storage kept it. */
  protected put(botId:string,entries:T[],entry:T,previous?:T): boolean {
    if(!previous&&entries.length>=MAX_SAVED)throw new ConfigError(`This bot already has ${MAX_SAVED} saved ${this.noun}s. Remove an unused one first.`)
    return this.credentials.set(this.key(botId),JSON.stringify([...entries.filter(item=>item.id!==entry.id),entry])).persistent
  }
  remove(botId:string,id:string):void{
    const entries=this.entries(botId),next=entries.filter(item=>item.id!==id)
    if(next.length===entries.length)throw new ConfigError(`That ${this.noun} is not saved for this bot.`)
    if(!next.length)this.clear(botId)
    else if(!this.credentials.set(this.key(botId),JSON.stringify(next)).persistent)throw new ConfigError(`This ${this.noun} was removed for this session, but removal could not be saved. Retry when Windows credential protection is available.`)
  }
  clear(botId:string):void{this.credentials.clear(this.key(botId))}
  private key(botId:string): `${'logins'|'server-logins'}:${string}` {
    if(!isId(botId))throw new ConfigError('Choose a bot first.')
    return `${this.prefix}:${botId}`
  }
}

type Login = SavedLogin & {password:string}
export class LoginVault extends ProtectedList<Login> {
  constructor(credentials: CredentialStore) { super(credentials,'logins','login') }
  protected valid(item: Record<string, unknown>): boolean { return typeof item.origin==='string'&&typeof item.username==='string' }
  list(botId:string):SavedLogin[]{return this.entries(botId).map(({password:_password,...view})=>view)}
  save(botId:string,input:LoginDraft): {login:SavedLogin;persistent:boolean} {
    const origin=trustedSite(input.url),username=input.username.trim(),password=input.password
    if(!username||username.length>500||!password||password.length>2000||/[\r\n\0]/.test(username+password))throw new ConfigError('Enter a username and password on one line.')
    const entries=this.entries(botId),previous=entries.find(item=>item.origin===origin&&item.username===username)
    const entry={id:previous?.id??newId(),origin,username,password}
    return {login:{id:entry.id,origin,username},persistent:this.put(botId,entries,entry,previous)}
  }
  get(botId:string,id:string,origin:string):Login {
    const entry=this.entries(botId).find(item=>item.id===id&&item.origin===trustedSite(origin))
    if(!entry)throw new ConfigError('That login is not saved for this bot and this exact HTTPS website.')
    return entry
  }
}

type ServerLogin = SavedServerLogin & {password:string}
/** SSH logins captured from commands the user pasted. Only `run_on_server` reads the password, for the saved host. */
export class ServerLoginVault extends ProtectedList<ServerLogin> {
  constructor(credentials: CredentialStore) { super(credentials,'server-logins','server login') }
  protected valid(item: Record<string, unknown>): boolean { return typeof item.host==='string'&&typeof item.username==='string'&&Number.isInteger(item.port) }
  list(botId:string):SavedServerLogin[]{return this.entries(botId).map(({password:_password,...view})=>view)}
  save(botId:string,input:ServerLoginDraft): {login:SavedServerLogin;persistent:boolean} {
    const entries=this.entries(botId),previous=entries.find(item=>item.host===input.host&&item.port===input.port&&item.username===input.username)
    const entry={id:previous?.id??newId(),host:input.host,port:input.port,username:input.username,password:input.password}
    return {login:{id:entry.id,host:entry.host,port:entry.port,username:entry.username},persistent:this.put(botId,entries,entry,previous)}
  }
  find(botId:string,id:string):ServerLogin|null{return this.entries(botId).find(item=>item.id===id)??null}
}

/** Parse only the user's directly supplied, labelled login. Never call this on reference material. */
export function loginFromMessage(text:string):LoginDraft|null {
  if(/```|^\s*>/m.test(text))return null
  const command=/^(?:(?:please|can you|could you)\s+)*(?:(?:remember|save|use)\s+(?:(?:my|this|these|the)\s+)?(?:login|credentials|sign-in)|sign\s+in|log\s+in|login)\b/i.test(text.trim())
  const structured=/^(?:https?:\/\/\S+\s+)?(?:site|website|url|username|user|email)\s*[:=]/i.test(text.trim())
  if(!command&&!structured)return null
  const url=(text.match(/https?:\/\/[^\s<>"']+/i)?.[0]??text.match(/\b(?:site|website|url)\s*[:=]\s*([^\s,;]+)/i)?.[1])?.replace(/[.,;)]+$/,'')
  const username=text.match(/\b(?:username|user|email)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/i)?.[1]
  const password=text.match(/\b(?:password|passwd|pwd)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/i)?.[1]
  if(!url||!username||!password)return null
  const unquote=(value:string)=>/^["']/.test(value)?value.slice(1,-1):value
  if(unquote(password)==='[redacted]')return null
  return {url,username:unquote(username),password:unquote(password)}
}
