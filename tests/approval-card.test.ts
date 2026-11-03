import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApprovalCard } from '../src/renderer/src/App'
import type { ApprovalView } from '../src/shared/types'

const base: ApprovalView = {id:'fixture',kind:'codex',title:'Allow this Codex file?',command:'Apply workspace changes.\n[{"path":"index.html","diff":"'+'.selector{color:red}'.repeat(900)+'"}]',cwd:'C:\\Projects\\site',timeoutMs:600_000,warning:'Approval applies once.'}
const render = (approval: ApprovalView) => renderToStaticMarkup(createElement(ApprovalCard,{approval,onResolve:()=>undefined}))

describe('compact approval cards',()=>{
  it('keeps a large file request collapsed and puts the decision buttons outside the details',()=>{
    const html=render(base)
    expect(html).toContain('Allow file changes?')
    expect(html).toContain('Codex wants to update project files.')
    expect(html).toContain('<summary>View changes</summary>')
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|>)/)
    expect(html.indexOf('.selector')).toBeGreaterThan(html.indexOf('<details'))
    expect(html.indexOf('Approval applies once.')).toBeLessThan(html.indexOf('<details'))
    expect(html.indexOf('Allow changes')).toBeGreaterThan(html.indexOf('</details>'))
    expect(html).not.toContain('Allow this command')
  })

  it('keeps command context brief, preserves request details and uses the right action label',()=>{
    const html=render({...base,kind:'terminal',title:'Allow this command?',command:'echo "<script>not executed</script>"\n'+ 'next line '.repeat(1000)})
    const beforeDetails=html.slice(0,html.indexOf('<details'))
    expect(beforeDetails).not.toContain('next line')
    expect(html).toContain('&lt;script&gt;not executed&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<summary>View command</summary>')
    expect(html).toContain('Allow command')
    expect(render({...base,kind:'browser',title:'Allow this browser action?',command:'Click Submit'})).toContain('Allow action')
  })
})
