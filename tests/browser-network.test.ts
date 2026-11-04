import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import dgram from 'node:dgram'
import { describe,expect,it,onTestFailed } from 'vitest'
import { chromium } from 'playwright-core'
import { bundledChromiumExecutable,chromiumLaunchOptions,installedBrowserChannel,PlaywrightPage } from '../src/core/browser-playwright'
import { startBrowserProxy } from '../src/core/browser-proxy'
import { BrowserService } from '../src/core/browser'
import { DEFAULT_SEARCH_TEMPLATE } from '../src/core/browser-policy'

const channels:(string|undefined)[]=[]
if(fs.existsSync(chromium.executablePath()))channels.push(undefined)
for(const channel of ['chrome','msedge'] as const){
  const suffix=channel==='chrome'?path.join('Google','Chrome','Application','chrome.exe'):path.join('Microsoft','Edge','Application','msedge.exe')
  if(installedBrowserChannel({exists:file=>file.endsWith(suffix)&&fs.existsSync(file)})===channel)channels.push(channel)
}

describe.skipIf(!channels.length)('real browser security boundaries',()=>{
  it.each(channels)('blocks direct WebRTC traffic and keeps element references bound to their original nodes (%s)',async channel=>{
    let phase='starting sentinels'
    onTestFailed(()=>console.error('Browser boundary check stopped while '+phase))
    const udp=dgram.createSocket('udp4');let packets=0,connections=0
    udp.on('message',()=>packets++)
    await new Promise<void>(resolve=>udp.bind(0,'127.0.0.1',resolve))
    const tcp=net.createServer(socket=>{connections++;socket.destroy()})
    await new Promise<void>(resolve=>tcp.listen(0,'127.0.0.1',resolve))
    const proxy=await startBrowserProxy()
    phase='launching '+(channel??'Chromium')
    const executable=channel?null:bundledChromiumExecutable(process.env.PLAYWRIGHT_BROWSERS_PATH??'')
    const browser=await chromium.launch({...chromiumLaunchOptions(proxy.url),headless:true,...(channel?{channel}:executable?{executablePath:executable}:{}),timeout:20_000})
    try{
      phase='creating isolated context'
      const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false})
      await context.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Fixture</h1><input aria-label="Original"><button>Continue</button>'}))
      phase='creating page'
      const page=await context.newPage();phase='opening local fixture';await page.goto('https://fixture.invalid/',{timeout:8000})
      phase='checking element identity'
      const wrapper=new PlaywrightPage(page)
      await wrapper.observe(40)
      await page.evaluate(()=>{const old=document.querySelector('input')!;old.replaceWith(old.cloneNode(true))})
      expect(await wrapper.controlAt(0)).toBeNull()
      phase='checking real page authorization'
      await page.setContent('<input aria-label="Search" oninput="window.autosaved=this.value"><a href="#" onclick="event.preventDefault();window.sent=true">Read documentation</a>')
      const service=new BrowserService({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'riot-controls-')),lookupHost:async()=>['93.184.216.34'],opener:async()=>({pages:()=>[wrapper],current:()=>wrapper,select(){},openPage:async()=>wrapper,close:async()=>{}})})
      let approvals=0
      const input={botId:'11111111-1111-4111-8111-111111111111',runId:'local-boundary',signal:new AbortController().signal,searchTemplate:DEFAULT_SEARCH_TEMPLATE,confirm:async()=>{approvals++;return false},trustedSites:[] as string[]}
      try{
        await service.act({...input,action:{type:'snapshot'}})
        await service.act({...input,action:{type:'fill',ref:'e1',value:'private draft'}})
        await service.act({...input,action:{type:'click',ref:'e2'}})
        expect(approvals).toBe(2)
        expect(await page.locator('input').inputValue()).toBe('')
        expect(await page.evaluate(()=>Boolean((window as unknown as {sent?:boolean}).sent))).toBe(false)
        input.trustedSites=['https://fixture.invalid']
        await service.act({...input,action:{type:'fill',ref:'e1',value:'approved text'}})
        await service.act({...input,action:{type:'click',ref:'e2'}})
        expect(approvals).toBe(2)
        expect(await page.evaluate(()=>(window as unknown as {autosaved:string}).autosaved)).toBe('approved text')
        expect(await page.evaluate(()=>(window as unknown as {sent:boolean}).sent)).toBe(true)
      }finally{await service.closeAll()}
      phase='checking WebRTC transports'
      await page.evaluate(async({udpPort,tcpPort})=>{
        const peers=[]
        for(const urls of [`stun:127.0.0.1:${udpPort}`,`turn:127.0.0.1:${udpPort}?transport=udp`,`turn:127.0.0.1:${tcpPort}?transport=tcp`]){
          const peer=new RTCPeerConnection({iceServers:[{urls,username:'fixture',credential:'fixture'}]});peers.push(peer);peer.createDataChannel('fixture');await peer.setLocalDescription(await peer.createOffer())
        }
        await new Promise(resolve=>setTimeout(resolve,1200));peers.forEach(peer=>peer.close())
      },{udpPort:udp.address().port,tcpPort:(tcp.address() as net.AddressInfo).port})
      expect(packets).toBe(0);expect(connections).toBe(0)
    }finally{phase='closing browser';await browser.close();phase='closing proxy';await proxy.close();phase='closing sentinels';udp.close();await new Promise<void>(resolve=>tcp.close(()=>resolve()));phase='done'}
  },30_000)
})
