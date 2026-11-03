import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatTranscript } from '../src/renderer/src/chat'
import type { ConversationDetail, RiotBridge } from '../src/shared/types'

const detail: ConversationDetail = {
  conversation: { id: 'chat', botId: 'bot', title: 'Chat', createdAt: 1, updatedAt: 4, summary: '' },
  run: { id: 'run', botId: 'bot', conversationId: 'chat', trigger: 'user_message', status: 'completed', startedAt: 1, endedAt: 4, modelCalls: 2, note: '' },
  task: null,
  messages: [
    { id: 'user', runId: 'run', role: 'user', content: 'Check the project notes.', createdAt: 1 },
    { id: 'action', runId: 'run', role: 'tool', toolName: 'read_file', content: 'Internal action result', createdAt: 2 },
    { id: 'reply', runId: 'run', role: 'assistant', content: 'The project is ready for review.', createdAt: 3 }
  ]
}

const render = (showToolDetails: boolean, current = detail) => renderToStaticMarkup(createElement(ChatTranscript, { detail: current, running: false, statusLabel: '', showToolDetails, avatar: null, api: {} as RiotBridge, onUndo() {}, onError() {}, onOlderPage() {} }))

describe('optional completed actions in chat', () => {
  it('hides successful action rows and raw results while keeping the reply', () => {
    const html = render(false)
    expect(html).toContain('The project is ready for review.')
    expect(html).not.toContain('Completed · 1 action')
    expect(html).not.toContain('Internal action result')
    expect(html).not.toContain('class="tool"')
  })

  it('shows expandable history when enabled without opening technical logs automatically', () => {
    const html = render(true)
    expect(html).toContain('Completed · 1 action · View details')
    expect(html).toContain('Internal action result')
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|>)/)
  })

  it('keeps failed actions and interrupted turns visible with the preference off', () => {
    const failed = { ...detail, messages: detail.messages.map(message => message.role === 'tool' ? { ...message, toolError: 'The file could not be read.' } : message) }
    const html = render(false, failed)
    expect(html).toContain('1 failed')
    expect(html).toContain('The file could not be read.')
    expect(render(false, { ...detail, run: { ...detail.run!, status: 'stopped' } })).toContain('Interrupted · 1 action finished')
  })
})
