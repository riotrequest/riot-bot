import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { RiotService } from '../src/core/service'
import { MockProvider } from '../src/core/provider'
import { MemoryCredentialStore } from '../src/core/credentials'
import { StopError } from '../src/core/errors'
import { removeBotFiles } from '../src/core/bot-data'
import { tempDir, waitFor } from './helpers'

function setup(dbPath = path.join(tempDir(),'riot.sqlite')) {
  const provider=new MockProvider(),credentials=new MemoryCredentialStore()
  const app=new RiotService({dbPath,workspaceRoot:path.join(path.dirname(dbPath),'projects'),provider,credentials})
  app.boot()
  return {app,provider,credentials,dir:path.dirname(dbPath),dbPath}
}
async function makeBot(app: RiotService,name: string) {
  return app.createBot({name,purpose:'Deletion verification',provider:'openai',model:'fixture',workspaceKind:'suggested',workspacePath:'',avatarKind:'builtin',avatarValue:'spark',avatarBackground:'#d4544a'})
}

describe('deleting a bot',()=>{
  it('requires the selected bot and exact confirmation name, and refuses active work',async()=>{
    const {app,provider}=setup()
    try {
      const a=await makeBot(app,'Delete candidate'),b=await makeBot(app,'Other bot')
      await expect(app.deleteBot(a.bot.id,a.bot.name)).rejects.toThrow(/Select the bot/)
      app.selectBot(a.bot.id)
      await expect(app.deleteBot(a.bot.id,'wrong name')).rejects.toThrow(/exact name/)
      provider.handler=input=>new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new StopError('Stopped')),{once:true}))
      app.queueMessage(a.conversation.id,'Hold this job')
      await waitFor(()=>provider.calls.length===1)
      await expect(app.deleteBot(a.bot.id,a.bot.name)).rejects.toThrow(/Stop this bot/)
      expect(app.getSnapshot().bots.map(bot=>bot.id)).toEqual(expect.arrayContaining([a.bot.id,b.bot.id]))
    } finally {await app.close()}
  })

  it('removes only owned data and queued work while retaining the project, credentials and other bots',async()=>{
    const {app,provider,credentials,dir,dbPath}=setup()
    try {
      credentials.set('openai','fixture-shared-key')
      const a=await makeBot(app,'Disposable'),other=await makeBot(app,'Keep me')
      app.selectBot(a.bot.id)
      fs.writeFileSync(path.join(a.bot.workspacePath,'keep.txt'),'Project files stay')
      provider.handler=input=>input.messages.at(-1)?.role==='tool' ? {content:'Saved the fixture memory and file.',toolCalls:[]} : {content:'',toolCalls:[
        {id:'memory',name:'save_memory',arguments:'{"content":"Deletion fixture memory","kind":"project"}'},
        {id:'file',name:'write_file',arguments:'{"path":"result.txt","content":"Owned file result"}'}
      ]}
      await app.sendMessage(a.conversation.id,'Remember this and write a project file')
      await waitFor(()=>!app.getSnapshot().runningBotIds?.length)
      app.saveSkill({name:'Disposable skill',description:'A saved procedure',procedure:'Read the project, then report the result.',pitfalls:'',verification:''})
      const attached=app.stageAttachments([{name:'draft.txt',bytes:Buffer.from('queued attachment')}],a.bot.id)[0]
      const queued=app.queueMessage(a.conversation.id,'Queued work to discard',[attached.id])
      for(const folder of ['browser-profiles','artifacts']) {
        fs.mkdirSync(path.join(dir,folder,a.bot.id),{recursive:true})
        fs.writeFileSync(path.join(dir,folder,a.bot.id,'owned.txt'),'Owned bot data')
        fs.mkdirSync(path.join(dir,folder,other.bot.id),{recursive:true})
        fs.writeFileSync(path.join(dir,folder,other.bot.id,'keep.txt'),'Other bot data')
      }
      fs.mkdirSync(path.join(dir,'avatars'));fs.writeFileSync(path.join(dir,'avatars',`${a.bot.id}.png`),'avatar fixture')
      const result=await app.deleteBot(a.bot.id,a.bot.name)
      expect(result.cleanupWarning).toBeNull()
      expect(result.snapshot.bot?.id).not.toBe(a.bot.id)
      expect(result.snapshot.bots.some(bot=>bot.id===other.bot.id)).toBe(true)
      expect(app.listJobs('app').some(job=>job.id===queued.id)).toBe(false)
      expect(provider.calls).toHaveLength(2)
      expect(credentials.get('openai')).toBe('fixture-shared-key')
      expect(fs.readFileSync(path.join(a.bot.workspacePath,'keep.txt'),'utf8')).toBe('Project files stay')
      for(const folder of ['browser-profiles','artifacts']) {
        expect(fs.existsSync(path.join(dir,folder,a.bot.id))).toBe(false)
        expect(fs.existsSync(path.join(dir,folder,other.bot.id,'keep.txt'))).toBe(true)
      }
      expect(fs.existsSync(path.join(dir,'avatars',`${a.bot.id}.png`))).toBe(false)
      const db=new DatabaseSync(dbPath,{readOnly:true})
      try {
        for(const table of ['bots','conversations','memories','skills','skill_proposals','attachments','jobs','artifacts','codex_sessions']) {
          const key=table==='bots' ? 'id' : 'bot_id'
          expect((db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${key}=?`).get(a.bot.id) as {n:number}).n).toBe(0)
        }
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        expect(db.prepare('SELECT * FROM skill_versions').all()).toEqual([])
        expect(db.prepare('SELECT * FROM file_edits').all()).toEqual([])
        expect(db.prepare('SELECT * FROM tool_calls').all()).toEqual([])
        expect(db.prepare("SELECT memory_id FROM memories_fts WHERE memories_fts MATCH 'fixture'").all()).toEqual([])
      } finally {db.close()}
    } finally {await app.close()}
  })

  it('preserves anonymous spend history so deletion cannot reset the daily ceiling',async()=>{
    const {app,provider}=setup()
    try {
      const a=await makeBot(app,'Spent budget')
      app.updateSettings({inputUsdPerMillion:0,outputUsdPerMillion:100,maxEstimatedSpendPerDayUsd:1})
      provider.handler=()=>({content:'Completed paid fixture.',toolCalls:[],usage:{inputTokens:1,outputTokens:6000}})
      expect((await app.sendMessage(a.conversation.id,'Use part of the daily budget')).status).toBe('completed')
      await waitFor(()=>!app.getSnapshot().runningBotIds?.length)
      const before=app.getUsage()
      expect(before.estimatedUsd).toBeCloseTo(0.6)
      await app.deleteBot(a.bot.id,a.bot.name)
      expect(app.getUsage()).toEqual(before)
      const b=await makeBot(app,'Another bot')
      app.updateSettings({inputUsdPerMillion:0,outputUsdPerMillion:100})
      const run=await app.sendMessage(b.conversation.id,'Try to spend the same budget again')
      expect(run.status).toBe('paused')
      expect(run.note).toMatch(/today.*spend limit/i)
      expect(provider.calls).toHaveLength(1)
      expect(app.listActivity('app')[0]).toMatchObject({runId:'',context:null,error:null,tools:[]})
    } finally {await app.close()}
  })

  it('allows deleting the last bot, survives Quit during deletion, and does not resurrect it on restart',async()=>{
    const first=setup()
    const bot=first.app.getSnapshot().bot!
    const deleting=first.app.deleteBot(bot.id,bot.name)
    const closing=first.app.close()
    expect((await deleting).snapshot.bots).toEqual([])
    await closing
    const second=setup(first.dbPath)
    try {
      const snapshot=second.app.getSnapshot()
      expect(snapshot.bot).toBeNull()
      expect(snapshot.current).toBeNull()
      expect(snapshot.bots).toEqual([])
      expect(snapshot.settings).toMatchObject({model:'',workspacePath:'',pinnedInstructions:''})
      expect(second.app.listJobs()).toEqual([])
      expect(second.provider.calls).toHaveLength(0)
      const created=await makeBot(second.app,'Fresh bot')
      expect(created.bot.id).not.toBe(bot.id)
      expect(second.app.getSnapshot().current?.messages).toEqual([])
    } finally {await second.app.close()}
  })

  it('refuses cleanup through a parent junction and keeps an overlapping project folder',async()=>{
    const {app,dir}=setup(),outside=tempDir()
    try {
      const bot=app.getSnapshot().bot!
      fs.mkdirSync(path.join(outside,bot.id));fs.writeFileSync(path.join(outside,bot.id,'keep.txt'),'outside data')
      fs.symlinkSync(outside,path.join(dir,'browser-profiles'),'junction')
      const saved=path.join(dir,'artifacts',bot.id)
      fs.mkdirSync(saved,{recursive:true});fs.writeFileSync(path.join(saved,'keep.txt'),'workspace data')
      const failed=await removeBotFiles(dir,bot.id,saved)
      expect(failed).toHaveLength(2)
      expect(fs.readFileSync(path.join(outside,bot.id,'keep.txt'),'utf8')).toBe('outside data')
      expect(fs.readFileSync(path.join(saved,'keep.txt'),'utf8')).toBe('workspace data')
    } finally {await app.close()}
  })
})
