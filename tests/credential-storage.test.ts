import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tempDir } from './helpers'

const crypto = vi.hoisted(()=>({available:true,fail:false}))
vi.mock('electron',()=>({safeStorage:{
  isAsyncEncryptionAvailable:async()=>crypto.available,
  encryptString:(text:string)=>{if(crypto.fail)throw new Error('Unavailable');return Buffer.from('encrypted:'+text)},
  decryptString:(bytes:Buffer)=>bytes.toString().slice('encrypted:'.length)
}}))
import { ElectronCredentialStore } from '../src/main/credentials'

beforeEach(()=>{crypto.available=true;crypto.fail=false})
describe('persisted credential removal',()=>{
  it.each(['openai','gmail'] as const)('does not restore %s after crypto fallback, removal and restart',async key=>{
    const dir=tempDir(),store=await ElectronCredentialStore.open(dir)
    store.set(key,'old-synthetic-secret')
    store.set('openrouter','other-synthetic-secret')
    crypto.fail=true
    expect(store.set(key,'new-session-only-secret').persistent).toBe(false)
    store.clear(key)
    crypto.fail=false
    const restarted=await ElectronCredentialStore.open(dir)
    expect(restarted.get(key)).toBeNull()
    expect(restarted.get('openrouter')).toBe('other-synthetic-secret')
  })
  it('removes ciphertext without crypto and reports persistent removal failures',async()=>{
    const dir=tempDir(),store=await ElectronCredentialStore.open(dir)
    store.set('gmail','synthetic-token')
    crypto.available=false
    const unavailable=await ElectronCredentialStore.open(dir)
    unavailable.clear('gmail')
    crypto.available=true
    expect((await ElectronCredentialStore.open(dir)).get('gmail')).toBeNull()
    store.set('openai','synthetic-key')
    const write=vi.spyOn(fs,'renameSync').mockImplementation(()=>{throw new Error('Denied')})
    try{expect(()=>store.clear('openai')).toThrow(/could not be updated/)}finally{write.mockRestore()}
    expect((await ElectronCredentialStore.open(dir)).get('openai')).toBe('synthetic-key')
    fs.writeFileSync(path.join(dir,'credentials.bin.json'),'broken')
    expect(()=>store.clear('openai')).toThrow(/could not be read/)
    expect(fs.readFileSync(path.join(dir,'credentials.bin.json'),'utf8')).toBe('broken')
  })
})
