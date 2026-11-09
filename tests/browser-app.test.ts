import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { browserActionLimit, BrowserService, type LaunchedBrowser, type LaunchedPage, type RawControl, type UploadFile } from '../src/core/browser'
import { DEFAULT_SEARCH_TEMPLATE } from '../src/core/browser-policy'
import { ProviderError } from '../src/core/errors'
import { readUploadFile, saveDownloadedFile } from '../src/core/files'
import { newId } from '../src/core/ids'
import type { ModelCompleteInput } from '../src/core/model'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/core/settings'
import { makeApp, tempDir, waitFor } from './helpers'

const publicLookup = async (): Promise<string[]> => ['93.184.216.34']
const SHOT = 'data:image/jpeg;base64,AAAA'

class ToolPage implements LaunchedPage {
  uploads: UploadFile[] = []
  shots = 0
  controls: RawControl[] = [
    { role: 'button', name: 'Continue', inputType: '', href: '' },
    { role: 'upload', name: 'Resume', inputType: 'file', href: '' }
  ]
  private address = 'https://jobs.example/apply'
  url(): string { return this.address }
  async title(): Promise<string> { return 'Apply' }
  async goto(url: string): Promise<void> { this.address = url }
  async back(): Promise<void> {}
  async close(): Promise<void> {}
  async text(): Promise<string> { return 'Apply for the job.' }
  async links(): Promise<{ text: string; href: string }[]> { return [] }
  async html(): Promise<string> { return '' }
  async observe(): Promise<RawControl[]> { return this.controls }
  async press(): Promise<void> {}
  async typeInto(): Promise<void> {}
  async scroll(): Promise<void> {}
  async screenshot(): Promise<string> { this.shots += 1; return SHOT }
  async upload(_index: number, file: UploadFile): Promise<void> { this.uploads.push(file) }
}

function opener(page: ToolPage): () => Promise<LaunchedBrowser> {
  return async () => ({ pages: () => [page], current: () => page, select() {}, openPage: async () => page, close: async () => {} })
}

/** An app with a workspace folder, a known context window and one fake browser tab. */
function browserApp(page: ToolPage, settings: Record<string, unknown> = {}) {
  const made = makeApp({ lookupHost: publicLookup, browserOpener: opener(page) })
  const workspace = path.join(made.dir, 'workspace')
  fs.mkdirSync(workspace)
  made.app.updateSettings({ workspacePath: workspace, modelContextTokens: 131072, ...settings })
  return { ...made, workspace }
}

/** A model that takes a snapshot, then calls one browser tool with a reference from it, then answers. */
function scripted(tool: string, args: (snapshot: string) => Record<string, unknown>) {
  return (input: ModelCompleteInput) => {
    const last = input.messages.at(-1)
    const turn = input.messages.slice(input.messages.map((message) => message.role).lastIndexOf('user'))
    const results = turn.filter((message) => message.role === 'tool')
    if (!results.length) return { content: '', toolCalls: [{ id: 'snap', name: 'page_snapshot', arguments: '{}' }] }
    if (results.length === 1) return { content: '', toolCalls: [{ id: 'act', name: tool, arguments: JSON.stringify(args(String(last?.content))) }] }
    return { content: 'Done.', toolCalls: [] }
  }
}

describe('browser step limit', () => {
  it('stops at the bot’s own limit and keeps the setting in range', async () => {
    const service = new BrowserService({ dataDir: tempDir(), lookupHost: publicLookup, opener: opener(new ToolPage()) })
    const input = { botId: newId(), runId: 'run', signal: new AbortController().signal, searchTemplate: DEFAULT_SEARCH_TEMPLATE, confirm: async () => true, maxActions: 5 }
    try {
      for (let step = 0; step < 5; step += 1) expect(await service.act({ ...input, action: { type: 'tabs' } })).not.toMatch(/limit reached/)
      expect(await service.act({ ...input, action: { type: 'tabs' } })).toMatch(/limit reached \(5 this task\).*Bot settings → Limits/)
      expect(await service.act({ ...input, runId: 'next', action: { type: 'tabs' } })).not.toMatch(/limit reached/)
    } finally { await service.closeAll() }
    expect([browserActionLimit(), browserActionLimit(1), browserActionLimit(999), browserActionLimit(Number.NaN)]).toEqual([50, 5, 200, 50])
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, maxBrowserActionsPerTask: 1000 }).maxBrowserActionsPerTask).toBe(200)
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, maxBrowserActionsPerTask: 2 }).maxBrowserActionsPerTask).toBe(5)
  })
})

