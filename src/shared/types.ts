export type ProviderId = 'openai' | 'openrouter' | 'custom' | 'codex'
export type ApiProviderId = Exclude<ProviderId, 'codex'>

export interface CodexStatus {
  installed: boolean
  connected: boolean
  plan: string | null
  email: string | null
  loginPending: boolean
  models: { id: string; name: string }[]
  limits: { name: string; usedPercent: number; resetsAt: number | null }[]
  note: string
}

export type RunStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted' | 'paused'

export type RunTrigger = 'user_message' | 'provider_check' | 'bot_setup' | 'scheduled_task'
export type BotMenuAction = 'rename' | 'settings' | 'open-workspace' | 'delete'

export interface PublicSettings {
  provider: ProviderId
  model: string
  workspacePath: string
  workspaceEditing: boolean
  /** Automatic fitting uses the model window. Manual fitting uses the input working budget. */
  contextMode: 'automatic' | 'manual'
  contextTokenBudget: number
  modelContextTokens: number | null
  maxModelCallsPerTask: number
  /** Browser steps one task may take: opening, reading, clicking, typing and so on. */
  maxBrowserActionsPerTask: number
  maxOutputTokens: number
  replyMode: 'automatic' | 'manual'
  maxToolOutputChars: number
  maxTaskDurationMs: number
  maxEstimatedSpendPerTaskUsd: number | null
  maxEstimatedSpendPerDayUsd: number | null
  inputUsdPerMillion: number | null
  outputUsdPerMillion: number | null
  botSpendPerDayUsd: number | null
  streaming: boolean
  toolsEnabled: boolean
  autoMemory: boolean
  autoSkillSuggestions: boolean
  gmailAccount: string
  gmailAccess: 'off' | 'drafts' | 'send'
  pinnedInstructions: string
  maxFileReadBytes: number
  webFetchTimeoutMs: number
  webFetchMaxBytes: number
  terminalTimeoutMs: number
  terminalMaxOutputChars: number
  searchUrlTemplate: string
  trustedSites: string[]
  allowSensitiveFiles: boolean
}

export interface LoginDraft {url:string;username:string;password:string}
export interface SavedLogin {id:string;origin:string;username:string}
export interface SavedServerLogin {id:string;host:string;port:number;username:string}

export interface Conversation {
  id: string
  botId: string
  title: string
  createdAt: number
  updatedAt: number
  summary: string
}

export interface AvatarView {
  kind: 'builtin' | 'emoji' | 'image'
  value: string
  background: string
  imageUrl: string | null
}

export interface Bot {
  id: string
  name: string
  purpose: string
  instructions: string
  /** The default voice for the bot's role, from its name and purpose. Its instructions refine it. */
  voice: { role: string; style: string }
  workspacePath: string
  avatar: AvatarView
  createdAt: number
  updatedAt: number
}

export interface Reaction {
  id: string
  messageId: string
  emoji: string
  label: string
  createdAt: number
}

export interface AppPreferences {
  /** Show expandable completed-action history in all chats. Errors remain visible either way. */
  showToolDetails: boolean
}

export type WebResearchMode = 'automatic' | 'browser' | 'connection'

export interface AppSettings {
  provider: ProviderId
  model: string
  /** Base URL of the user's OpenAI-compatible endpoint, such as http://localhost:11434/v1. Blank when not set up. */
  customBaseUrl: string
  /** Context length the user entered for the custom endpoint. Bots can override it with their own capacity. */
  customContextTokens: number | null
  maxEstimatedSpendPerDayUsd: number | null
  webResearch: WebResearchMode
  researchDailyCap: number
  researchTavily: boolean
  researchFirecrawl: boolean
}

export interface AttachmentView {
  id: string
  name: string
  kind: 'image' | 'text'
  mimeType: string
  size: number
  width: number | null
  height: number | null
  previewUrl: string | null
}

export interface ChatMessageView {
  id: string
  runId?: string
  runStatus?: RunStatus
  role: 'user' | 'assistant' | 'tool' | 'notice'
  content: string
  createdAt: number
  toolCalls?: { id: string; name: string; arguments: string }[]
  toolName?: string
  toolCallId?: string
  reactions?: Reaction[]
  toolStartedAt?: number
  toolEndedAt?: number | null
  toolError?: string | null
  interrupted?: boolean
  attachments?: AttachmentView[]
}

export interface RunState {
  id: string
  botId: string
  conversationId: string
  status: RunStatus
  trigger: RunTrigger
  startedAt: number
  endedAt: number | null
  modelCalls: number
  note: string
}

