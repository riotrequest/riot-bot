export type ProviderId = 'openai' | 'openrouter'

export type RunStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted' | 'paused'

export type RunTrigger = 'user_message' | 'provider_check' | 'bot_setup'

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
  maxOutputTokens: number
  maxToolOutputChars: number
  maxTaskDurationMs: number
  maxEstimatedSpendPerTaskUsd: number | null
  maxEstimatedSpendPerDayUsd: number | null
  inputUsdPerMillion: number | null
  outputUsdPerMillion: number | null
  botSpendPerDayUsd: number | null
  streaming: boolean
  toolsEnabled: boolean
  pinnedInstructions: string
  maxFileReadBytes: number
  webFetchTimeoutMs: number
  webFetchMaxBytes: number
  terminalTimeoutMs: number
  terminalMaxOutputChars: number
  searchUrlTemplate: string
}

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
  showToolDetails: boolean
}

export interface ChatMessageView {
  id: string
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
  provenance: 'user_explicit' | 'assistant_tool' | 'user_edit'
}

export interface ApprovalView {
  id: string
  kind: 'terminal' | 'browser'
  title: string
  command: string
  cwd: string
  timeoutMs: number
  warning: string
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
}

export interface CredentialStatus {
  storage: 'os' | 'session'
  encryptionAvailable: boolean
  explanation: string
  openaiConfigured: boolean
  openrouterConfigured: boolean
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
  preferences: AppPreferences
  credentials: CredentialStatus
  usage: UsageSummary
  activity: ActivityEntry[]
  memories: Memory[]
  skills: Skill[]
  skillProposal: SkillProposal | null
  pendingApproval: ApprovalView | null
}

export interface BotDraft {
  purpose: string
  name: string
  provider: ProviderId
  model: string
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

export type AppEvent =
  | { type: 'delta'; conversationId: string; message: ChatMessageView }
  | { type: 'message'; conversationId: string; message: ChatMessageView }
  | { type: 'run'; conversationId: string; run: RunState; task: TaskState | null }
  | { type: 'approval'; approval: ApprovalView | null }
  | { type: 'memories-changed' }
  | { type: 'skills-changed' }
  | { type: 'skill-proposal'; proposal: SkillProposal | null }
  | { type: 'usage'; usage: UsageSummary }
  | { type: 'browser-progress'; progress: string }
  | { type: 'error'; message: string }

export interface RiotBridge {
  getSnapshot(): Promise<Snapshot>
  createBot(draft: BotDraft): Promise<BotCreateResult>
  selectBot(id: string): Promise<Snapshot>
  updateBot(patch: { name?: string; purpose?: string; instructions?: string }): Promise<Bot>
  openWorkspace(): Promise<void>
  setAvatar(input: { kind: 'builtin' | 'emoji'; value: string; background: string } | { kind: 'image'; background: string; bytes: number[] }): Promise<Bot>
  removeReaction(id: string): Promise<void>
  updatePreferences(patch: Partial<AppPreferences>): Promise<AppPreferences>
  createConversation(): Promise<Conversation>
  deleteConversation(id: string): Promise<void>
  openConversation(id: string): Promise<ConversationDetail>
  searchHistory(query: string): Promise<HistoryHitView[]>
  openBrowser(): Promise<string>
  closeBrowser(): Promise<string>
  takeoverBrowser(): Promise<string>
  resumeBrowser(): Promise<string>
  installBrowser(): Promise<string>
  openExternal(url: string): Promise<void>
  sendMessage(conversationId: string, text: string): Promise<RunState>
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
  setCredential(provider: ProviderId, secret: string): Promise<CredentialSaveResult>
  clearCredential(provider: ProviderId): Promise<CredentialStatus>
  pickWorkspace(): Promise<string | null>
  resolveApproval(id: string, approved: boolean): Promise<void>
  undoEdit(id: string): Promise<{ ok: boolean; message: string }>
  copyText(text: string): Promise<void>
  onEvent(handler: (event: AppEvent) => void): () => void
}

export const COST_DISCLAIMER =
  'Estimated amounts reserve Riot Bot limits. They are not a cap on the provider invoice. Reported amounts are what the provider sent back and can still differ from the bill. Unsettled amounts are reservations from calls that stopped or crashed before a final usage report; they keep counting so a restart cannot quietly reset a limit.'

export const TERMINAL_WARNING =
  'A terminal command runs on this computer. The workspace folder does not contain it, and Riot Bot does not sandbox the shell. Every exact command asks for approval. Approving one command does not approve the next one.'

export const BROWSER_ACTION_WARNING =
  'This browser action can change something on a website. Search and ordinary reading do not ask first. Approving this action does not approve the next one.'

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return 'unknown'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs !== 0 && abs < 0.0001) return `${sign}$${abs.toExponential(2)}`
  return `${sign}$${abs.toFixed(4)}`
}
