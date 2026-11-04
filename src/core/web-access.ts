import { validatePublicUrl } from './web'

/** Exact public links from user text or public source material, never from private tool results. */
export function publicLinks(text:string):string[]{
  return [...text.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)].slice(0,500).flatMap(match=>{
    try{const url=validatePublicUrl(match[0].replace(/[.,;)\]}]+$/,''));url.hash='';return[url.href]}catch{return []}
  })
}

export function normalizedWebUrl(value:string):URL{if(value.length>8192)throw new Error('That web address is too long.');const url=validatePublicUrl(value);url.hash='';return url}
