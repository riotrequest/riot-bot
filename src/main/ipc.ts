import { clipboard, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../core/attachments'
import type { RiotApp } from '../core/app'
import { isId } from '../core/ids'
import type { SkillDraft } from '../core/skills'
import { publicErrorMessage } from '../core/redact'
import type { AppPreferences, BotDraft, ProviderId, PublicSettings } from '../shared/types'
import type { ElectronCredentialStore } from './credentials'

const SETTING_KEYS: (keyof PublicSettings)[] = [
  'provider',
  'model',
  'workspacePath',
  'workspaceEditing',
  'contextMode',
  'contextTokenBudget',
  'modelContextTokens',
  'maxModelCallsPerTask',
  'maxOutputTokens',
  'maxToolOutputChars',
  'maxTaskDurationMs',
  'maxEstimatedSpendPerTaskUsd',
  'maxEstimatedSpendPerDayUsd',
  'inputUsdPerMillion',
  'outputUsdPerMillion',
  'botSpendPerDayUsd',
  'streaming',
  'toolsEnabled',
  'pinnedInstructions',
  'maxFileReadBytes',
  'webFetchTimeoutMs',
  'webFetchMaxBytes',
  'terminalTimeoutMs',
  'terminalMaxOutputChars',
  'searchUrlTemplate'
]

export function registerIpc(getApp: () => RiotApp, getWindow: () => BrowserWindow | null, credentials: ElectronCredentialStore): void {
  const handle = (channel: string, fn: (app: RiotApp, args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertSender(event, getWindow())
      try {
        return await fn(getApp(), args)
      } catch (error) {
        throw new Error(publicErrorMessage(error, credentials.secretValues()))
      }
    })
  }

  handle('app:getSnapshot', (app) => app.getSnapshot())
  handle('bots:create', (app, args) => app.createBot(botDraft(args[0])))
  handle('bots:select', (app, args) => app.selectBot(requireId(args[0])))
  handle('bots:update', (app, args) => app.updateBot(botPatch(args[0])))
  handle('bots:openWorkspace', (app) => {
    app.openWorkspace()
  })
  handle('bots:avatar', (app, args) => app.setAvatar(avatarInput(args[0])))
  handle('reactions:remove', (app, args) => {
    app.removeReaction(requireId(args[0]))
  })
  handle('preferences:update', (app, args) => app.updatePreferences(preferencePatch(args[0])))
  handle('clipboard:write', (app, args) => {
    if (typeof args[0] !== 'string') throw new Error('Nothing to copy.')
    app.copyText(args[0])
  })
  handle('conversations:create', (app) => app.createConversation())
  handle('conversations:delete', (app, args) => {
    app.deleteConversation(requireId(args[0]))
  })
  handle('conversations:open', (app, args) => app.openConversation(requireId(args[0])))
  handle('conversations:older', (app, args) => app.loadOlderMessages(requireId(args[0]), requireId(args[1])))
  handle('history:search', (app, args) => app.searchHistory(typeof args[0] === 'string' ? args[0] : ''))
  handle('browser:open', (app) => app.openBrowser())
  handle('browser:close', (app) => app.closeBrowser())
  handle('browser:takeover', (app) => app.takeoverBrowser())
  handle('browser:resume', (app) => app.resumeBrowser())
  handle('browser:install', (app) => app.installBrowser())
  handle('links:open', (app, args) => {
    if (typeof args[0] !== 'string') throw new Error('That link is not valid.')
    app.openExternal(args[0])
  })
  handle('messages:send', (app, args) => {
    if (typeof args[1] !== 'string') throw new Error('Write a message first.')
    return app.sendMessage(requireId(args[0]), args[1], args[2] == null ? [] : requireAttachmentIds(args[2]))
  })
  handle('attachments:stage', (app, args) => {
    const input = attachmentInput(args[0])
    return app.stageAttachments([{ name: input.name, bytes: input.bytes }], input.botId)[0]
  })
  handle('attachments:remove', (app, args) => app.removeDraftAttachment(requireId(args[0])))
  handle('attachments:pick', async (app) => {
    const botId = app.getSnapshot().bot?.id
    if (!botId) throw new Error('Choose a bot first.')
    const parent = getWindow()
    const options = { title: 'Attach PNG/JPEG images or UTF-8 text/code files', properties: ['openFile' as const, 'multiSelections' as const] }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    if (result.filePaths.length > MAX_ATTACHMENTS) throw new Error(`Choose up to ${MAX_ATTACHMENTS} files.`)
    const inputs = await Promise.all(result.filePaths.map(async (file) => {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) throw new Error('Choose regular files of 8 MB or smaller.')
      return { name: path.basename(file), bytes: await fs.readFile(file) }
    }))
    return app.stageAttachments(inputs, botId)
  })
  handle('attachments:pasteScreenshot', async (app) => {
    const botId = app.getSnapshot().bot?.id
    if (!botId) throw new Error('Choose a bot first.')
    const items = await clipboard.read()
    const item = items.find((entry) => entry.types.includes('image/png') || entry.types.includes('image/jpeg'))
    if (!item) throw new Error('No screenshot is on the clipboard. Press Win+Shift+S, capture a region, then paste it here.')
    const type = item.types.includes('image/png') ? 'image/png' : 'image/jpeg'
    const blob = await item.getType(type)
    if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error('That screenshot is larger than 8 MB. Capture a smaller region.')
    return app.stageAttachments([{ name: type === 'image/png' ? 'Screenshot.png' : 'Screenshot.jpg', bytes: Buffer.from(await blob.arrayBuffer()) }], botId)[0]
  })
  handle('run:stop', (app) => {
    app.stop()
  })
  handle('memories:list', (app, args) => app.listMemories(typeof args[0] === 'string' ? args[0] : ''))
  handle('memories:update', (app, args) => {
    if (typeof args[1] !== 'string') throw new Error('The memory text is missing.')
    return app.updateMemory(requireId(args[0]), args[1])
  })
  handle('memories:delete', (app, args) => {
    app.deleteMemory(requireId(args[0]))
  })
  handle('memories:pin', (app, args) => app.pinMemory(requireId(args[0]), Boolean(args[1])))
  handle('skills:list', (app) => app.listSkills())
  handle('skills:versions', (app, args) => app.listSkillVersions(requireId(args[0])))
  handle('skills:save', (app, args) => app.saveSkill(skillDraft(args[0])))
  handle('skills:update', (app, args) => app.updateSkill(requireId(args[0]), skillDraft(args[1])))
  handle('skills:enabled', (app, args) => app.setSkillEnabled(requireId(args[0]), Boolean(args[1])))
  handle('skills:delete', (app, args) => {
    app.deleteSkill(requireId(args[0]))
  })
  handle('skills:restore', (app, args) => app.restoreSkillVersion(requireId(args[0]), requireVersion(args[1])))
  handle('skills:export', (app, args) => app.exportSkills(requireIds(args[0])))
  handle('skills:previewImport', (app, args) => app.previewSkillImport(requireMarkdown(args[0])))
  handle('skills:import', (app, args) => app.importSkill(requireMarkdown(args[0])))
  handle('skills:resolveProposal', (app, args) => {
    const action = args[1] === 'save' || args[1] === 'dismiss' ? args[1] : null
    if (!action) throw new Error('Choose Save or Dismiss.')
    app.resolveSkillProposal(requireId(args[0]), action, args[2] == null ? undefined : skillDraft(args[2]))
  })
  handle('provider:planCheck', (app) => app.planProviderCheck())
  handle('provider:runCheck', (app) => app.runProviderCheck())
  handle('activity:list', (app, args) => app.listActivity(args[0] === 'app' ? 'app' : 'bot'))
  handle('usage:get', (app) => app.getUsage())
  handle('settings:update', (app, args) => app.updateSettings(pickSettings(args[0])))
  handle('codex:status', (app) => app.getCodexStatus())
  handle('codex:connect', (app) => app.connectCodex())
  handle('codex:cancelLogin', (app) => app.cancelCodexLogin())
  handle('codex:disconnect', (app) => app.disconnectCodex())
  handle('credentials:set', (app, args) => app.setCredential(requireApiProvider(args[0]), requireSecret(args[1])))
  handle('credentials:clear', (app, args) => app.clearCredential(requireApiProvider(args[0])))
  handle('workspace:pick', async () => {
    const parent = getWindow()
    const options = { properties: ['openDirectory' as const], title: 'Choose a workspace folder' }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })
  handle('approvals:resolve', (app, args) => {
    app.resolveApproval(requireId(args[0]), Boolean(args[1]))
  })
  handle('edits:undo', (app, args) => app.undoEdit(requireId(args[0])))
}

function assertSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): void {
  if (!window || event.sender !== window.webContents) throw new Error('Rejected an unexpected message.')
  const url = event.senderFrame?.url ?? ''
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    if (!url.startsWith(devUrl)) throw new Error('Rejected an unexpected message.')
    return
  }
  if (!url.startsWith('app://local/')) throw new Error('Rejected an unexpected message.')
}

function requireId(value: unknown): string {
  if (!isId(value)) throw new Error('That item was not found.')
  return value
}

function requireAttachmentIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS || value.some((id) => !isId(id)) || new Set(value).size !== value.length) throw new Error(`Choose up to ${MAX_ATTACHMENTS} different attachments.`)
  return value
}

function attachmentInput(value: unknown): { botId: string; name: string; bytes: Buffer } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a file first.')
  const input = value as Record<string, unknown>
  if (typeof input.name !== 'string' || input.name.length > 500 || !Array.isArray(input.bytes) || !input.bytes.length || input.bytes.length > MAX_ATTACHMENT_BYTES || input.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('That attachment is invalid or larger than 8 MB.')
  return { botId: requireId(input.botId), name: input.name, bytes: Buffer.from(input.bytes) }
}

function requireProvider(value: unknown): ProviderId {
  if (value !== 'openai' && value !== 'openrouter' && value !== 'codex') throw new Error('Choose OpenAI, OpenRouter, or Codex.')
  return value
}

