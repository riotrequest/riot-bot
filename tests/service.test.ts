import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { RiotApp } from '../src/core/app'
import { CodexService } from '../src/core/codex'
import { MemoryCredentialStore } from '../src/core/credentials'
import { StopError } from '../src/core/errors'
import type { ModelResponse } from '../src/core/model'
import { MockProvider } from '../src/core/provider'
import { RiotService, type RiotServiceOptions } from '../src/core/service'
import { FakeTerminal, tempDir, waitFor } from './helpers'

function setup(extra: Partial<RiotServiceOptions> = {}) {
  const dir = tempDir(), provider = new MockProvider(), credentials = new MemoryCredentialStore()
  const app = new RiotService({dbPath:path.join(dir,'riot.sqlite'),workspaceRoot:path.join(dir,'workspaces'),provider,credentials,...extra})
  app.boot()
  return {app,provider,dir,credentials}
}

async function bot(app: RiotService, name: string, workspacePath = '') {
  return app.createBot({name,purpose:'Help with this project',provider:'openai',model:name,workspaceKind:workspacePath ? 'existing' : 'suggested',workspacePath,avatarKind:'builtin',avatarValue:'spark',avatarBackground:'#d4544a'})
}

function pending(input: {signal: AbortSignal}, done: (resolve: (response: ModelResponse)=>void)=>void): Promise<ModelResponse> {
  return new Promise((resolve,reject)=>{
    input.signal.addEventListener('abort',()=>reject(new StopError('Stopped.')),{once:true})
    done(resolve)
  })
}

