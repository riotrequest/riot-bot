import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Database } from '../src/core/db'
import { ModelBadge } from '../src/renderer/src/ui'
import type { BotDraft } from '../src/shared/types'
import { makeApp, reopen } from './helpers'

const draft: BotDraft = { name: 'Fresh helper', purpose: 'Help with everyday tasks', workspaceKind: 'suggested', workspacePath: '', avatarKind: 'builtin', avatarValue: 'spark', avatarBackground: '#d4544a' }

describe('app defaults and bot settings', () => {
  it('persists app defaults independently of the selected bot and uses them only for new bots', async () => {
    const { app, dbPath, provider } = makeApp()
    const original = app.getSnapshot().bot!.id
    app.updateSettings({ provider: 'openai', model: 'original-model' })
    app.updateAppSettings({ provider: 'openrouter', model: 'shared-default' })
    expect(app.getSnapshot().settings.model).toBe('original-model')
    const created = await app.createBot(draft)
    expect(app.getSnapshot().settings).toMatchObject({ provider: 'openrouter', model: 'shared-default' })
    app.updateSettings({ model: 'bot-override' })
    app.updatePreferences({ showToolDetails: true })
    app.selectBot(original)
    expect(app.getSnapshot().appSettings).toMatchObject({ provider: 'openrouter', model: 'shared-default' })
    expect(app.getSnapshot().settings.model).toBe('original-model')
    app.selectBot(created.bot.id)
    expect(app.getSnapshot().settings.model).toBe('bot-override')
    expect(provider.calls).toHaveLength(0)
    await app.close()
    const restarted = reopen(dbPath)
    try {
      expect(restarted.app.getSnapshot().appSettings.model).toBe('shared-default')
      expect(restarted.app.getSnapshot().settings.model).toBe('bot-override')
      expect(restarted.app.getSnapshot().preferences.showToolDetails).toBe(true)
      expect(restarted.provider.calls).toHaveLength(0)
    } finally { await restarted.app.close() }
  })

  it('seeds an older installation once and preserves an explicitly cleared default on restart', async () => {
    const { app, dbPath } = makeApp()
    app.updateSettings({ provider: 'openrouter', model: 'legacy-choice' })
    const botId = app.getSnapshot().bot!.id
    await app.close()
    const db = new Database(dbPath)
    db.migrate()
    db.saveAppConfig({ activeBotId: botId, showToolDetails: false, maxEstimatedSpendPerDayUsd: null, webResearch: 'automatic', researchDailyCap: 20, researchTavily: false, researchFirecrawl: false })
    db.close()
    const upgraded = reopen(dbPath)
    expect(upgraded.app.getSnapshot().appSettings).toMatchObject({ provider: 'openrouter', model: 'legacy-choice' })
    upgraded.app.updateAppSettings({ model: '' })
    await upgraded.app.close()
    const restarted = reopen(dbPath)
    try {
      expect(restarted.app.getSnapshot().appSettings.model).toBe('')
      expect(restarted.app.getSnapshot().settings.model).toBe('legacy-choice')
    } finally { await restarted.app.close() }
  })

  it('retains explicit bot model choices and shares the app spending ceiling', async () => {
    const { app, provider } = makeApp()
    try {
      app.updateAppSettings({ provider: 'openai', model: 'default-model', maxEstimatedSpendPerDayUsd: 3 })
      await app.createBot({ ...draft, provider: 'openrouter', model: 'custom-model' })
      expect(app.getSnapshot().settings).toMatchObject({ provider: 'openrouter', model: 'custom-model', maxEstimatedSpendPerDayUsd: 3 })
      expect(app.getSnapshot().appSettings.model).toBe('default-model')
      expect(() => app.updateAppSettings({ maxEstimatedSpendPerDayUsd: -1 })).toThrow()
      expect(app.getSnapshot().appSettings.maxEstimatedSpendPerDayUsd).toBe(3)
      expect(provider.calls).toHaveLength(0)
    } finally { await app.close() }
  })

  it('shows the current model with an accessible route to Bot settings', () => {
    const html = renderToStaticMarkup(React.createElement(ModelBadge, { provider: 'codex', model: 'native-alpha', models: [{ id: 'native-alpha', name: 'Alpha' }], onClick: () => undefined }))
    expect(html).toContain('Current model: ChatGPT / Codex · Alpha. Open Bot settings')
    expect(html).toContain('native-alpha — change in Bot settings')
    expect(renderToStaticMarkup(React.createElement(ModelBadge, { provider: 'openai', model: '', onClick: () => undefined }))).toContain('No model selected. Open Bot settings')
  })
})