export interface TaskState {
  id: string
  runId: string
  objective: string
  completedSteps: string[]
  outstandingSteps: string[]
  result: string | null
  status: string
}

export interface ConversationDetail {
  conversation: Conversation
  messages: ChatMessageView[]
  run: RunState | null
  task: TaskState | null
  olderMessagesCursor?: string | null
}

export interface MessagePage {
  conversationId: string
  messages: ChatMessageView[]
  olderMessagesCursor: string | null
}

export interface Memory {
  id: string
  content: string
  kind: 'preference' | 'project' | 'decision' | 'fact'
  pinned: boolean
  createdAt: number
  updatedAt: number
  sourceMessageId: string | null
  conversationId: string | null
  provenance: 'user_explicit' | 'assistant_tool' | 'user_edit' | 'automatic'
}

export interface ApprovalView {
  id: string
  kind: 'terminal' | 'browser' | 'codex' | 'email' | 'site' | 'gmail-rule'
  title: string
  command: string
  cwd: string
  timeoutMs: number
  warning: string
  email?: EmailPreview
  gmailRule?: GmailRulePreview
  siteOrigin?: string
  /** Label for the approve button when the default wording does not fit. */
  confirmLabel?: string
}

export interface GmailStatus {
  configured: boolean
  connected: boolean
  connecting: boolean
  email: string | null
  persistent: boolean
  note: string
}

export interface EmailPreview {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
}

export interface GmailRulePreview {
  id: string
  revision: number
  title: string
  account: string
  recipients: string[]
  threadIds: string[]
  templates: string[]
  excludedRecipients: string[]
  excludedPhrases: string[]
  dailySendLimit: number
  limits: string
}

export interface GmailRuleView {
  id: string
  account: string
  enabled: boolean
  revision: number
  title: string
  recipients: string[]
  threadIds: string[]
  templates: string[]
  excludedRecipients: string[]
  excludedPhrases: string[]
  dailySendLimit: number
  sendsToday: number
  appliesNow: boolean
  blockedReason: string
  updatedAt: number
}

export interface GmailSendActivity {
  id: string
  account: string
  draftId: string
  ruleId: string | null
  revision: number | null
  decision: 'allow' | 'ask' | 'deny'
  reason: string
  outcome: 'sent' | 'uncertain' | 'declined' | 'not-sent'
  messageId: string | null
  summary: string
  createdAt: number
}

export interface GmailRuleDraftInput {
  id?: string
  title: string
  recipients: string[]
  threadIds: string[]
  templates: string[]
  excludedRecipients: string[]
  excludedPhrases: string[]
  dailySendLimit: number
  enabled: boolean
}

export interface ActivityTool {
  name: string
  outcome: string | null
  error: string | null
  argumentsPreview: string
  resultPreview: string
  startedAt: number
  endedAt: number | null
}

export interface ContextView {
  contextLimit: number
  replyAllowance: number
  estimatedInputTokens: number
  reportedInputTokens: number | null
  instructionsTokens: number
  memoriesTokens: number
  summaryTokens: number
  skillsTokens: number
  historyTokens: number
  toolsTokens: number
  otherTokens: number
  memoryIds: string[]
  skills: { id: string; name: string; detail: 'catalog' | 'full' }[]
  compacted: boolean
  omittedCount: number
  note: string
  modelContextTokens?: number | null
  assemblyTarget?: number
  outputReserve?: number
  capacitySource?: 'provider' | 'configured' | 'fallback' | 'manual'
}

export interface Skill {
  id: string
  name: string
  description: string
  procedure: string
  pitfalls: string
  verification: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  sourceConversationId: string | null
  sourceMessageId: string | null
  version: number
  deletedAt: number | null
}

export interface SkillVersion {
  id: string
  skillId: string
  version: number
  name: string
  description: string
  procedure: string
  pitfalls: string
  verification: string
  createdAt: number
}

export interface SkillProposal {
  id: string
  name: string
  description: string
  procedure: string
  pitfalls: string
  verification: string
  updateSkillId: string | null
  conversationId: string | null
  botId: string
}

export interface ProviderCheckPlan {
  maxCalls: number
  maxOutputTokens: number
  estimatedUsd: number | null
  priceKnown: boolean
  message: string
  blockedReason: string | null
}

export interface ProviderCheckStep {
  name: string
  ok: boolean
  detail: string
}

export interface ProviderCheckResult {
  steps: ProviderCheckStep[]
  modelCalls: number
}