describe('persistent desktop job service',()=>{
  it('settles an approval answered immediately by its owner without losing the decision',async()=>{
    const terminal=new FakeTerminal()
    const {app,provider}=setup({createExecutor:(_id,options)=>new RiotApp({...options,terminal})})
    try {
      const a=await bot(app,'Immediate decision')
      provider.handler=input=>input.messages.at(-1)?.role==='tool' ? {content:'Approved command completed.',toolCalls:[]} : {content:'',toolCalls:[{id:'one-command',name:'run_terminal',arguments:'{"command":"echo fixture"}'}]}
      app.onEvent(event=>{if(event.type==='approval'&&event.approval)app.resolveApproval(event.approval.id,true)})
      const run=await app.sendMessage(a.conversation.id,'Run this fixture command')
      expect(run.status).toBe('completed')
      expect(terminal.ran).toEqual(['echo fixture'])
    } finally {await app.close()}
  })

  it('keeps two native Codex turns separate and routes Stop only to the selected native worker',async()=>{
    const {app,provider}=setup({createExecutor:(_id,options)=>{
      const home=path.join(path.dirname(options.dbPath),'codex')
      fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'fixture.json'),JSON.stringify({scenario:'hold'}))
      return new RiotApp({...options,codex:new CodexService({home,command:process.execPath,prefixArgs:[path.resolve('tests/fixtures/codex-server.cjs')]})})
    }})
    try {
      const a=await bot(app,'Native Alpha');app.updateSettings({provider:'codex',model:'native-test'})
      const b=await bot(app,'Native Beta');app.updateSettings({provider:'codex',model:'native-test'})
      app.selectBot(a.bot.id);const first=app.queueMessage(a.conversation.id,'First native bot')
      app.selectBot(b.bot.id);const second=app.queueMessage(b.conversation.id,'Second native bot')
      await waitFor(()=>{
        app.selectBot(a.bot.id);const alpha=app.getSnapshot().current!.messages.some(message=>message.content==='Partial reply')
        app.selectBot(b.bot.id);const beta=app.getSnapshot().current!.messages.some(message=>message.content==='Partial reply')
        return alpha&&beta
      })
      app.selectBot(a.bot.id);app.stop()
      await waitFor(()=>!app.getSnapshot().runningBotIds?.includes(a.bot.id))
      expect(app.listJobs('app').find(job=>job.id===first.id)?.status).toBe('cancelled')
      expect(app.listJobs('app').find(job=>job.id===second.id)?.status).toBe('running')
      expect(app.getSnapshot().runningBotIds).toEqual([b.bot.id])
      expect(provider.calls).toHaveLength(0)
    } finally {await app.close()}
  })

  it('serializes overlapping workspaces even when the bots are different',async()=>{
    const {app,provider,dir}=setup()
    try {
      const root=path.join(dir,'shared');fs.mkdirSync(path.join(root,'child'),{recursive:true})
      const a=await bot(app,'Outer',root),b=await bot(app,'Inner',path.join(root,'child'))
      let finish!: (response:ModelResponse)=>void
      provider.handler=input=>provider.calls.length===1 ? pending(input,resolve=>{finish=resolve}) : {content:'Done.',toolCalls:[]}
      app.selectBot(a.bot.id);app.queueMessage(a.conversation.id,'First writer')
      app.selectBot(b.bot.id);const next=app.queueMessage(b.conversation.id,'Second writer')
      await waitFor(()=>provider.calls.length===1)
      expect(app.listJobs().find(job=>job.id===next.id)?.status).toBe('queued')
      finish({content:'First writer done.',toolCalls:[]})
      await waitFor(()=>app.listJobs().find(job=>job.id===next.id)?.status==='completed')
      expect(provider.calls.map(call=>call.model)).toEqual(['Outer','Inner'])
    } finally {await app.close()}
  })

  it('keeps the app-wide spend reservation atomic across simultaneous bot executors',async()=>{
    const {app,provider}=setup()
    try {
      const a=await bot(app,'Budget A')
      app.updateSettings({inputUsdPerMillion:0,outputUsdPerMillion:100,maxEstimatedSpendPerDayUsd:1})
      const b=await bot(app,'Budget B')
      app.updateSettings({inputUsdPerMillion:0,outputUsdPerMillion:100})
      provider.handler=input=>pending(input,()=>undefined)
      app.selectBot(a.bot.id);app.queueMessage(a.conversation.id,'Hold reservation')
      app.selectBot(b.bot.id);const second=app.queueMessage(b.conversation.id,'Another reservation')
      await waitFor(()=>app.listJobs().find(job=>job.id===second.id)?.status==='paused')
      expect(provider.calls).toHaveLength(1)
      expect(app.listJobs().find(job=>job.id===second.id)?.note).toMatch(/today.*spend limit/i)
    } finally {await app.close()}
  })

  it('settles active work on Quit and reopens interrupted and queued jobs without model calls',async()=>{
    const first=setup()
    const a=await bot(first.app,'Recovery')
    first.provider.handler=input=>pending(input,()=>undefined)
    const active=first.app.queueMessage(a.conversation.id,'Partially completed project')
    const queued=first.app.queueMessage(a.conversation.id,'Follow-up')
    await waitFor(()=>first.provider.calls.length===1)
    await first.app.close()
    const second=setup({dbPath:path.join(first.dir,'riot.sqlite')})
    try {
      expect(second.app.listJobs().find(job=>job.id===active.id)?.status).toBe('interrupted')
      expect(second.app.listJobs().find(job=>job.id===queued.id)?.status).toBe('paused')
      expect(second.provider.calls).toHaveLength(0)
      second.provider.handler=()=>({content:'Resumed after reviewing the original work.',toolCalls:[]})
      second.app.resumeJob(active.id)
      await waitFor(()=>second.app.listJobs().find(job=>job.id===active.id)?.status==='completed')
      expect(second.provider.calls[0].messages.at(-1)?.content).toMatch(/Do not repeat completed actions/)
      expect(second.app.listJobs().find(job=>job.id===queued.id)?.status).toBe('paused')
    } finally {await second.app.close()}
  })

  it('guards active connections and pauses queued work before an account change',async()=>{
    const {app,provider}=setup()
    try {
      const a=await bot(app,'Connection')
      provider.handler=input=>pending(input,()=>undefined)
      app.queueMessage(a.conversation.id,'Keep using this account')
      await waitFor(()=>provider.calls.length===1)
      expect(()=>app.setCredential('openai','different-key-value')).toThrow(/Stop jobs/)
      expect(()=>app.clearCredential('openai')).toThrow(/Stop jobs/)
      expect(()=>app.updateBot({instructions:'Change active instructions'})).toThrow(/Stop this bot/)
      app.stop()
      await waitFor(()=>!app.getSnapshot().runningBotIds?.length)
      const queued=app.queueMessage(a.conversation.id,'Use the selected account')
      app.setCredential('openai','different-key-value')
      expect(app.listJobs().find(job=>job.id===queued.id)?.status).toBe('paused')
      expect(provider.calls).toHaveLength(1)
    } finally {await app.close()}
  })

  it('excludes credential files and known secrets from Library without changing workspace files',async()=>{
    const {app,provider,credentials}=setup()
    try {
      credentials.set('openai','saved-secret-value')
      const a=await bot(app,'Private files')
      provider.handler=()=>{
        fs.writeFileSync(path.join(a.bot.workspacePath,'auth.json'),'private sign-in token')
        fs.writeFileSync(path.join(a.bot.workspacePath,'notes.txt'),'saved-secret-value')
        fs.writeFileSync(path.join(a.bot.workspacePath,'result.txt'),'Public result')
        return {content:'Saved the public result.',toolCalls:[]}
      }
      await app.sendMessage(a.conversation.id,'Prepare the files')
      expect(app.listArtifacts().map(item=>item.name)).toEqual(['result.txt'])
      expect(fs.readFileSync(path.join(a.bot.workspacePath,'notes.txt'),'utf8')).toBe('saved-secret-value')
    } finally {await app.close()}
  })

  it('runs two bots independently, preserves settings and approvals, and stops only the selected bot',async()=>{
    const {app,provider}=setup()
    try {
      const a=await bot(app,'First'), b=await bot(app,'Second')
      let finishSecond!: (value:ModelResponse)=>void
      provider.handler=input=>pending(input,resolve=>{if(input.model==='Second')finishSecond=resolve})
      app.selectBot(a.bot.id)
      const ja=app.queueMessage(a.conversation.id,'Hold first project')
      app.selectBot(b.bot.id)
      const jb=app.queueMessage(b.conversation.id,'Hold second project')
      await waitFor(()=>provider.calls.length===2)
      expect(new Set(provider.calls.map(call=>call.model))).toEqual(new Set(['First','Second']))
      expect(provider.calls.find(call=>call.model==='First')!.messages.map(m=>m.content).join('\n')).not.toContain('Hold second project')
      expect(app.getSnapshot().runningBotIds).toHaveLength(2)
      app.selectBot(a.bot.id)
      app.stop()
      finishSecond({content:'Second completed.',toolCalls:[]})
      await waitFor(()=>app.listJobs('app').every(job=>job.status!=='running'))
      expect(app.listJobs('app').find(job=>job.id===ja.id)?.status).toBe('cancelled')
      expect(app.listJobs('app').find(job=>job.id===jb.id)?.status).toBe('completed')
    } finally {await app.close()}
  })

  it('queues follow-ups without putting future instructions into the running conversation',async()=>{
    const {app,provider}=setup()
    try {
      const a=await bot(app,'Builder')
      let finish!: (value:ModelResponse)=>void
      provider.handler=input=>provider.calls.length===1 ? pending(input,resolve=>{finish=resolve}) : {content:'Follow-up done.',toolCalls:[]}
      const first=app.queueMessage(a.conversation.id,'Current task')
      const second=app.queueMessage(a.conversation.id,'FUTURE-INSTRUCTION-DO-NOT-READ-YET')
      await waitFor(()=>provider.calls.length===1)
      expect(app.listJobs().find(job=>job.id===second.id)?.status).toBe('queued')
      expect(provider.calls[0].messages.map(m=>m.content).join('\n')).not.toContain('FUTURE-INSTRUCTION')
      finish({content:'Current done.',toolCalls:[]})
      await waitFor(()=>app.listJobs().find(job=>job.id===second.id)?.status==='completed')
      expect(app.listJobs().find(job=>job.id===first.id)?.status).toBe('completed')
      expect(provider.calls).toHaveLength(2)
      expect(app.openConversation(a.conversation.id).messages.filter(m=>m.role==='user')).toHaveLength(2)
    } finally {await app.close()}
  })

  it('restores queued work paused, reserves its attachments, and needs explicit Resume after restart',async()=>{
    const first=setup()
    const a=await bot(first.app,'Persistent')
    const attachment=first.app.stageAttachments([{name:'brief.txt',bytes:Buffer.from('Saved request data')}],a.bot.id)[0]
    const job=first.app.queueMessage(a.conversation.id,'Read the saved brief',[attachment.id])
    expect(first.app.getSnapshot().draftAttachments).toHaveLength(0)
    expect(()=>first.app.queueMessage(a.conversation.id,'Duplicate',[attachment.id])).toThrow(/already belongs/)
    expect(()=>first.app.removeDraftAttachment(attachment.id)).toThrow(/queued job/)
    await first.app.close()
    expect(first.provider.calls).toHaveLength(0)
    const second=setup({dbPath:path.join(first.dir,'riot.sqlite')})
    try {
      expect(second.app.listJobs().find(item=>item.id===job.id)?.status).toBe('paused')
      expect(second.provider.calls).toHaveLength(0)
      second.provider.handler=()=>({content:'Read the saved request.',toolCalls:[]})
      second.app.resumeJob(job.id)
      await waitFor(()=>second.app.listJobs().find(item=>item.id===job.id)?.status==='completed')
      expect(second.app.openConversation(a.conversation.id).messages.filter(m=>m.role==='user')).toHaveLength(1)
      expect(second.provider.calls[0].messages.some(m=>m.content.includes('brief.txt'))).toBe(true)
    } finally {await second.app.close()}
  })

  it('holds a queued job if its selected model changed and allows explicit review/resume',async()=>{
    const {app,provider}=setup()
    try {
      const a=await bot(app,'Before')
      const job=app.queueMessage(a.conversation.id,'Use my selected model')
      app.updateSettings({model:'After'})
      await waitFor(()=>app.listJobs().find(item=>item.id===job.id)?.status==='paused')
      expect(provider.calls).toHaveLength(0)
      provider.handler=()=>({content:'Done with the reviewed setup.',toolCalls:[]})
      app.resumeJob(job.id)
      await waitFor(()=>app.listJobs().find(item=>item.id===job.id)?.status==='completed')
      expect(provider.calls[0].model).toBe('After')
    } finally {await app.close()}
  })

  it('keeps immutable artifact versions after the original file changes or is removed, scoped to the bot',async()=>{
    const opened:string[]=[]
    const {app,provider}=setup({revealFile:file=>opened.push(file)})
    try {
      const a=await bot(app,'Writer')
      let content='First complete version'
      provider.handler=input=>input.messages.at(-1)?.role==='tool'
        ? {content:'Saved the file.',toolCalls:[]}
        : {content:'',toolCalls:[{id:'write-'+provider.calls.length,name:'write_file',arguments:JSON.stringify({path:'index.html',content})}]}
      await app.sendMessage(a.conversation.id,'Create an HTML project file')
      const one=app.listArtifacts()[0]
      expect(one).toMatchObject({name:'index.html',version:1})
      content='Second complete version'
      await app.sendMessage(a.conversation.id,'Update the HTML project file')
      const two=app.listArtifacts()[0]
      expect(two.version).toBe(2)
      fs.unlinkSync(path.join(a.bot.workspacePath,'index.html'))
      app.revealArtifact(one.id)
      app.revealArtifact(two.id)
      expect(fs.readFileSync(opened[0],'utf8')).toBe('First complete version')
      expect(fs.readFileSync(opened[1],'utf8')).toBe('Second complete version')
      await bot(app,'Other')
      expect(app.listArtifacts()).toHaveLength(0)
      expect(()=>app.revealArtifact(one.id)).toThrow(/not in this bot/)
    } finally {await app.close()}
  })

  it('routes simultaneous command approvals to their own worker even when the selected bot changes',async()=>{
    const terminals=new Map<string,FakeTerminal>()
    const {app,provider}=setup({createExecutor:(id,options)=>{
      const terminal=new FakeTerminal();terminals.set(id,terminal)
      return new RiotApp({...options,terminal})
    }})
    try {
      const a=await bot(app,'Command A'), b=await bot(app,'Command B')
      provider.handler=input=>input.messages.at(-1)?.role==='tool' ? {content:'Finished with the decision.',toolCalls:[]}
        : {content:'',toolCalls:[{id:'command-'+input.model,name:'run_terminal',arguments:JSON.stringify({command:'echo '+input.model})}]}
      app.selectBot(a.bot.id);const ja=app.queueMessage(a.conversation.id,'Run the command')
      app.selectBot(b.bot.id);const jb=app.queueMessage(b.conversation.id,'Run the command')
      await waitFor(()=>app.listJobs('app').filter(job=>job.awaitingApproval).length===2)
      app.selectBot(a.bot.id);const approvalA=app.getSnapshot().pendingApproval!
      app.selectBot(b.bot.id);const approvalB=app.getSnapshot().pendingApproval!
      expect(approvalA.id).not.toBe(approvalB.id)
      app.resolveApproval(approvalA.id,false)
      expect(app.getSnapshot().pendingApproval?.id).toBe(approvalB.id)
      app.resolveApproval(approvalB.id,true)
      await waitFor(()=>app.listJobs('app').filter(job=>[ja.id,jb.id].includes(job.id)).every(job=>job.status==='completed'))
      expect(terminals.get(a.bot.id)?.ran).toHaveLength(0)
      expect(terminals.get(b.bot.id)?.ran).toEqual(['echo Command B'])
    } finally {await app.close()}
  })
})
