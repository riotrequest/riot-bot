import { app as electronApp, clipboard, dialog, ipcMain, Menu, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../core/attachments'
import type { RiotService } from '../core/service'
import { isId } from '../core/ids'
import type { SkillDraft } from '../core/skills'
import { publicErrorMessage } from '../core/redact'
import type { AppNotice, AppPreferences, BotDraft, BotMenuAction, GmailRuleDraftInput, ProviderId, PublicSettings } from '../shared/types'
import type { ElectronCredentialStore } from './credentials'
import type { ScheduleDraft } from '../shared/types'

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
  'replyMode',
  'maxToolOutputChars',
  'maxTaskDurationMs',
  'maxEstimatedSpendPerTaskUsd',
  'maxEstimatedSpendPerDayUsd',
  'inputUsdPerMillion',
  'outputUsdPerMillion',
  'botSpendPerDayUsd',
  'streaming',
  'toolsEnabled',
  'autoMemory',
  'autoSkillSuggestions',
  'gmailAccount',
  'gmailAccess',
  'pinnedInstructions',
  'maxFileReadBytes',
  'webFetchTimeoutMs',
  'webFetchMaxBytes',
  'terminalTimeoutMs',
  'terminalMaxOutputChars',
  'searchUrlTemplate',
  'trustedSites',
  'allowSensitiveFiles'
]

