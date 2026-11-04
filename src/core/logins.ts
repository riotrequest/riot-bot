import type { LoginDraft, SavedLogin } from '../shared/types'
import type { CredentialStore } from './credentials'
import { ConfigError } from './errors'
import { isId, newId } from './ids'
import { validatePublicUrl } from './web'

export function trustedSite(value: string): string {
  const input=value.trim()
  const url=validatePublicUrl(/^[a-z][a-z0-9+.-]*:/i.test(input)?input:'https://'+input)
  if(url.protocol!=='https:')throw new ConfigError('Save logins and site permissions for HTTPS websites only.')
  return url.origin
}

type Login = SavedLogin & {password:string}
export class LoginVault {
  constructor(private readonly credentials: CredentialStore) {}
  private entries(botId:string): Login[] {
    if(!isId(botId))throw new ConfigError('Choose a bot first.')
    const text=this.credentials.get(`logins:${botId}`)
    if(!text)return []
    try {
      const data=JSON.parse(text)
      if(!Array.isArray(data)||data.some(item=>!item||!isId(item.id)||typeof item.origin!=='string'||typeof item.username!=='string'||typeof item.password!=='string'))throw new Error()
      return data
    }catch{throw new ConfigError('This bot’s saved logins could not be read. They were not changed.')}
  }
  list(botId:string):SavedLogin[]{return this.entries(botId).map(({password:_password,...view})=>view)}
  save(botId:string,input:LoginDraft): {login:SavedLogin;persistent:boolean} {
    const origin=trustedSite(input.url),username=input.username.trim(),password=input.password
    if(!username||username.length>500||!password||password.length>2000||/[\r\n\0]/.test(username+password))throw new ConfigError('Enter a username and password on one line.')
    const entries=this.entries(botId),previous=entries.find(item=>item.origin===origin&&item.username===username)
    if(!previous&&entries.length>=100)throw new ConfigError('This bot already has 100 saved logins. Remove an unused one first.')
    const entry={id:previous?.id??newId(),origin,username,password}
    const saved=this.credentials.set(`logins:${botId}`,JSON.stringify([...entries.filter(item=>item.id!==entry.id),entry]))
    return {login:{id:entry.id,origin,username},persistent:saved.persistent}
  }
  get(botId:string,id:string,origin:string):Login {
    const entry=this.entries(botId).find(item=>item.id===id&&item.origin===trustedSite(origin))
    if(!entry)throw new ConfigError('That login is not saved for this bot and this exact HTTPS website.')
    return entry
  }
  remove(botId:string,id:string):void{
    const entries=this.entries(botId),next=entries.filter(item=>item.id!==id)
    if(next.length===entries.length)throw new ConfigError('That login is not saved for this bot.')
    if(!next.length)this.clear(botId)
    else if(!this.credentials.set(`logins:${botId}`,JSON.stringify(next)).persistent)throw new ConfigError('This login was removed for this session, but removal could not be saved. Retry when Windows credential protection is available.')
  }
  clear(botId:string):void{if(!isId(botId))throw new ConfigError('Choose a bot first.');this.credentials.clear(`logins:${botId}`)}
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