export interface ActivityEntry {
  id: string
  runId: string
  trigger: string
  purpose: string
  provider: string
  model: string
  startedAt: number
  endedAt: number | null
  outcome: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheTokens: number | null
  tokenSource: 'reported' | 'estimated' | null
  estimatedCostUsd: number | null
  reportedCostUsd: number | null
  costLabel: string | null
  error: string | null
  attempt: number
  tools: ActivityTool[]
  context: ContextView | null
}

export interface UsageSummary {
  day: string
  modelCalls: number
  estimatedUsd: number
  reportedUsd: number
  unsettledUsd: number
  disclaimer: string
  codexTurns?: number
}

export interface CredentialStatus {
  storage: 'os' | 'session'
  encryptionAvailable: boolean
  explanation: string
  openaiConfigured: boolean
  openrouterConfigured: boolean
  /** True when a custom endpoint address is saved. Its API key is optional. */
  customConfigured: boolean
  customKeyConfigured: boolean
  tavilyConfigured: boolean
  firecrawlConfigured: boolean
}

export interface ResearchCheck {
  ok: boolean
  message: string
}

export interface CredentialSaveResult {
  status: CredentialStatus
  persistent: boolean
  message: string
}

export interface BrowserView {
  installed: boolean
  browserName?: string | null
  open: boolean
  takeover: boolean
  installing: boolean
  progress: string
  downloadNote: string
}

export interface HistoryHitView {
  messageId: string
  conversationId: string
  title: string
  role: string
  snippet: string
}

export interface Snapshot {
  bots: Bot[]
  bot: Bot | null
  runningBotId: string | null
  ongoingConversationId: string | null
  conversations: Conversation[]
  current: ConversationDetail | null
  browser: BrowserView
  settings: PublicSettings
  appSettings: AppSettings
  preferences: AppPreferences
  credentials: CredentialStatus
  usage: UsageSummary
  activity: ActivityEntry[]
  memories: Memory[]
  skills: Skill[]
  skillProposal: SkillProposal | null
  pendingApproval: ApprovalView | null
  draftAttachments: AttachmentView[]
  codex: CodexStatus
  gmail: GmailStatus
  jobs?: JobView[]
  artifacts?: ArtifactView[]
  runningBotIds?: string[]
  schedules: ScheduleView[]
  savedLogins?: SavedLogin[]
  savedServerLogins?: SavedServerLogin[]
}