export function registerIpc(getApp: () => RiotService, getWindow: () => BrowserWindow | null, credentials: ElectronCredentialStore, notices: { list: () => AppNotice[]; dismiss: (id: string) => AppNotice[] } = { list: () => [], dismiss: () => [] }): void {
  const handle = (channel: string, fn: (app: RiotService, args: unknown[]) => unknown): void => {
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
  handle('notices:list', () => notices.list())
  handle('notices:dismiss', (_app, args) => notices.dismiss(typeof args[0] === 'string' ? args[0] : ''))
  handle('gmail:status', app => app.getGmailStatus())
  handle('gmail:connect', app => app.connectGmail())
  handle('gmail:cancelLogin', app => app.cancelGmailLogin())
  handle('gmail:disconnect', app => app.disconnectGmail())
  handle('gmail-rules:list', app => app.listGmailRules())
  handle('gmail-rules:save', (app, args) => app.saveGmailRule(gmailRuleInput(args[0])))
  handle('gmail-rules:enabled', (app, args) => {
    if (typeof args[1] !== 'boolean') throw new Error('Choose whether this reply rule is on.')
    return app.setGmailRuleEnabled(requireId(args[0]), args[1])
  })
  handle('gmail:importClient', async app => {
    const window = getWindow()
    if (!window) throw new Error('Open Riot Bot before choosing a Google setup file.')
    const picked = await dialog.showOpenDialog(window, { title: 'Choose your Google Desktop app setup file', properties: ['openFile'], filters: [{ name: 'Google OAuth setup', extensions: ['json'] }] })
    if (picked.canceled || !picked.filePaths[0]) return null
    const stat = await fs.stat(picked.filePaths[0])
    if (!stat.isFile() || stat.size > 20000) throw new Error('Choose a small Google OAuth Desktop app JSON file.')
    return app.setGmailClient(await fs.readFile(picked.filePaths[0], 'utf8'))
  })
  handle('jobs:queue', (app,args) => app.queueMessage(requireId(args[0]),requireText(args[1],'Write a message first.'),args[2] == null ? [] : requireAttachmentIds(args[2])))
  handle('jobs:list', (app,args) => app.listJobs(args[0] === 'app' ? 'app' : 'bot'))
  handle('schedules:list', app => app.listSchedules())
  handle('schedules:save', (app, args) => app.saveSchedule(scheduleDraft(args[0]), args[1] == null ? undefined : requireId(args[1])))
  handle('schedules:manage', (app, args) => app.manageSchedule(requireId(args[0]), args[1] as 'pause' | 'resume' | 'cancel'))
  handle('schedules:runNow', (app, args) => app.runScheduleNow(requireId(args[0])))
  handle('jobs:cancel', (app,args) => app.cancelJob(requireId(args[0])))
  handle('jobs:resume', (app,args) => app.resumeJob(requireId(args[0])))
  handle('artifacts:list', (app,args) => app.listArtifacts(typeof args[0] === 'string' ? args[0] : ''))
  handle('artifacts:reveal', (app,args) => app.revealArtifact(requireId(args[0])))
  handle('bots:create', (app, args) => app.createBot(botDraft(args[0])))
  handle('bots:select', (app, args) => app.selectBot(requireId(args[0])))
  handle('bots:rename', (app, args) => {
    const id = requireId(args[0])
    if (app.getSnapshot().bot?.id !== id) throw new Error('Select this bot again before renaming it.')
    return app.updateBot({ name: requireText(args[1], 'Give your bot a name.') })
  })
  handle('bots:menu', (app, args) => {
    const id = requireId(args[0]), snapshot = app.getSnapshot(), bot = snapshot.bots.find(item => item.id === id)
    const window = getWindow(), point = args[1] as { x?: unknown; y?: unknown } | null
    if (!bot || !window || window.isDestroyed()) throw new Error('That bot is no longer available.')
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('The menu position was not valid.')
    const bounds = window.getContentBounds(), zoom = window.webContents.getZoomFactor()
    const x = Math.round(Math.max(0, Math.min(bounds.width, point.x * zoom)))
    const y = Math.round(Math.max(0, Math.min(bounds.height, point.y * zoom)))
    const running = snapshot.runningBotIds?.includes(id) || snapshot.runningBotId === id
    return new Promise<BotMenuAction | null>(resolve => {
      let action: BotMenuAction | null = null
      const menu = Menu.buildFromTemplate([
        { label: bot.name.replace(/&/g, '&&'), enabled: false },
        { type: 'separator' },
        { label: 'Rename bot…', click: () => { action = 'rename' } },
        { label: 'Bot settings', click: () => { action = 'settings' } },
        { label: 'Open working folder', enabled: Boolean(bot.workspacePath), click: () => { action = 'open-workspace' } },
        { type: 'separator' },
        { label: running ? 'Delete bot… (stop work first)' : 'Delete bot…', enabled: !running, click: () => { action = 'delete' } }
      ])
      // Let the menu's click handler finish before resolving a dismissal.
      menu.popup({ window, x, y, callback: () => setImmediate(() => resolve(action)) })
    })
  })
  handle('bots:delete', (app,args) => app.deleteBot(requireId(args[0]),requireText(args[1],'Confirm this bot’s deletion first.')))
  handle('bots:update', (app, args) => app.updateBot(botPatch(args[0])))
  handle('bots:openWorkspace', (app) => {
    app.openWorkspace()
  })
  handle('workspace:reveal', (app, args) => app.revealWorkspaceFile(requireText(args[0], 'Choose a workspace file.'), args[1] == null ? undefined : requireId(args[1])))
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
  handle('settings:updateApp', (app, args) => {
    const patch = pickSettings(args[0])
    return app.updateAppSettings({ ...(patch.provider !== undefined ? { provider: requireProvider(patch.provider) } : {}), ...(patch.model !== undefined ? { model: patch.model } : {}), ...(patch.maxEstimatedSpendPerDayUsd !== undefined ? { maxEstimatedSpendPerDayUsd: patch.maxEstimatedSpendPerDayUsd } : {}), ...researchSettingsPatch(args[0]) })
  })
  handle('codex:status', (app) => app.getCodexStatus())
  handle('codex:connect', (app) => app.connectCodex())
  handle('codex:cancelLogin', (app) => app.cancelCodexLogin())
  handle('codex:disconnect', (app) => app.disconnectCodex())
  handle('credentials:set', (app, args) => app.setCredential(requireApiProvider(args[0]), requireSecret(args[1])))
  handle('credentials:clear', (app, args) => app.clearCredential(requireApiProvider(args[0])))
  handle('research:setKey', (app, args) => app.setResearchKey(requireResearchProvider(args[0]), requireSecret(args[1])))
  handle('research:clearKey', (app, args) => app.clearResearchKey(requireResearchProvider(args[0])))
  handle('research:checkKey', (app, args) => app.checkResearchKey(requireResearchProvider(args[0])))
  handle('logins:save',(app,args)=>{
    const input=args[0] as Record<string,unknown>|null
    if(!input||typeof input!=='object')throw new Error('Enter the website login.')
    return app.saveLogin({url:requireText(input.url,'Enter an HTTPS website.'),username:requireText(input.username,'Enter the username.'),password:requireText(input.password,'Enter the password.')})
  })
  handle('logins:remove',(app,args)=>app.removeLogin(requireId(args[0])))
  handle('workspace:pick', async () => {
    const parent = getWindow()
    const options = { properties: ['openDirectory' as const], title: 'Choose a workspace folder' }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })
  handle('approvals:resolve', (app, args) => {
    if(typeof args[1]!=='boolean'||args[2]!=null&&typeof args[2]!=='boolean')throw new Error('Choose whether to allow this request.')
    app.resolveApproval(requireId(args[0]), args[1], args[2]===true)
  })
  handle('edits:undo', (app, args) => app.undoEdit(requireId(args[0])))
}

function assertSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): void {
  if (!window || event.sender !== window.webContents || event.senderFrame!==window.webContents.mainFrame) throw new Error('Rejected an unexpected message.')
  const url = event.senderFrame?.url ?? ''
  const devUrl = electronApp.isPackaged?undefined:process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    if (new URL(url).origin!==new URL(devUrl).origin) throw new Error('Rejected an unexpected message.')
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
    provider: record.provider == null ? undefined : requireProvider(record.provider),
    model: typeof record.model === 'string' ? record.model : undefined,
    workspaceKind: record.workspaceKind === 'existing' ? 'existing' : 'suggested',
    workspacePath: typeof record.workspacePath === 'string' ? record.workspacePath : '',
    avatarKind: record.avatarKind === 'emoji' || record.avatarKind === 'image' ? record.avatarKind : 'builtin',
    avatarValue: typeof record.avatarValue === 'string' ? record.avatarValue : '',
    avatarBackground: typeof record.avatarBackground === 'string' ? record.avatarBackground : '',
    avatarBytes: bytes
  }
}

