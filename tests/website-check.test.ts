import fs from 'fs'
import path from 'path'
import http from 'http'
import net from 'net'
import dgram from 'dgram'
import { describe, expect, it } from 'vitest'
import { availableBrowserName } from '../src/core/browser-playwright'
import { previewAsset, verifyWebsite } from '../src/core/website-check'
import { tempDir } from './helpers'

describe('workspace website verification',()=>{
  it.skipIf(!availableBrowserName(process.env.PLAYWRIGHT_BROWSERS_PATH ?? ''))('blocks WebRTC, UDP and TCP as well as ordinary page requests',async()=>{
    const root=tempDir(),udp=dgram.createSocket('udp4')
    let packets=0,connections=0
    udp.on('message',()=>packets++)
    await new Promise<void>(resolve=>udp.bind(0,'127.0.0.1',resolve))
    const tcp=net.createServer(socket=>{connections++;socket.destroy()})
    await new Promise<void>(resolve=>tcp.listen(0,'127.0.0.1',resolve))
    try{
      const udpPort=udp.address().port,tcpPort=(tcp.address() as net.AddressInfo).port
      fs.writeFileSync(path.join(root,'index.html'),`<html><body><h1>Network isolation</h1><script>
        window.peers=[];for(const urls of ['stun:127.0.0.1:${udpPort}','turn:127.0.0.1:${udpPort}?transport=udp','turn:127.0.0.1:${tcpPort}?transport=tcp']){
          const pc=new RTCPeerConnection({iceServers:[{urls,username:'fixture',credential:'fixture'}]});peers.push(pc);pc.createDataChannel('test');pc.createOffer().then(o=>pc.setLocalDescription(o));
        }
      </script></body></html>`)
      const report=JSON.parse(await verifyWebsite({workspace:root,entry:'index.html',editing:true,signal:new AbortController().signal}))
      expect(report.status).toBe('passed')
      expect(packets).toBe(0)
      expect(connections).toBe(0)
    }finally{udp.close();await new Promise<void>(resolve=>tcp.close(()=>resolve()))}
  },45_000)
  it('serves only bounded static files inside the workspace, excluding credentials and external addresses',()=>{
    const root=tempDir()
    fs.writeFileSync(path.join(root,'index.html'),'<h1>Example</h1>')
    fs.writeFileSync(path.join(root,'.env'),'private value')
    fs.writeFileSync(path.join(root,'auth.json'),'private token')
    fs.writeFileSync(path.join(root,'run.ps1'),'arbitrary command')
    expect(previewAsset(root,'https://riot-preview.invalid/').status).toBe(200)
    for(const suffix of ['.env','auth.json','run.ps1','%2e%2e%5coutside.html']) expect(previewAsset(root,'https://riot-preview.invalid/'+suffix).status).toBe(404)
    expect(previewAsset(root,'http://127.0.0.1/private').status).toBe(403)
  })

  it('requires editing for screenshots and respects an already cancelled check',async()=>{
    const root=tempDir();fs.writeFileSync(path.join(root,'index.html'),'<h1>Page</h1>')
    await expect(verifyWebsite({workspace:root,entry:'index.html',editing:false,signal:new AbortController().signal})).rejects.toThrow(/Enable workspace editing/)
    await expect(verifyWebsite({workspace:root,entry:'index.html',editing:true,signal:AbortSignal.abort()})).rejects.toThrow(/stopped/i)
    expect(fs.readdirSync(root)).toEqual(['index.html'])
  })

  it.skipIf(!availableBrowserName(process.env.PLAYWRIGHT_BROWSERS_PATH ?? ''))('observes two real browser viewports, catches broken scripts/assets and blocks external requests',async()=>{
    const root=tempDir()
    let networkRequests=0
    const sentinel=http.createServer((_request,response)=>{networkRequests++;response.end('private data')})
    await new Promise<void>(resolve=>sentinel.listen(0,'127.0.0.1',resolve))
    const port=(sentinel.address() as {port:number}).port
    try {
    fs.writeFileSync(path.join(root,'index.html'),`<html><head><title>Check fixture</title></head><body><h1>Working page</h1><img src="missing.png"><img src="http://127.0.0.1:${port}/private.png"><script>fetch("http://127.0.0.1:${port}/private").catch(()=>{});throw new Error("broken fixture script")</script></body></html>`)
    const bad=JSON.parse(await verifyWebsite({workspace:root,entry:'index.html',editing:true,signal:new AbortController().signal}))
    expect(bad.status).toBe('checks_failed')
    expect(bad.externalNetwork).toBe('blocked')
    expect(networkRequests).toBe(0)
    expect(bad.views).toHaveLength(2)
    for(const view of bad.views) {
      expect(view.scriptErrors.join(' ')).toContain('broken fixture script')
      expect(view.missingAssets).toContain('/missing.png')
      expect(fs.readFileSync(path.join(root,view.screenshot)).subarray(1,4).toString()).toBe('PNG')
    }
    fs.writeFileSync(path.join(root,'index.html'),'<html><head><title>Fixed page</title></head><body><h1>Working page</h1></body></html>')
    const good=JSON.parse(await verifyWebsite({workspace:root,entry:'index.html',editing:true,signal:new AbortController().signal}))
    expect(good.status).toBe('passed')
    expect(good.views.every((view:{horizontalOverflow:boolean})=>!view.horizontalOverflow)).toBe(true)
    expect(fs.existsSync(path.join(root,good.report))).toBe(true)
    } finally {await new Promise<void>(resolve=>sentinel.close(()=>resolve()))}
  },45_000)
})
