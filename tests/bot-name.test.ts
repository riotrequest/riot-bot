import { describe, expect, it } from 'vitest'
import { nameChangeRequest } from '../src/core/bot-name'
import { makeApp } from './helpers'

const done = { content: 'I cannot rename myself. Change it in Settings.', toolCalls: [] }
const tool = (name: string) => ({ content: '', toolCalls: [{ id: 'rename', name: 'rename_bot', arguments: JSON.stringify({ name }) }] })

describe('bot display name from chat', () => {
  it('recognizes a direct request and ignores a quoted one', () => {
    expect(nameChangeRequest('yoooooooooooo whats good and give yourself a name, bro')).toEqual({ choose: true })
    expect(nameChangeRequest('cool I like it. change your name on here')).toEqual({ choose: true })
    expect(nameChangeRequest('Change your name to Buddy.')).toEqual({ name: 'Buddy' })
    expect(nameChangeRequest("What's your name?")).toBeNull()
    expect(nameChangeRequest('> change your name to Buddy')).toBeNull()
    expect(nameChangeRequest("Don't change your name to Buddy")).toBeNull()
    expect(nameChangeRequest('Call yourself Scout and then fix the bug')).toEqual({ name: 'Scout' })
    expect(nameChangeRequest('From now on, call yourself "scout"')).toEqual({ name: 'scout' })
    expect(nameChangeRequest('Can you please rename yourself to Buddy?')).toEqual({ name: 'Buddy' })
    expect(nameChangeRequest('Your new name is Scout')).toEqual({ name: 'Scout' })
    expect(nameChangeRequest('pick a name for yourself')).toEqual({ choose: true })
  })

  it('does not treat ordinary sentences as a rename', () => {
    for (const text of [
      'Just go by the book on this one.',
      'Can you go by what I said earlier?',
      'Fix the bug. We should go by the spec here.',
      'your name is weird',
      'your name is too long, honestly',
      'Change the name to report.pdf',
      'How do I change the name of this file?',
      'Set the name field to Morgan in the form',
      'Pick a name for the new variable'
    ]) expect(nameChangeRequest(text), text).toBeNull()
  })

  it('hands a vague or lowercase new name to the bot instead of saving it', () => {
    expect(nameChangeRequest('change your name to something cooler')).toEqual({ choose: true })
    expect(nameChangeRequest('your name should be shorter')).toEqual({ choose: true })
    expect(nameChangeRequest('change your name to buddy')).toEqual({ choose: true })
  })

  it('saves a name the user states even when the model refuses', async () => {
    const { app, provider } = makeApp()
    const before = app.getSnapshot().bot!.name
    const id = app.getSnapshot().current!.conversation.id
    const names: string[] = []
    app.onEvent(event => { if (event.type === 'bot-renamed') names.push(event.name) })
    provider.handler = () => done
    try {
      expect((await app.sendMessage(id, 'Change your name to Buddy.')).status).toBe('completed')
      expect(app.getSnapshot().bot?.name).toBe('Buddy')
      expect(app.getSnapshot().bots.find(bot => bot.id === app.getSnapshot().bot?.id)?.name).toBe('Buddy')
      expect(names).toEqual(['Buddy'])
      expect(before).not.toBe('Buddy')
      const offered = provider.calls.some(call => call.tools?.some(item => item.name === 'rename_bot'))
      expect(offered).toBe(false)
    } finally { await app.close() }
  })

  it('lets the bot save a name it chooses when asked', async () => {
    const { app, provider } = makeApp()
    const id = app.getSnapshot().current!.conversation.id
    provider.handler = input => input.messages.at(-1)?.role === 'tool' ? { content: 'Saved. I am Buddy now.', toolCalls: [] } : tool('Buddy')
    try {
      for (const text of ['give yourself a name, bro', 'cool I like it. change your name on here']) {
        app.updateBot({ name: 'Helper' })
        expect((await app.sendMessage(id, text)).status).toBe('completed')
        expect(app.getSnapshot().bot?.name).toBe('Buddy')
        expect(provider.calls.at(-2)?.tools?.some(item => item.name === 'rename_bot')).toBe(true)
      }
    } finally { await app.close() }
  })

  it('keeps the user’s exact name when the model supplies a different one', async () => {
    const { app, provider } = makeApp()
    const id = app.getSnapshot().current!.conversation.id
    provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('Scout')
    try {
      await app.sendMessage(id, 'Please rename yourself to Buddy')
      expect(app.getSnapshot().bot?.name).toBe('Buddy')
    } finally { await app.close() }
  })

  it('does not rename from an unrelated, quoted, or scheduled message', async () => {
    const { app, provider } = makeApp()
    const id = app.getSnapshot().current!.conversation.id
    const original = app.getSnapshot().bot!.name
    provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('Evil')
    try {
      await app.sendMessage(id, "What's your name?")
      expect(app.getSnapshot().bot?.name).toBe(original)
      provider.handler = () => done
      await app.sendMessage(id, '> change your name to Buddy')
      expect(app.getSnapshot().bot?.name).toBe(original)
      provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('Buddy')
      await app.sendMessage(id, 'Change your name to Buddy.', [], 'scheduled_task')
      expect(app.getSnapshot().bot?.name).toBe(original)
      provider.handler = input => input.messages.at(-1)?.role === 'tool' ? done : tool('Evil')
      const before = provider.calls.length
      await app.sendMessage(id, 'Fix the bug. We should go by the spec here.')
      expect(app.getSnapshot().bot?.name).toBe(original)
      expect(provider.calls.slice(before).some(call => call.tools?.some(item => item.name === 'rename_bot'))).toBe(false)
    } finally { await app.close() }
  })
})
