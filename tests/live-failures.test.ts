import fs from 'fs'
import path from 'path'
import {describe, expect, it} from 'vitest'
import {applyStreamEvent, responseFromJson, type StreamState} from '../src/core/provider'
import {Database} from '../src/core/db'
import {newId} from '../src/core/ids'
import {openDatabase} from '../src/core/sqlite'
import {makeApp, reopen} from './helpers'

describe('failures observed in real bot runs', () => {
  it('warns the model before the step cap and reserves room for an honest final handoff', async () => {
    const {app,provider}=makeApp()
    try {
      app.updateSettings({maxModelCallsPerTask:2})
      provider.handler=input=>{
        const instructions=input.messages[0].content
        if(provider.calls.length===1){
          expect(instructions).toContain('2 model calls remaining')
          return{content:'',toolCalls:[{id:'inspect',name:'list_memories',arguments:'{}'}]}
        }
        expect(instructions).toContain('This is the last available response')
        expect(instructions).toContain('unfinished or unverified work honestly')
        return{content:'Finished the requested inspection.',toolCalls:[]}
      }
      expect((await app.sendMessage(app.getSnapshot().ongoingConversationId!,'Inspect my saved memories')).status).toBe('completed')
      expect(provider.calls).toHaveLength(2)
    } finally {await app.close()}
  })

  it.each([
    {tokens:2048,calls:12,mode:'automatic',expectedCalls:24},
    {tokens:4096,calls:12,mode:'manual',expectedCalls:12},
    {tokens:2048,calls:7,mode:'automatic',expectedCalls:7}
  ])('migrates saved defaults while preserving custom caps ($tokens tokens, $calls calls)', async ({tokens,calls,mode,expectedCalls}) => {
    const {app,dbPath}=makeApp()
    await app.close()
    const raw=openDatabase(dbPath)
    raw.prepare("UPDATE bots SET settings_json = json_remove(json_set(settings_json, '$.maxOutputTokens', ?, '$.maxModelCallsPerTask', ?), '$.replyMode')").run(tokens,calls)
    raw.exec('PRAGMA user_version = 8')
    raw.close()
    const db=new Database(dbPath)
    try {
      db.migrate()
      db.migrate()
      expect(db.getSettings()).toMatchObject({replyMode:mode,maxOutputTokens:tokens,maxModelCallsPerTask:expectedCalls})
    } finally {db.close()}
  })

  it('gives a reasoning-only response more room, within the published output cap', async () => {
    const {app,provider}=makeApp({fetchImpl:async()=>new Response(JSON.stringify({data:[{id:'reasoner',context_length:131072,top_provider:{max_completion_tokens:12288}}]}))})
    try {
      app.updateSettings({provider:'openrouter',model:'reasoner',replyMode:'automatic'})
      provider.handler=input=> input.maxOutputTokens===8192 ? {content:'',toolCalls:[],finishReason:'length',usage:{inputTokens:100,outputTokens:8192,reasoningTokens:8192}} : {content:'Finished with enough room.',toolCalls:[],finishReason:'stop'}
      expect((await app.sendMessage(app.getSnapshot().ongoingConversationId!,'Solve the task')).status).toBe('completed')
      expect(provider.calls.map(call=>call.maxOutputTokens)).toEqual([8192,12288])
      expect(app.getSnapshot().current!.messages.filter(message=>message.role==='assistant').map(message=>message.content)).toEqual(['Finished with enough room.'])
    } finally {await app.close()}
  })

  it('returns a 404 to the model as a failed tool result and continues the original task', async () => {
    const {app,provider,dir}=makeApp({lookupHost:async()=>['93.184.216.34'],fetchImpl:async input=>new Response(String(input).includes('missing')?'Not found':'<h1>Angelicpedia reference site</h1>',{status:String(input).includes('missing')?404:200,headers:{'content-type':'text/html'}})})
    try {
      app.updateSettings({workspacePath:dir,workspaceEditing:true})
      let step=0
      provider.handler=input=>{
        expect(input.tools?.some(tool=>tool.name==='write_file')).toBe(true)
        if(step++===0)return{content:'',toolCalls:[{id:'good',name:'fetch_url',arguments:'{"url":"https://example.com/"}'},{id:'bad',name:'fetch_url',arguments:'{"url":"https://example.com/missing"}'}]}
        if(step===2){expect(input.messages.at(-1)?.content).toMatch(/Tool failed:.*404/);return{content:'',toolCalls:[{id:'save',name:'write_file',arguments:'{"path":"index.html","content":"<html><body>Finished</body></html>"}'}]}}
        return{content:'Saved the page using the successful source.',toolCalls:[]}
      }
      const run=await app.sendMessage(app.getSnapshot().ongoingConversationId!,'Create an HTML website. Research it first.')
      expect(run.status,run.note).toBe('completed')
      expect(fs.readFileSync(path.join(dir,'index.html'),'utf8')).toContain('Finished')
      expect(app.listActivity().flatMap(entry=>entry.tools).filter(tool=>tool.name==='fetch_url').map(tool=>tool.outcome).sort()).toEqual(['completed','failed'])
    } finally {await app.close()}
  })

  it('repairs malformed tool JSON even when the provider labels it tool_calls instead of length', async () => {
    const {app,provider,dir}=makeApp()
    try {
      app.updateSettings({workspacePath:dir,workspaceEditing:true})
      let step=0
      provider.handler=input=>{
        if(step++===0)return{content:'',toolCalls:[{id:'unsafe',name:'write_file',arguments:'{"path":"must-not-run.txt","content":"no"}'},{id:'broken',name:'write_file',arguments:'{"path":"index.html","content":"unfinished'}],finishReason:'tool_calls'}
        if(step===2){expect(fs.existsSync(path.join(dir,'must-not-run.txt'))).toBe(false);expect(input.messages[0].content).toContain('not complete valid JSON');return{content:'',toolCalls:[{id:'repaired',name:'write_file',arguments:'{"path":"index.html","content":"<html>Complete</html>"}'}]}}
        return{content:'Saved the complete file.',toolCalls:[],finishReason:'stop'}
      }
      expect((await app.sendMessage(app.getSnapshot().ongoingConversationId!,'Build an HTML page')).status).toBe('completed')
      expect(fs.readFileSync(path.join(dir,'index.html'),'utf8')).toBe('<html>Complete</html>')
      expect(provider.calls).toHaveLength(3)
    } finally {await app.close()}
  })

  it('does not replace the summary or mark originals summarized after a cut-off summary', async () => {
    const first=makeApp(), cid=first.app.getSnapshot().ongoingConversationId!
    first.app.updateSettings({maxOutputTokens:2048})
    await first.app.close()
    const db=new Database(first.dbPath);db.migrate();db.setSummary(cid,'Previous trusted continuity')
    const oldId=newId()
    db.addMessage({id:oldId,conversationId:cid,role:'user',content:'OLD IMPORTANT FACT '+ 'older detail '.repeat(2600),toolCallsJson:null,toolCallId:null,toolName:null,createdAt:1,summarized:false,runId:null})
    db.close()
    const next=reopen(first.dbPath)
    try {
      next.provider.handler=input=>input.messages[0].content.includes('Summarize the earlier conversation') ? {content:'Incomplete summary',toolCalls:[],finishReason:'length'} : {content:'Answered the current request.',toolCalls:[]}
      expect((await next.app.sendMessage(cid,'A short new question')).status).toBe('completed')
      expect(next.app.openConversation(cid).conversation.summary).toBe('Previous trusted continuity')
      const saved=new Database(first.dbPath)
      expect(saved.unsummarizedMessages(cid).some(message=>message.id===oldId)).toBe(true)
      saved.close()
      expect(next.app.listActivity().filter(entry=>entry.purpose==='compaction')).toHaveLength(1)
    } finally {await next.app.close()}
  })

  it('preserves native truncation and reasoning usage across the final accounting frame', () => {
    const state:StreamState={content:'',tools:[]}
    applyStreamEvent(state,{choices:[{delta:{tool_calls:[{index:0,id:'call',function:{name:'write_file',arguments:'{"path":"x"'}}]},finish_reason:'tool_calls',native_finish_reason:'MAX_TOKENS'}],usage:{completion_tokens:8192,completion_tokens_details:{reasoning_tokens:6000}}})
    applyStreamEvent(state,{choices:[{delta:{},finish_reason:'tool_calls'}],usage:{cost:0.001}})
    expect(state.finishReason).toBe('length')
    expect(state.usage).toMatchObject({outputTokens:8192,reasoningTokens:6000,reportedCostUsd:0.001})
    expect(responseFromJson({choices:[{message:{content:''},finish_reason:'stop',native_finish_reason:'max_tokens'}]}).finishReason).toBe('length')
  })

  it('lets new bots write in their app-created workspace without changing an existing-folder permission', async () => {
    const {app,dir}=makeApp()
    try {
      const draft={name:'Builder',purpose:'Build websites',provider:'openai' as const,model:'mock-model',workspaceKind:'suggested' as const,workspacePath:'',avatarKind:'builtin' as const,avatarValue:'spark',avatarBackground:'#d4544a'}
      await app.createBot(draft)
      expect(app.getSnapshot().settings.workspaceEditing).toBe(true)
      await app.createBot({...draft,name:'Existing folder',workspaceKind:'existing',workspacePath:dir})
      expect(app.getSnapshot().settings.workspaceEditing).toBe(false)
    } finally {await app.close()}
  })

  it('reads full stored sections once, advances omitted offsets, and resolves reader aliases to the original', async () => {
    const {app,provider,dir}=makeApp()
    const source='a'.repeat(23000)+'FIRST-SECTION-END'+'b'.repeat(24000)+'SECOND-SECTION-END'+'c'.repeat(18000)+'FINAL-SOURCE-MARKER'
    fs.writeFileSync(path.join(dir,'large.txt'),source)
    try {
      app.updateSettings({workspacePath:dir,modelContextTokens:131072})
      let step=0
      provider.handler=input=>{
        const reader=(id:string,resultId:string)=>({content:'',toolCalls:[{id,name:'read_tool_result',arguments:JSON.stringify({id:resultId})}]})
        if(step++===0)return{content:'',toolCalls:[{id:'source',name:'read_file',arguments:'{"path":"large.txt"}'}]}
        if(step===2){expect(input.messages.at(-1)?.content.length).toBeLessThan(2000);return reader('read-1','source')}
        if(step===3){expect(input.messages.at(-1)?.content).toContain('FIRST-SECTION-END');expect(input.messages.at(-1)?.content).not.toContain('Call read_tool_result with id read-1');return reader('read-2','read-1')}
        if(step===4){expect(input.messages.at(-1)?.content).toContain('SECOND-SECTION-END');return reader('read-3','source')}
        if(step===5){expect(input.messages.at(-1)?.content).toContain('FINAL-SOURCE-MARKER');expect(input.messages.at(-1)?.content).toContain('End of stored result');return reader('read-4','source')}
        expect(input.messages.at(-1)?.content).toContain('already been read to the end')
        return{content:'Read and verified the final marker.',toolCalls:[]}
      }
      const run=await app.sendMessage(app.getSnapshot().ongoingConversationId!,'Read the complete file large.txt')
      expect(run.status,run.note).toBe('completed')
      const db=new Database(path.join(dir,'riot.sqlite'))
      expect(db.findToolMessage(app.getSnapshot().bot!.id,'source')?.content).toBe(source)
      db.close()
    } finally {await app.close()}
  })

  it('keeps bounded sections from a tool batch in subsequent requests until history is compacted', async () => {
    const {app,provider,dir}=makeApp()
    fs.writeFileSync(path.join(dir,'a.txt'),'a'.repeat(6000)+'BATCH-A-END')
    fs.writeFileSync(path.join(dir,'b.txt'),'b'.repeat(6000)+'BATCH-B-END')
    try {
      app.updateSettings({workspacePath:dir})
      let step=0
      provider.handler=input=>{
        if(step++===0)return{content:'',toolCalls:['a','b'].map(id=>({id,name:'read_file',arguments:JSON.stringify({path:id+'.txt'})}))}
        if(step===2)return{content:'',toolCalls:['a','b'].map(id=>({id:'section-'+id,name:'read_tool_result',arguments:JSON.stringify({id})}))}
        const text=input.messages.map(message=>message.content).join('\n')
        expect(text).toContain('BATCH-A-END')
        expect(text).toContain('BATCH-B-END')
        if(step===3)return{content:'',toolCalls:[{id:'later-list',name:'list_files',arguments:'{}'}]}
        return{content:'Verified both complete sections.',toolCalls:[]}
      }
      expect((await app.sendMessage(app.getSnapshot().ongoingConversationId!,'Inspect both project files')).status).toBe('completed')
      expect(provider.calls).toHaveLength(4)
    } finally {await app.close()}
  })
})
