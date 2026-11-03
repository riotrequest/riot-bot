import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelField, NewBotForm, SkillProposalCard } from '../src/renderer/src/App'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import type { CodexStatus, RiotBridge, SkillProposal } from '../src/shared/types'

const codex: CodexStatus = {installed:true,connected:true,plan:'fixture',email:null,loginPending:false,models:[{id:'native-alpha',name:'Alpha'},{id:'native-beta',name:'Beta'}],limits:[],note:'Fixture'}
const proposal: SkillProposal = {id:'fixture',botId:'bot',conversationId:'chat',name:'Plugin review',description:'Use when reviewing a plugin.',procedure:'Review each step.\n'.repeat(300),pitfalls:'Avoid unsafe writes.',verification:'Run the checks.',updateSkillId:null}

describe('skill preview and shared model picker',()=>{
  it('separates skill previews from approval clipping and keeps Save outside the scrolling body',()=>{
    const html=renderToStaticMarkup(createElement(SkillProposalCard,{proposal,api:{} as RiotBridge,onProposal:()=>undefined,onError:()=>undefined}))
    expect(html).toContain('class="skill-proposal"')
    expect(html).not.toContain('class="approval"')
    expect(html).toContain('<summary>View skill details</summary>')
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|>)/)
    expect(html).toContain('</details></div><div class="row skill-proposal-actions">')
    expect(html).toContain('Save skill')
  })

  it('renders New Bot with the connected account’s model dropdown and preserves its selected model',()=>{
    const html=renderToStaticMarkup(createElement(NewBotForm,{settings:{...DEFAULT_SETTINGS,provider:'codex',model:'native-beta'},api:{} as RiotBridge,codex,onCodex:()=>undefined,onCreate:async()=>undefined,onError:()=>undefined}))
    expect(html).toMatch(/Codex model<select/)
    expect(html).toContain('<option value="native-beta" selected="">Beta</option>')
    expect(html).not.toMatch(/Model ID<input/)
  })

  it('keeps editable API model IDs and shows stale Codex choices without substituting a model',()=>{
    const api=renderToStaticMarkup(createElement(ModelField,{provider:'openai',model:'api-fixture',codex,onChange:()=>undefined}))
    expect(api).toContain('Model ID<input')
    expect(api).toContain('value="api-fixture"')
    const stale=renderToStaticMarkup(createElement(ModelField,{provider:'codex',model:'saved-model',codex,onChange:()=>undefined}))
    expect(stale).toContain('<option value="saved-model" selected="">saved-model · current choice</option>')
  })
})
