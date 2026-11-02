import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { chromium, type Browser } from 'playwright-core'
import { chromiumLooksInstalled, installedBrowserChannel } from './browser-playwright'
import { resolveWorkspacePath } from './path-safety'
import { StopError } from './errors'

const ORIGIN = 'https://riot-preview.invalid'
const MIME: Record<string,string> = {'.html':'text/html','.htm':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'}
const CSP = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'"

/** Serve only static workspace assets to a fresh, network-blocked verification context. */
export function previewAsset(workspace: string, url: string): {status:number;contentType:string;body:Buffer|string} {
  try {
    const requested = new URL(url)
    if (requested.origin!==ORIGIN) return {status:403,contentType:'text/plain',body:'External requests are disabled.'}
    const relative = decodeURIComponent(requested.pathname).replace(/^\/+/, '') || 'index.html'
    if (relative.split(/[\\/]/).some(part=>part.startsWith('.') || /^(node_modules|vendor|credentials?|secrets?|auth)(\.|$)/i.test(part))) throw new Error('Private path')
    let file = resolveWorkspacePath(workspace,relative)
    if (fs.statSync(file).isDirectory()) file = resolveWorkspacePath(workspace,path.join(relative,'index.html'))
    const type = MIME[path.extname(file).toLowerCase()]
    const stat = fs.statSync(file)
    if (!type || !stat.isFile() || stat.size>10_000_000) throw new Error('Not a static asset')
    return {status:200,contentType:type,body:fs.readFileSync(file)}
  } catch { return {status:404,contentType:'text/plain',body:'Static file not found or excluded.'} }
}

export async function verifyWebsite(options: {workspace:string;entry:string;editing:boolean;signal:AbortSignal}): Promise<string> {
  const entry = resolveWorkspacePath(options.workspace,options.entry || 'index.html')
  if (!/\.html?$/i.test(entry) || !fs.statSync(entry).isFile()) throw new Error('Choose an existing HTML file inside the workspace. This check does not run npm scripts or a development server.')
  if (!options.editing) throw new Error('Enable workspace editing to save the verification report and screenshots.')
  const relative = path.relative(fs.realpathSync(options.workspace),entry).split(path.sep).join('/')
  const entryUrl = ORIGIN + '/' + relative.split('/').map(encodeURIComponent).join('/')
  if (previewAsset(options.workspace,entryUrl).status!==200) throw new Error('That HTML file is not available to the static website checker.')
  const output = `riot-checks/${randomUUID()}`
  const destination = resolveWorkspacePath(options.workspace,output)
  let browser: Browser | null = null
  const controller = new AbortController()
  const stop = ():void=>{ controller.abort();void browser?.close().catch(()=>undefined) }
  options.signal.addEventListener('abort',stop,{once:true})
  const timer = setTimeout(stop,45_000)
  try {
    if (options.signal.aborted) throw new StopError('Website check stopped.')
    const bundled = chromiumLooksInstalled(process.env.PLAYWRIGHT_BROWSERS_PATH ?? '')
    const channel = bundled ? undefined : installedBrowserChannel() ?? undefined
    try { browser = await chromium.launch({headless:true,chromiumSandbox:true,channel,timeout:20_000,args:['--disable-features=WebRTC']}) }
    catch { return 'Website verification did not run: Chromium, Chrome or Edge could not start. Install Chromium from the bot menu or review the browser installation. No browser checks passed.' }
    if (controller.signal.aborted) throw new StopError('Website check stopped.')
    fs.mkdirSync(destination,{recursive:true})
    const views: Array<Record<string,unknown>> = []
    const external = new Set<string>()
    for (const viewport of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]) {
      if (controller.signal.aborted) throw new StopError('Website check stopped.')
      const context = await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block',acceptDownloads:false,permissions:[]})
      const missing = new Set<string>(), errors: string[] = []
      await context.routeWebSocket('**/*',socket=>socket.close())
      await context.route('**/*',async route=>{
        const request = route.request(), url = new URL(request.url())
        if (url.origin!==ORIGIN || !['GET','HEAD'].includes(request.method())) {
          external.add(url.origin)
          await route.abort()
          return
        }
        const asset = previewAsset(options.workspace,request.url())
        if (asset.status!==200) missing.add(url.pathname)
        await route.fulfill({...asset,headers:{'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff'}})
      })
      const page = await context.newPage()
      context.on('page',popup=>{if(popup!==page)void popup.close()})
      page.setDefaultTimeout(5_000)
      page.on('pageerror',error=>{if(errors.length<20)errors.push(error.message.slice(0,400))})
      await page.goto(entryUrl,{waitUntil:'load',timeout:10_000})
      const observed = await page.evaluate(()=>({title:document.title,heading:document.querySelector('h1')?.textContent?.trim().slice(0,200) ?? '',hasContent:!!document.body?.innerText.trim(),horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1}))
      const screenshot = `${output}/${viewport.name}.png`
      await page.screenshot({path:resolveWorkspacePath(options.workspace,screenshot),animations:'disabled',timeout:5_000})
      views.push({viewport:viewport.name,...observed,scriptErrors:errors,missingAssets:[...missing].slice(0,30),screenshot})
      await context.close()
    }
    const passed = views.every(view=>view.hasContent&&!view.horizontalOverflow&&!(view.scriptErrors as string[]).length&&!(view.missingAssets as string[]).length)
    const report = {status:passed?'passed':'checks_failed',entry:relative,checkedAt:new Date().toISOString(),scope:'Static page loading, initial JavaScript errors, missing local assets and horizontal overflow at two viewport sizes. No interaction, accessibility, backend or complete visual-design review.',externalNetwork:'blocked',blockedOrigins:[...external].slice(0,20),views}
    fs.writeFileSync(path.join(destination,'report.json'),JSON.stringify(report,null,2),{flag:'wx'})
    return JSON.stringify({...report,report:`${output}/report.json`})
  } catch (error) {
    if (options.signal.aborted) throw new StopError('Website check stopped.')
    if (controller.signal.aborted) return 'Website verification timed out. It did not pass. Any partial screenshots are in the workspace.'
    throw error
  } finally { clearTimeout(timer);options.signal.removeEventListener('abort',stop);await browser?.close().catch(()=>undefined) }
}
