import fs from 'fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { installedBrowserChannel, PlaywrightPage } from '../src/core/browser-playwright'

const channel = installedBrowserChannel()
// This offline parser check uses an installed browser when available; no personal profile or network.
describe.skipIf(!channel && !fs.existsSync(chromium.executablePath()))('search card DOM parsing', () => {
  let browser: Browser
  let page: Page
  beforeAll(async () => {
    browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true, chromiumSandbox: true })
    const context = await browser.newContext()
    await context.route('**/*', (route) => route.abort())
    page = await context.newPage()
  })
  afterAll(async () => { await browser?.close() })

  it.each(['rso', 'search', 'main'])('reads Google %s cards while excluding ads and grouped sitelinks', async root => {
    const tag = root === 'main' ? 'main' : 'div'
    await page.setContent(`${root === 'rso' ? '' : '<div id="rso"></div>'}<${tag} id="${root}">
      <div class="MjjYud" data-text-ad><a href="https://ad.example/"><h3>Sponsored</h3></a></div>
      <div class="MjjYud"><a href="https://www.google.com/goto?url=observed-token"><h3>First organic card</h3></a><cite>first.example</cite>
        <a href="https://first.example/child"><h3>Grouped sitelink</h3></a></div>
      <div class="g"><a href="https://second.example/"><h3>Second organic card</h3></a></div>
    </${tag}>`)
    const hits = await new PlaywrightPage(page).googleResults(8)
    expect(hits.map(hit => hit.title)).toEqual(['First organic card', 'Second organic card'])
    expect(hits[0]).toMatchObject({ url: 'https://www.google.com/goto?url=observed-token', displayUrl: 'first.example' })
  })

  it('reads only parent Brave web cards, preserving order and excluding grouped links and ads', async () => {
    await page.setContent(`<main>
      <div class="snippet" data-type="ad"><a href="https://ad.example/"><div class="title">Ad</div></a></div>
      <div class="snippet" data-type="web" data-pos="0"><div class="result-content"><a href="https://angelicpedia.com/"><div class="title">Homepage</div></a>
        <cite>angelicpedia.com</cite><div class="generic-snippet"><div class="content">Main description</div></div></div>
        <div class="result-cluster"><div class="snippet"><a class="title" href="https://angelicpedia.com/category/christianity">Christianity</a></div></div>
      </div>
      <div class="snippet" data-type="web" data-pos="1"><a href="https://angelicpedia.com/azrael/"><div class="title">Azrael</div></a></div>
      <div class="snippet" data-type="web"><a href="javascript:void(0)"><div class="title">Invalid</div></a></div>
    </main>`)
    const hits = await new PlaywrightPage(page).braveResults(8)
    expect(hits.map(hit => hit.title)).toEqual(['Homepage', 'Azrael'])
    expect(hits[0].snippet).toBe('Main description')
  })
})