function scheduleDraft(value: unknown): ScheduleDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Describe the reminder or scheduled task first.')
  const input = value as Record<string, unknown>
  return { kind: input.kind as ScheduleDraft['kind'], title: requireText(input.title, 'Add a title.'), instructions: requireText(input.instructions, 'Describe the reminder or task.'), startAt: requireText(input.startAt, 'Choose a date and time.'), repeat: input.repeat as ScheduleDraft['repeat'], timezone: requireText(input.timezone, 'Choose a time zone.') }
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

function gmailRuleInput(value: unknown): GmailRuleDraftInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The reply rule was not valid.')
  const record = value as Record<string, unknown>
  if (record.enabled != null && typeof record.enabled !== 'boolean') throw new Error('Choose whether this reply rule is on.')
  if (record.dailySendLimit != null && (typeof record.dailySendLimit !== 'number' || !Number.isInteger(record.dailySendLimit))) throw new Error('The daily send limit must be a whole number.')
  return {
    id: record.id == null ? undefined : requireId(record.id),
    title: requireText(record.title, 'Name this reply rule.'),
    recipients: stringList(record.recipients, 'Recipients'),
    threadIds: stringList(record.threadIds, 'Conversations'),
    templates: stringList(record.templates, 'Replies'),
    excludedRecipients: stringList(record.excludedRecipients, 'Excluded recipients'),
    excludedPhrases: stringList(record.excludedPhrases, 'Review phrases'),
    dailySendLimit: typeof record.dailySendLimit === 'number' ? record.dailySendLimit : 5,
    enabled: record.enabled === true
  }
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label} were not valid.`)
  return value
}

function requireResearchProvider(value: unknown): 'tavily' | 'firecrawl' {
  if (value === 'tavily' || value === 'firecrawl') return value
  throw new Error('Choose Tavily or Firecrawl.')
}

function researchSettingsPatch(value: unknown): { webResearch?: 'automatic' | 'browser' | 'connection'; researchDailyCap?: number; researchTavily?: boolean; researchFirecrawl?: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const patch: { webResearch?: 'automatic' | 'browser' | 'connection'; researchDailyCap?: number; researchTavily?: boolean; researchFirecrawl?: boolean } = {}
  if ('webResearch' in record) {
    if (record.webResearch !== 'automatic' && record.webResearch !== 'browser' && record.webResearch !== 'connection') throw new Error('Choose a web search mode.')
    patch.webResearch = record.webResearch
  }
  if ('researchDailyCap' in record) {
    if (typeof record.researchDailyCap !== 'number' || !Number.isInteger(record.researchDailyCap) || record.researchDailyCap < 1 || record.researchDailyCap > 200) throw new Error('Use a daily request cap from 1 to 200.')
    patch.researchDailyCap = record.researchDailyCap
  }
  if ('researchTavily' in record) patch.researchTavily = record.researchTavily === true
  if ('researchFirecrawl' in record) patch.researchFirecrawl = record.researchFirecrawl === true
  return patch
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
