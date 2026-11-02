import fs from 'fs'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { writeTextFile } from '../src/core/files'
import { Database } from '../src/core/db'
import { newId } from '../src/core/ids'
import { openDatabase } from '../src/core/sqlite'
import { fileChange } from '../src/core/progress'
import { ChatTranscript } from '../src/renderer/src/chat'
import { Markdown } from '../src/renderer/src/markdown'
import type { RiotBridge } from '../src/shared/types'
import { makeApp, reopen, waitFor } from './helpers'

describe('automatic output and file delivery', () => {
  it('continues a cut-off reply into one saved message without repeating tools or claiming early success', async () => {
    const { app, provider } = makeApp()
    try {
      let step = 0
      provider.handler = input => {
        if (step++ === 0) { input.onDelta?.('A sentence split midwo'); return { content: 'A sentence split midwo', toolCalls: [], finishReason: 'length' } }
        expect(input.messages[0].content).toContain('Continue exactly from its last character')
        expect(input.messages.at(-1)?.content).toBe('A sentence split midwo')
        expect(app.getSnapshot().current!.run!.status).toBe('running')
        input.onDelta?.('rd is complete.')
        return { content: 'rd is complete.', toolCalls: [], finishReason: 'stop' }
      }
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Write a sentence')
      expect(run.status).toBe('completed')
      expect(run.modelCalls).toBe(2)
      expect(app.getSnapshot().current!.messages.filter(message => message.role === 'assistant').map(message => message.content)).toEqual(['A sentence split midword is complete.'])
      expect(app.listActivity().map(entry => entry.outcome).sort()).toEqual(['completed', 'truncated'])
      expect(app.listActivity().some(entry => entry.purpose === 'reply_continuation')).toBe(true)
      expect(app.getSnapshot().current!.messages.some(message => message.content.includes('Raise the reply token limit'))).toBe(false)
    } finally { await app.close() }
  })

  it('preserves a partial answer and pauses when the task limit stops continuation', async () => {
    const { app, provider } = makeApp()
    try {
      app.updateSettings({ maxModelCallsPerTask: 2 })
      provider.handler = () => ({ content: 'partial ', toolCalls: [], finishReason: 'length' })
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Write something long')
      expect(run.status).toBe('paused')
      expect(provider.calls).toHaveLength(2)
      expect(app.getSnapshot().current!.messages.find(message => message.role === 'assistant')?.content).toBe('partial partial ')
    } finally { await app.close() }
  })

  it('discards a truncated tool batch, writes complete file chunks once, and undoes the whole file update', async () => {
    const shown: string[] = []
    const { app, provider, dir } = makeApp({ revealFile: file => shown.push(file) })
    const file = path.join(dir, 'index.html')
    fs.writeFileSync(file, 'Original website')
    try {
      app.updateSettings({ workspacePath: dir, workspaceEditing: true })
      let step = 0
      provider.handler = input => {
        const current = step++
        const call = (id: string, content: string, append = false) => ({ content: '', toolCalls: [{ id, name: 'write_file', arguments: JSON.stringify({ path: 'index.html', content, append }) }] })
        if (current === 0) return call('start', '<!doctype html>\n<html>')
        if (current === 1) return { ...call('incomplete', 'MUST-NOT-BE-APPENDED', true), finishReason: 'length', toolCalls: [call('unused', 'MUST-NOT-BE-APPENDED', true).toolCalls[0], { id: 'cutoff', name: 'write_file', arguments: '{"path":"index.html","content":' }] }
        if (current === 2) {
          expect(fs.readFileSync(file, 'utf8')).toBe('<!doctype html>\n<html>')
          expect(input.messages[0].content).toContain('NONE of its actions were executed')
          expect(input.messages.some(message => message.toolCalls?.some(tool => tool.id === 'cutoff'))).toBe(false)
          return call('finish', '<body>Complete page</body></html>', true)
        }
        if (current === 3) return { content: '', toolCalls: [{ id: 'verify', name: 'read_file', arguments: '{"path":"index.html"}' }] }
        return { content: 'Saved and checked [index.html](workspace:index.html).', toolCalls: [], finishReason: 'stop' }
      }
      expect((await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Build the HTML page')).status).toBe('completed')
      expect(fs.readFileSync(file, 'utf8')).toBe('<!doctype html>\n<html><body>Complete page</body></html>')
      const detail = app.getSnapshot().current!
      const edits = detail.messages.map(message => fileChange(message.toolName, message.content)).filter(Boolean)
      expect(edits).toHaveLength(2)
      expect(edits[0]!.editId).toBe(edits[1]!.editId)
      const html = renderToStaticMarkup(React.createElement(ChatTranscript, { detail, running: false, statusLabel: '', showToolDetails: false, avatar: null, api: {} as RiotBridge, onUndo() {}, onError() {}, onOlderPage() {} }))
      expect(html.match(/Undo this edit/g)).toHaveLength(1)
      expect(html).toContain('Show file in folder')
      app.revealWorkspaceFile('index.html', edits[0]!.editId)
      expect(shown).toEqual([fs.realpathSync(file)])
      expect(() => app.revealWorkspaceFile('index.html', newId())).toThrow(/not in this bot/)
      expect(app.undoEdit(edits[1]!.editId).ok).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('Original website')
      const changedRoot = path.join(dir, 'other-workspace'); fs.mkdirSync(changedRoot)
      fs.writeFileSync(path.join(changedRoot, 'index.html'), 'Different file')
      app.updateSettings({ workspacePath: changedRoot })
      expect(() => app.revealWorkspaceFile('index.html', edits[0]!.editId)).toThrow(/outside/)
    } finally { await app.close() }
  })

  it('still honors Stop during automatic continuation', async () => {
    const { app, provider } = makeApp()
    try {
      let step = 0
      provider.handler = input => {
        if (step++ === 0) return { content: 'Useful partial', toolCalls: [], finishReason: 'length' }
        return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }))
      }
      const pending = app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Write a long answer')
      await waitFor(() => provider.calls.length === 2)
      app.stop()
      expect((await pending).status).toBe('stopped')
      expect(app.getSnapshot().current!.messages.some(message => message.content === 'Useful partial')).toBe(true)
      expect(provider.calls).toHaveLength(2)
    } finally { await app.close() }
  })

  it('does not bypass a spending limit to continue a reply', async () => {
    const { app, provider } = makeApp()
    try {
      app.updateSettings({ inputUsdPerMillion: 0, outputUsdPerMillion: 1, maxEstimatedSpendPerTaskUsd: 0.00206, maxOutputTokens: 2048 })
      provider.handler = () => ({ content: 'Paid partial', toolCalls: [], finishReason: 'length', usage: { inputTokens: 100, outputTokens: 2048 } })
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'A long reply')
      expect(run.status).toBe('paused')
      expect(run.note).toMatch(/spend limit/)
      expect(provider.calls).toHaveLength(1)
      expect(app.getUsage().estimatedUsd).toBe(0.002048)
    } finally { await app.close() }
  })

  it('refuses unsafe file links and invalid append operations without losing existing data', async () => {
    const shown: string[] = []
    const { app, provider, dir } = makeApp({ revealFile: file => shown.push(file) })
    const root = path.join(dir, 'workspace'), outside = path.join(dir, 'outside')
    fs.mkdirSync(root); fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'private.txt'), 'private')
    fs.symlinkSync(outside, path.join(root, 'linked'), 'junction')
    fs.writeFileSync(path.join(root, 'binary.txt'), Buffer.from([0, 255, 0]))
    try {
      app.updateSettings({ workspacePath: root })
      expect(() => app.revealWorkspaceFile('../outside/private.txt')).toThrow(/outside/)
      expect(() => app.revealWorkspaceFile('linked/private.txt')).toThrow(/shortcut|symlink|junction/)
      expect(() => app.revealWorkspaceFile('missing.html')).toThrow(/not in/)
      expect(writeTextFile(root, 'missing.html', 'tail', true, true)).toHaveProperty('error')
      expect(writeTextFile(root, 'binary.txt', 'tail', true, true)).toHaveProperty('error')
      expect(writeTextFile(root, 'disabled.html', 'tail', false, true)).toHaveProperty('error')
      expect(fs.readFileSync(path.join(root, 'binary.txt'))).toEqual(Buffer.from([0, 255, 0]))
      expect(shown).toEqual([])
      expect(provider.calls).toHaveLength(0)
    } finally { await app.close() }
  })

  it('pauses a file-writing task when editing is off and shows the actionable setting', async () => {
    const { app, provider, dir } = makeApp()
    try {
      app.updateSettings({ workspacePath: dir, workspaceEditing: false })
      provider.handler = input => {
        expect(input.messages[0].content).toContain('Workspace editing: disabled')
        return { content: '', toolCalls: [{ id: 'write', name: 'write_file', arguments: '{"path":"blocked.html","content":"no"}' }] }
      }
      const run = await app.sendMessage(app.getSnapshot().ongoingConversationId!, 'Build a page')
      expect(run.status).toBe('paused')
      expect(run.note).toContain('Open Settings')
      expect(fs.existsSync(path.join(dir, 'blocked.html'))).toBe(false)
      expect(provider.calls).toHaveLength(1)
    } finally { await app.close() }
  })

  it('repairs previously cut-off replies marked completed without changing successful runs or calling a model', async () => {
    const setup = makeApp(), id = setup.app.getSnapshot().ongoingConversationId!
    await setup.app.close()
    const db = new Database(setup.dbPath)
    db.migrate()
    const bad = db.createRun(id, 1), task = db.createTask(id, bad.id, 'Old output', 1)
    const partial = { id: newId(), conversationId: id, runId: bad.id, role: 'assistant' as const, content: 'Original partial source', toolCallsJson: null, toolCallId: null, toolName: null, createdAt: 2, summarized: false }
    db.addMessage(partial)
    db.addMessage({ ...partial, id: newId(), role: 'notice', content: 'The reply hit the output token limit and may be cut off. Raise the reply token limit in Settings if you need a longer answer.', createdAt: 3 })
    db.finishRun(bad.id, 'completed', 4, '')
    db.updateTask(task.id, { status: 'completed' }, 4)
    const good = db.createRun(id, 5)
    db.addMessage({ ...partial, id: newId(), runId: good.id, content: 'Successfully finished', createdAt: 6 })
    db.finishRun(good.id, 'completed', 7, '')
    db.close()
    const raw = openDatabase(setup.dbPath); raw.exec('PRAGMA user_version = 7'); raw.close()
    const next = reopen(setup.dbPath)
    try {
      const messages = next.app.openConversation(id).messages
      expect(messages.find(message => message.id === partial.id)).toMatchObject({ content: partial.content, runStatus: 'paused' })
      expect(messages.find(message => message.runId === good.id)?.runStatus).toBe('completed')
      expect(messages.find(message => message.role === 'notice')?.content).toContain('automatic output handling')
      expect(next.provider.calls).toHaveLength(0)
    } finally { await next.app.close() }
  })

  it('collapses long source without running HTML and permits only explicit workspace or web link actions', () => {
    const source = '<script>alert("no")</script>\n' + '<div>source</div>\n'.repeat(25)
    const html = renderToStaticMarkup(React.createElement(Markdown, { text: '```html\n' + source + '```\n\n[Page](workspace:index.html) [Bad](javascript:alert) [Remote](https://example.org)', onOpenFile() {}, onOpenLink() {} }))
    expect(html).toContain('<details class="source-code">')
    expect(html).not.toContain('<details class="source-code" open')
    expect(html).toContain('View source')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('title="Show file in folder"')
    expect(html).toContain('>Remote</button>')
  })
})