describe('browser uploads from the app', () => {
  it('asks before every upload, even on a remembered website, and sends only the approved bytes', async () => {
    const page = new ToolPage()
    const { app, provider, workspace } = browserApp(page, { trustedSites: ['https://jobs.example'] })
    fs.writeFileSync(path.join(workspace, 'cv.txt'), 'my resume')
    await app.openBrowser()
    const conversationId = app.getSnapshot().current!.conversation.id
    provider.handler = scripted('upload_file', (snapshot) => ({ ref: snapshot.match(/\n(e\d+) upload/)![1], path: 'cv.txt' }))

    const denied = app.sendMessage(conversationId, 'Upload my resume to the job form')
    await waitFor(() => app.pendingApproval()?.title === 'Upload this file?')
    const card = app.pendingApproval()!
    expect(card).toMatchObject({ kind: 'browser', cwd: 'https://jobs.example', confirmLabel: 'Upload file' })
    expect(card.command).toBe('Upload cv.txt (9 bytes) to https://jobs.example through “Resume”.')
    app.resolveApproval(card.id, false)
    expect((await denied).status).toBe('completed')
    expect(page.uploads).toHaveLength(0)
    expect(app.openConversation(conversationId).messages.find((message) => message.toolName === 'upload_file')?.content).toMatch(/not approved/)

    const approved = app.sendMessage(conversationId, 'Upload my resume to the job form again')
    await waitFor(() => app.pendingApproval()?.title === 'Upload this file?')
    app.resolveApproval(app.pendingApproval()!.id, true)
    expect((await approved).status).toBe('completed')
    expect(page.uploads).toHaveLength(1)
    expect(page.uploads[0]).toMatchObject({ name: 'cv.txt', mimeType: 'text/plain' })
    expect(page.uploads[0].buffer.toString()).toBe('my resume')
    await app.close()
  })

  it('refuses files outside the workspace before asking anything', async () => {
    const page = new ToolPage()
    const { app, provider, dir } = browserApp(page)
    fs.writeFileSync(path.join(dir, 'outside.txt'), 'private')
    await app.openBrowser()
    const conversationId = app.getSnapshot().current!.conversation.id
    provider.handler = scripted('upload_file', (snapshot) => ({ ref: snapshot.match(/\n(e\d+) upload/)![1], path: '../outside.txt' }))
    expect((await app.sendMessage(conversationId, 'Upload that file')).status).toBe('completed')
    expect(app.openConversation(conversationId).messages.find((message) => message.toolName === 'upload_file')?.content).toMatch(/outside the workspace folder/)
    expect(app.pendingApproval()).toBeNull()
    expect(page.uploads).toHaveLength(0)
    await app.close()
  })
})