function requireApiProvider(value: unknown): 'openai' | 'openrouter' {
  if (value !== 'openai' && value !== 'openrouter') throw new Error('API keys are only used by OpenAI and OpenRouter.')
  return value
}

function skillDraft(value: unknown): SkillDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The skill text is missing.')
  const record = value as Record<string, unknown>
  return {
    name: requireText(record.name, 'A skill needs a name.'),
    description: requireText(record.description, 'A skill needs a description.'),
    procedure: requireText(record.procedure, 'A skill needs a procedure.'),
    pitfalls: typeof record.pitfalls === 'string' ? record.pitfalls : '',
    verification: typeof record.verification === 'string' ? record.verification : ''
  }
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  return value
}

function requireVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10_000) throw new Error('That skill version is not here.')
  return value
}

function requireIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50 || value.some((item) => !isId(item))) {
    throw new Error('Choose a skill to export.')
  }
  return value
}

function requireMarkdown(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('Paste a skill first.')
  if (value.length > 20_000) throw new Error('That skill file is too large.')
  return value
}

function requireSecret(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Paste an API key first.')
  return value
}

function botDraft(value: unknown): BotDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Describe the bot first.')
  const record = value as Record<string, unknown>
  const bytes = Array.isArray(record.avatarBytes) ? record.avatarBytes.filter((item): item is number => typeof item === 'number').slice(0, 2_000_000) : undefined
  return {
    purpose: requireText(record.purpose, 'Say what this bot should help with.'),
    name: typeof record.name === 'string' ? record.name : '',
    provider: requireProvider(record.provider),
    model: typeof record.model === 'string' ? record.model : '',
    workspaceKind: record.workspaceKind === 'existing' ? 'existing' : 'suggested',
    workspacePath: typeof record.workspacePath === 'string' ? record.workspacePath : '',
    avatarKind: record.avatarKind === 'emoji' || record.avatarKind === 'image' ? record.avatarKind : 'builtin',
    avatarValue: typeof record.avatarValue === 'string' ? record.avatarValue : '',
    avatarBackground: typeof record.avatarBackground === 'string' ? record.avatarBackground : '',
    avatarBytes: bytes
  }
}

function botPatch(value: unknown): { name?: string; purpose?: string; instructions?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The bot details were not valid.')
  const record = value as Record<string, unknown>
  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    purpose: typeof record.purpose === 'string' ? record.purpose : undefined,
    instructions: typeof record.instructions === 'string' ? record.instructions : undefined
  }
}

function avatarInput(value: unknown): { kind: 'builtin' | 'emoji'; value: string; background: string } | { kind: 'image'; background: string; bytes: number[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose an avatar.')
  const record = value as Record<string, unknown>
  const background = typeof record.background === 'string' ? record.background : ''
  if (record.kind === 'image') {
    if (!Array.isArray(record.bytes)) throw new Error('Choose an image file.')
    return { kind: 'image', background, bytes: record.bytes.filter((item): item is number => typeof item === 'number').slice(0, 2_000_000) }
  }
  if (record.kind !== 'builtin' && record.kind !== 'emoji') throw new Error('Choose an avatar.')
  return { kind: record.kind, value: typeof record.value === 'string' ? record.value : '', background }
}

function preferencePatch(value: unknown): Partial<AppPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Those preferences were not valid.')
  const record = value as Record<string, unknown>
  return { showToolDetails: typeof record.showToolDetails === 'boolean' ? record.showToolDetails : undefined }
}

function pickSettings(value: unknown): Partial<PublicSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings were not valid.')
  const record = value as Record<string, unknown>
  const patch: Partial<PublicSettings> = {}
  for (const key of SETTING_KEYS) {
    if (key in record) (patch as Record<string, unknown>)[key] = record[key]
  }
  return patch
}