export type ScheduleRepeat = 'once' | 'daily' | 'weekdays' | 'weekly'
export interface ScheduleDraft {
  kind: 'reminder' | 'task'
  title: string
  instructions: string
  startAt: string
  repeat: ScheduleRepeat
  timezone: string
}
export interface ScheduleView {
  id: string
  botId: string
  conversationId: string
  kind: 'reminder' | 'task'
  title: string
  instructions: string
  context: string
  startAt: number
  repeat: ScheduleRepeat
  timezone: string
  nextRunAt: number | null
  state: 'active' | 'paused' | 'completed' | 'cancelled'
  lastRunAt: number | null
  lastStatus: string
  lastNote: string
  lastJobId: string | null
  createdAt: number
  updatedAt: number
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'paused' | 'failed' | 'interrupted' | 'cancelled'

export interface DeleteBotResult {
  snapshot: Snapshot
  cleanupWarning: string | null
}

export interface JobView {
  id: string
  botId: string
  conversationId: string
  text: string
  attachmentCount: number
  status: JobStatus
  runId: string | null
  createdAt: number
  startedAt: number | null
  endedAt: number | null
  note: string
  attempt: number
  awaitingApproval: boolean
}

export interface ArtifactView {
  id: string
  botId: string
  jobId: string | null
  runId: string | null
  name: string
  relativePath: string
  bytes: number
  sha256: string
  version: number
  createdAt: number
}

export interface BotDraft {
  purpose: string
  name: string
  provider?: ProviderId
  model?: string
  workspaceKind: 'suggested' | 'existing'
  workspacePath: string
  avatarKind: 'builtin' | 'emoji' | 'image'
  avatarValue: string
  avatarBackground: string
  avatarBytes?: number[]
}

export interface BotCreateResult {
  bot: Bot
  conversation: Conversation
  status: string
}

export interface AppNotice {
  id: string
  kind: 'reminder' | 'attention'
  title: string
  body: string
  botId: string
}

export interface NoticeBridge {
  onChange(handler: (notices: AppNotice[]) => void): () => void
  dismiss(id: string): void
  open(id: string): void
  resize(height: number): void
}

export type AppUpdateStatus =
  | { status: 'unavailable' | 'idle' | 'checking' | 'current' }
  | { status: 'available' | 'ready' | 'installing'; version: string }
  | { status: 'downloading'; version: string; progress: number }
  | { status: 'error'; message: string }

export type AppUpdateState = AppUpdateStatus & { currentVersion: string }

export type AppEvent =
  | { type: 'update-state'; update: AppUpdateState }
  | { type: 'gmail-status'; status: GmailStatus }
  | { type: 'notices-changed'; notices: AppNotice[] }
  | { type: 'gmail-rules-changed' }
  | { type: 'schedules-changed' }
  | { type: 'reminder-fired'; schedule: ScheduleView }
  | { type: 'open-schedule'; botId: string }
  | { type: 'open-jobs'; botId: string }
  | { type: 'jobs-changed' }
  | { type: 'artifacts-changed' }
  | { type: 'codex-status'; status: CodexStatus }
  | { type: 'delta'; conversationId: string; message: ChatMessageView }
  | { type: 'message'; conversationId: string; message: ChatMessageView }
  | { type: 'run'; conversationId: string; run: RunState; task: TaskState | null }
  | { type: 'approval'; approval: ApprovalView | null }
  | { type: 'memories-changed' }
  | { type: 'learning-settings'; botId: string; autoMemory: boolean; autoSkillSuggestions: boolean }
  | { type: 'bot-renamed'; botId: string; name: string }
  | { type: 'skills-changed' }
  | { type: 'skill-proposal'; proposal: SkillProposal | null }
  | { type: 'usage'; usage: UsageSummary }
  | { type: 'browser-progress'; progress: string }
  | { type: 'error'; message: string }

export interface RiotBridge {
  getSnapshot(): Promise<Snapshot>
  getUpdateState(): Promise<AppUpdateState>
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  getGmailStatus(): Promise<GmailStatus>
  importGmailClient(): Promise<GmailStatus | null>
  connectGmail(): Promise<GmailStatus>
  cancelGmailLogin(): Promise<GmailStatus>
  disconnectGmail(): Promise<GmailStatus>
  listGmailRules(): Promise<{ rules: GmailRuleView[]; activity: GmailSendActivity[] }>
  saveGmailRule(input: GmailRuleDraftInput): Promise<GmailRuleView>
  setGmailRuleEnabled(id: string, enabled: boolean): Promise<GmailRuleView>
  getCodexStatus(): Promise<CodexStatus>
  connectCodex(): Promise<CodexStatus>
  cancelCodexLogin(): Promise<CodexStatus>
  disconnectCodex(): Promise<CodexStatus>
  createBot(draft: BotDraft): Promise<BotCreateResult>
  selectBot(id: string): Promise<Snapshot>
  showBotMenu(id: string, position: { x: number; y: number }): Promise<BotMenuAction | null>
  renameBot(id: string, name: string): Promise<Bot>
  deleteBot(id: string, confirmationName: string): Promise<DeleteBotResult>
  updateBot(patch: { name?: string; purpose?: string; instructions?: string }): Promise<Bot>
  openWorkspace(): Promise<void>
  revealWorkspaceFile(path: string, editId?: string): Promise<void>
  setAvatar(input: { kind: 'builtin' | 'emoji'; value: string; background: string } | { kind: 'image'; background: string; bytes: number[] }): Promise<Bot>
  removeReaction(id: string): Promise<void>
  updatePreferences(patch: Partial<AppPreferences>): Promise<AppPreferences>
  createConversation(): Promise<Conversation>
  deleteConversation(id: string): Promise<void>
  openConversation(id: string): Promise<ConversationDetail>
  loadOlderMessages(conversationId: string, beforeMessageId: string): Promise<MessagePage>
  searchHistory(query: string): Promise<HistoryHitView[]>
  openBrowser(): Promise<string>
  closeBrowser(): Promise<string>
  takeoverBrowser(): Promise<string>
  resumeBrowser(): Promise<string>
  installBrowser(): Promise<string>
  openExternal(url: string): Promise<void>
  sendMessage(conversationId: string, text: string, attachmentIds?: string[]): Promise<RunState>
  queueMessage(conversationId: string, text: string, attachmentIds?: string[]): Promise<JobView>
  listJobs(scope?: 'bot' | 'app'): Promise<JobView[]>
  listSchedules(): Promise<ScheduleView[]>
  saveSchedule(draft: ScheduleDraft, id?: string): Promise<ScheduleView>
  manageSchedule(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<ScheduleView>
  runScheduleNow(id: string): Promise<void>
  cancelJob(id: string): Promise<void>
  resumeJob(id: string): Promise<JobView>
  listArtifacts(query?: string): Promise<ArtifactView[]>
  revealArtifact(id: string): Promise<void>
  pickAttachments(): Promise<AttachmentView[]>
  stageAttachment(input: { botId: string; name: string; bytes: number[] }): Promise<AttachmentView>
  pasteScreenshot(): Promise<AttachmentView>
  removeDraftAttachment(id: string): Promise<void>
  stop(): Promise<void>
  listMemories(query?: string): Promise<Memory[]>
  updateMemory(id: string, content: string): Promise<Memory>
  deleteMemory(id: string): Promise<void>
  pinMemory(id: string, pinned: boolean): Promise<Memory>
  listSkills(): Promise<Skill[]>
  listSkillVersions(id: string): Promise<SkillVersion[]>
  saveSkill(draft: Pick<Skill, 'name' | 'description' | 'procedure' | 'pitfalls' | 'verification'>): Promise<Skill>
  updateSkill(id: string, draft: Pick<Skill, 'name' | 'description' | 'procedure' | 'pitfalls' | 'verification'>): Promise<Skill>
  setSkillEnabled(id: string, enabled: boolean): Promise<Skill>
  deleteSkill(id: string): Promise<void>
  restoreSkillVersion(id: string, version: number): Promise<Skill>
  exportSkills(ids: string[]): Promise<string>
  previewSkillImport(markdown: string): Promise<Pick<Skill, 'name' | 'description' | 'procedure' | 'pitfalls' | 'verification'>>
  importSkill(markdown: string): Promise<Skill>
  resolveSkillProposal(id: string, action: 'save' | 'dismiss', draft?: Pick<Skill, 'name' | 'description' | 'procedure' | 'pitfalls' | 'verification'>): Promise<void>
  planProviderCheck(): Promise<ProviderCheckPlan>
  runProviderCheck(): Promise<ProviderCheckResult>
  listActivity(scope?: 'bot' | 'app'): Promise<ActivityEntry[]>
  getUsage(): Promise<UsageSummary>
  updateSettings(patch: Partial<PublicSettings>): Promise<PublicSettings>
  updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  setCredential(provider: ApiProviderId, secret: string): Promise<CredentialSaveResult>
  clearCredential(provider: ApiProviderId): Promise<CredentialStatus>
  setResearchKey(provider: 'tavily' | 'firecrawl', secret: string): Promise<CredentialSaveResult>
  clearResearchKey(provider: 'tavily' | 'firecrawl'): Promise<CredentialStatus>
  checkResearchKey(provider: 'tavily' | 'firecrawl'): Promise<ResearchCheck>
  pickWorkspace(): Promise<string | null>
  resolveApproval(id: string, approved: boolean, remember?: boolean): Promise<void>
  saveLogin(input: LoginDraft): Promise<{login:SavedLogin;persistent:boolean}>
  removeLogin(id:string): Promise<void>
  removeServerLogin(id:string): Promise<void>
  undoEdit(id: string): Promise<{ ok: boolean; message: string }>
  copyText(text: string): Promise<void>
  listNotices(): Promise<AppNotice[]>
  dismissNotice(id: string): Promise<AppNotice[]>
  onEvent(handler: (event: AppEvent) => void): () => void
}

export const COST_DISCLAIMER =
  'Estimated amounts reserve Riot Bot limits. They are not a cap on the provider invoice. Reported amounts are what the provider sent back and can still differ from the bill. Unsettled amounts are reservations from calls that stopped or crashed before a final usage report; they keep counting so a restart cannot quietly reset a limit.'

export const TERMINAL_WARNING =
  'A terminal command runs on this computer. The workspace folder does not contain it, and Riot Bot does not sandbox the shell. Every exact command asks for approval. Approving one command does not approve the next one.'

export const SERVER_WARNING =
  'Riot Bot signs in to this server with the saved password and runs this command there. It can change or delete anything this account can. Every command asks first.'

export const UPLOAD_WARNING =
  'The website receives this file and can keep it. Riot Bot asks before every upload, even on websites you trust.'

export const BROWSER_ACTION_WARNING =
  'This browser action can change something on a website. Search and ordinary reading do not ask first. Approving this action does not approve the next one.'

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return 'unknown'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs !== 0 && abs < 0.0001) return `${sign}$${abs.toExponential(2)}`
  return `${sign}$${abs.toFixed(4)}`
}