describe('browser screenshots in the model context', () => {
  it('sends the screenshot with the next request for a model that can see it', async () => {
    const page = new ToolPage()
    const { app, provider } = browserApp(page)
    await app.openBrowser()
    const seen: (string[] | undefined)[] = []
    provider.handler = (input) => {
      const last = input.messages.at(-1)
      if (last?.role === 'user' && last.images) { seen.push(last.images); return { content: 'It shows an Apply form.', toolCalls: [] } }
      return { content: '', toolCalls: [{ id: 'shot', name: 'page_screenshot', arguments: '{}' }] }
    }
    expect((await app.sendMessage(app.getSnapshot().current!.conversation.id, 'What does the page look like?')).status).toBe('completed')
    expect(seen).toEqual([[SHOT]])
    expect(provider.calls.at(-1)!.messages.at(-1)!.content).toContain('Untrusted web content')
    await app.close()
  })

  it('keeps the screenshot in a conversation that already has history', async () => {
    const page = new ToolPage()
    const { app, provider } = browserApp(page)
    await app.openBrowser()
    const conversationId = app.getSnapshot().current!.conversation.id
    provider.handler = () => ({ content: 'Hi there.', toolCalls: [] })
    await app.sendMessage(conversationId, 'EARLIER-HELLO')
    let request: ModelCompleteInput | null = null
    provider.handler = (input) => {
      const last = input.messages.at(-1)
      if (last?.role === 'user' && last.images) { request = input; return { content: 'It shows an Apply form.', toolCalls: [] } }
      return { content: '', toolCalls: [{ id: 'shot', name: 'page_screenshot', arguments: '{}' }] }
    }
    expect((await app.sendMessage(conversationId, 'What does the page look like?')).status).toBe('completed')
    expect(request).not.toBeNull()
    const text = request!.messages.map((message) => message.content).join('\n')
    expect(text).toContain('EARLIER-HELLO')
    expect(text).not.toContain('did not fit')
    await app.close()
  })

  it('leaves the screenshot out when it would push history out of the request', async () => {
    const page = new ToolPage()
    const { app, provider } = browserApp(page, { modelContextTokens: 24000 })
    await app.openBrowser()
    const conversationId = app.getSnapshot().current!.conversation.id
    provider.handler = () => ({ content: 'Hi there.', toolCalls: [] })
    await app.sendMessage(conversationId, 'EARLIER-HELLO')
    provider.handler = (input) => input.messages.some((message) => message.role === 'tool')
      ? { content: 'I used the page text.', toolCalls: [] }
      : { content: '', toolCalls: [{ id: 'shot', name: 'page_screenshot', arguments: '{}' }] }
    expect((await app.sendMessage(conversationId, 'What does the page look like?')).status).toBe('completed')
    const last = provider.calls.at(-1)!
    expect(last.messages.some((message) => message.images?.length)).toBe(false)
    expect(last.messages.map((message) => message.content).join('\n')).toContain('EARLIER-HELLO')
    expect(last.messages[0].content).toContain('did not fit')
    await app.close()
  })

  it('retries without the image when the model refuses it and stops offering screenshots', async () => {
    const page = new ToolPage()
    const { app, provider } = browserApp(page)
    await app.openBrowser()
    provider.handler = (input) => {
      if (input.messages.some((message) => message.images?.length)) throw new ProviderError('unknown', 'This model does not support image input.', 400)
      if (input.messages.some((message) => message.role === 'tool')) return { content: 'I used the page text instead.', toolCalls: [] }
      return { content: '', toolCalls: [{ id: 'shot', name: 'page_screenshot', arguments: '{}' }] }
    }
    const run = await app.sendMessage(app.getSnapshot().current!.conversation.id, 'What does the page look like?')
    expect(run.status).toBe('completed')
    const retry = provider.calls.at(-1)!
    expect(retry.messages.some((message) => message.images?.length)).toBe(false)
    expect(retry.messages[0].content).toContain('did not accept the screenshot')
    expect(retry.tools?.some((tool) => tool.name === 'page_screenshot')).toBe(false)
    await app.close()
  })
})

describe('saving browser downloads', () => {
  it('saves into Downloads under a safe name without overwriting, and refuses when editing is off', () => {
    const workspace = tempDir()
    const source = path.join(tempDir(), 'temp-download')
    fs.writeFileSync(source, 'report body')
    const save = (suggestedName: string, editing = true) => saveDownloadedFile({ workspace, source, suggestedName, url: 'https://files.example/report', editing })
    expect(save('report.csv', false)).toEqual({ error: expect.stringMatching(/File editing is off/) })
    expect(fs.existsSync(path.join(workspace, 'Downloads'))).toBe(false)
    expect(save('report.csv')).toEqual({ path: 'Downloads/report.csv', size: 11 })
    expect(save('report.csv')).toEqual({ path: 'Downloads/report (2).csv', size: 11 })
    expect(fs.readFileSync(path.join(workspace, 'Downloads', 'report (2).csv'), 'utf8')).toBe('report body')
    expect(save('..\\..\\evil:name?.txt.')).toEqual({ path: 'Downloads/_.._evil_name_.txt', size: 11 })
    expect(save('CON.txt')).toEqual({ path: 'Downloads/_CON.txt', size: 11 })
    expect(save('invoice.url')).toEqual({ error: expect.stringMatching(/shortcut file/) })
    expect(fs.existsSync(path.join(workspace, 'Downloads', 'invoice.url'))).toBe(false)
  })

  it('reads upload files with the workspace secret-file rule', () => {
    const workspace = tempDir()
    fs.writeFileSync(path.join(workspace, '.env'), 'TOKEN=1')
    expect(() => readUploadFile(workspace, '.env')).toThrow(/can contain credentials/)
    expect(readUploadFile(workspace, '.env', true).buffer.toString()).toBe('TOKEN=1')
  })
})
