import fs from 'fs'
import { COST_DISCLAIMER, type AttachmentView, type Conversation, type Memory, type RunState } from '../shared/types'
import type { PreparedAttachment } from './attachments'
import type { MessageAttachment } from './model'
import { DEFAULT_SEARCH_TEMPLATE, DUCKDUCKGO_SEARCH_TEMPLATE } from './browser-policy'
import { assignBuiltin } from './avatar'
import { newId } from './ids'
import { snippetAround, toFtsOrQuery, toFtsQuery } from './search'
import { DEFAULT_SETTINGS, localDay, sanitizeSettings, type Settings } from './settings'
import { openDatabase, type SqlDatabase } from './sqlite'

type Row = Record<string, unknown>

function row(value: unknown): Row | null {
  if (!value || typeof value !== 'object') return null
  return value as Row
}

function rows(value: unknown[]): Row[] {
  return value.map((item) => row(item)).filter((item): item is Row => item != null)
}

function text(record: Row, key: string): string {
  const value = record[key]
  return value == null ? '' : String(value)
}

function num(record: Row, key: string): number {
  return Number(record[key] ?? 0)
}

function nullableNum(record: Row, key: string): number | null {
  const value = record[key]
  return value == null ? null : Number(value)
}

function bool(record: Row, key: string): boolean {
  return Number(record[key] ?? 0) === 1
}

function parseStrings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

export interface MessageRecord {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'tool' | 'notice'
  content: string
  toolCallsJson: string | null
  toolCallId: string | null
  toolName: string | null
  createdAt: number
  summarized: boolean
  runId: string | null
  attachments?: MessageAttachment[]
}

export interface AttachmentRecord extends AttachmentView {
  botId: string
  messageId: string | null
}

export interface RunRecord {
  id: string
  botId: string
  conversationId: string
  taskId: string | null
  trigger: string
  status: RunState['status']
  startedAt: number
  endedAt: number | null
  modelCalls: number
  stopRequested: boolean
  note: string
}

export interface TaskRecord {
  id: string
  conversationId: string
  runId: string
  objective: string
  completedSteps: string[]
  outstandingSteps: string[]
  result: string | null
  status: string
  createdAt: number
  updatedAt: number
}

export interface MemoryRecord {
  id: string
  botId: string
  content: string
  kind: Memory['kind']
  pinned: boolean
  createdAt: number
  updatedAt: number
  sourceMessageId: string | null
  conversationId: string | null
  provenance: Memory['provenance']
}

export interface ModelRequestRow {
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
  reservedUsd: number | null
  error: string | null
  attempt: number
  day: string
  contextJson: string | null
}

export interface ToolRow {
  id: string
  runId: string
  requestId: string | null
  name: string
  argumentsJson: string
  resultText: string | null
  startedAt: number
  endedAt: number | null
  outcome: string | null
  error: string | null
}

export interface FileEditRecord {
  id: string
  runId: string | null
  path: string
  beforeText: string | null
  afterText: string
  createdFile: boolean
  createdAt: number
  undoneAt: number | null
}

export interface ApprovalRecord {
  id: string
  runId: string
  command: string
  cwd: string
  timeoutMs: number
  status: 'pending' | 'approved' | 'denied'
  createdAt: number
  resolvedAt: number | null
}

export interface HistoryHit {
  messageId: string
  conversationId: string
  role: string
  createdAt: number
  snippet: string
}

export interface SkillRecord {
  id: string
  botId: string
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

export interface SkillVersionRecord {
  id: string
  skillId: string
  version: number
  name: string
  description: string
  procedure: string
  pitfalls: string
  verification: string
  createdAt: number
  sourceConversationId: string | null
  sourceMessageId: string | null
}

export interface ProposalRecord {
  id: string
  botId: string
  conversationId: string | null
  name: string
  description: string
  procedure: string
  pitfalls: string
  verification: string
  updateSkillId: string | null
  status: string
  createdAt: number
}

export interface UsageTotals {
  estimatedUsd: number
  reportedUsd: number
  unsettledUsd: number
  modelCalls: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  tool_call_id TEXT,
  tool_name TEXT,
  created_at INTEGER NOT NULL,
  summarized INTEGER NOT NULL DEFAULT 0,
  run_id TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  message_id UNINDEXED,
  conversation_id UNINDEXED,
  content
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  kind TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_message_id TEXT,
  conversation_id TEXT,
  provenance TEXT NOT NULL,
  deleted_at INTEGER
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  content
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  model_calls INTEGER NOT NULL DEFAULT 0,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  completed_steps_json TEXT NOT NULL DEFAULT '[]',
  outstanding_steps_json TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS model_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_tokens INTEGER,
  token_source TEXT,
  estimated_cost_usd REAL,
  reported_cost_usd REAL,
  cost_label TEXT,
  reserved_usd REAL,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  day TEXT NOT NULL,
  context_json TEXT
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  request_id TEXT,
  name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_text TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS file_edits (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  path TEXT NOT NULL,
  before_text TEXT,
  after_text TEXT NOT NULL,
  created_file INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  undone_at INTEGER
);
CREATE TABLE IF NOT EXISTS budget_reservations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  day TEXT NOT NULL,
  reserved_usd REAL NOT NULL,
  settled_usd REAL,
  status TEXT NOT NULL,
  cost_label TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  command TEXT NOT NULL,
  cwd TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_runs_conv ON runs(conversation_id, started_at);
CREATE INDEX IF NOT EXISTS idx_requests_day ON model_requests(day, started_at);
CREATE INDEX IF NOT EXISTS idx_reservations_day ON budget_reservations(day);
`

const SKILL_SCHEMA = `
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  procedure TEXT NOT NULL,
  pitfalls TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_conversation_id TEXT,
  source_message_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  procedure TEXT NOT NULL,
  pitfalls TEXT NOT NULL,
  verification TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  source_conversation_id TEXT,
  source_message_id TEXT
);
CREATE TABLE IF NOT EXISTS skill_proposals (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  procedure TEXT NOT NULL,
  pitfalls TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT '',
  update_skill_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
  skill_id UNINDEXED,
  name,
  description
);
`

const BOT_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  workspace_path TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL,
  avatar_kind TEXT NOT NULL DEFAULT 'builtin',
  avatar_value TEXT NOT NULL DEFAULT 'spark',
  avatar_bg TEXT NOT NULL DEFAULT '#d4544a',
  ongoing_conversation_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS message_reactions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (bot_id, message_id, emoji)
);
`

export interface BotRecord {
  id: string
  name: string
  purpose: string
  instructions: string
  workspacePath: string
  settings: Settings
  avatarKind: 'builtin' | 'emoji' | 'image'
  avatarValue: string
  avatarBg: string
  ongoingConversationId: string
  createdAt: number
  updatedAt: number
}

export interface ReactionRecord {
  id: string
  botId: string
  messageId: string
  emoji: string
  createdAt: number
}

interface AppConfig {
  maxEstimatedSpendPerDayUsd: number | null
  showToolDetails: boolean
  activeBotId: string
}

export class Database {
  private readonly db: SqlDatabase

  constructor(private readonly filename: string) {
    this.db = openDatabase(filename)
  }

  migrate(): void {
    const version = this.userVersion()
    if (version < 1) {
      this.db.exec(SCHEMA)
      this.db.exec(SKILL_SCHEMA)
      this.db.exec(BOT_SCHEMA)
      this.ensureInitialBot()
      this.ensureAttachments()
      this.ensureCodexSessions()
      this.db.exec('PRAGMA user_version = 9')
      this.ensureModelCatalog()
      return
    }
    if (version < 2) {
      if (this.tableExists('model_requests') && !this.columnExists('model_requests', 'context_json')) {
        this.db.exec('ALTER TABLE model_requests ADD COLUMN context_json TEXT')
      }
      this.db.exec(SKILL_SCHEMA)
      this.db.exec('PRAGMA user_version = 2')
    }
    if (this.userVersion() < 3) {
      this.backupBeforeBots()
      this.migrateToBots()
      this.db.exec('PRAGMA user_version = 3')
    }
    if (this.userVersion() < 4) {
      this.addColumn('bots', 'ongoing_conversation_id', `TEXT NOT NULL DEFAULT ''`)
      this.assignOngoingFromLatest()
      this.db.exec('PRAGMA user_version = 4')
    }
    this.ensureModelCatalog()
    this.ensureAttachments()
    this.ensureCodexSessions()
    if (this.userVersion() < 5) this.db.exec('PRAGMA user_version = 5')
    if (this.userVersion() < 6) {
      this.transaction(() => {
        this.db.prepare(`UPDATE bots SET settings_json = json_set(settings_json, '$.searchUrlTemplate', ?)
          WHERE json_extract(settings_json, '$.searchUrlTemplate') = ?`).run(DEFAULT_SEARCH_TEMPLATE, DUCKDUCKGO_SEARCH_TEMPLATE)
        this.db.exec('PRAGMA user_version = 6')
      })
    }
    if (this.userVersion() < 7) this.db.exec('PRAGMA user_version = 7')
    if (this.userVersion() < 8) {
      const oldNote = 'The reply hit the output token limit and may be cut off. Raise the reply token limit in Settings if you need a longer answer.'
      const note = 'This earlier reply was cut off before it finished. The partial response is saved. Send another message to continue with automatic output handling.'
      this.transaction(() => {
        if (this.tableExists('runs') && this.columnExists('messages', 'run_id')) {
          this.db.prepare(`UPDATE runs SET status = 'paused', note = ? WHERE status = 'completed' AND id IN (SELECT run_id FROM messages WHERE role = 'notice' AND content = ?)`).run(note, oldNote)
          if (this.tableExists('tasks')) this.db.prepare(`UPDATE tasks SET status = 'paused' WHERE status = 'completed' AND run_id IN (SELECT id FROM runs WHERE status = 'paused' AND note = ?)`).run(note)
        }
        if (this.tableExists('messages')) this.db.prepare(`UPDATE messages SET content = ? WHERE role = 'notice' AND content = ?`).run(note, oldNote)
        this.db.exec('PRAGMA user_version = 8')
      })
    }
    if (this.userVersion() < 9) this.transaction(() => {
      this.db.prepare(`UPDATE bots SET settings_json = json_set(settings_json, '$.replyMode', CASE WHEN COALESCE(json_extract(settings_json, '$.maxOutputTokens'), 2048) = 2048 THEN 'automatic' ELSE 'manual' END) WHERE json_type(settings_json, '$.replyMode') IS NULL`).run()
      this.db.prepare(`UPDATE bots SET settings_json = json_set(settings_json, '$.maxModelCallsPerTask', 24) WHERE json_extract(settings_json, '$.maxModelCallsPerTask') = 12 AND json_extract(settings_json, '$.replyMode') = 'automatic'`).run()
      this.db.prepare('UPDATE model_catalog SET fetched_at = 0').run()
      this.db.exec('PRAGMA user_version = 9')
    })
  }

  private ensureCodexSessions(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS codex_sessions (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, signature TEXT NOT NULL, usage_json TEXT
    )`)
  }

  private ensureAttachments(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
      width INTEGER, height INTEGER, preview_url TEXT, data BLOB NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attachments_bot_message ON attachments(bot_id, message_id, created_at)`)
  }

  codexSession(conversationId: string, botId: string): { connectionId: string; threadId: string; signature: string; usage: string | null } | null {
    const found = row(this.db.prepare('SELECT * FROM codex_sessions WHERE conversation_id = ? AND bot_id = ?').get(conversationId, botId))
    return found ? { connectionId: text(found, 'connection_id'), threadId: text(found, 'thread_id'), signature: text(found, 'signature'), usage: found.usage_json == null ? null : text(found, 'usage_json') } : null
  }

  saveCodexSession(conversationId: string, botId: string, connectionId: string, threadId: string, signature: string, usage: string | null): void {
    this.db.prepare(`INSERT INTO codex_sessions (conversation_id, bot_id, connection_id, thread_id, signature, usage_json) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET connection_id=excluded.connection_id,thread_id=excluded.thread_id,signature=excluded.signature,usage_json=excluded.usage_json`).run(conversationId, botId, connectionId, threadId, signature, usage)
  }

  codexTurnCount(day: string): number {
    return num(row(this.db.prepare(`SELECT COUNT(*) AS total FROM model_requests WHERE provider = 'codex' AND day = ?`).get(day))!, 'total')
  }

  clearCodexSession(conversationId: string, botId: string): void {
    this.db.prepare('DELETE FROM codex_sessions WHERE conversation_id = ? AND bot_id = ?').run(conversationId, botId)
  }

  addAttachment(id: string, botId: string, input: PreparedAttachment, now: number): AttachmentRecord {
    this.db.prepare(`INSERT INTO attachments (id, bot_id, name, kind, mime_type, size, width, height, preview_url, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, botId, input.name, input.kind, input.mimeType, input.size, input.width, input.height, input.previewUrl, input.data, now)
    return { id, botId, messageId: null, name: input.name, kind: input.kind, mimeType: input.mimeType, size: input.size, width: input.width, height: input.height, previewUrl: input.previewUrl }
  }

  listAttachments(botId: string, messageIds: string[] = []): AttachmentRecord[] {
    const condition = messageIds.length ? 'message_id IN (SELECT value FROM json_each(?))' : 'message_id IS NULL'
    const args = messageIds.length ? [botId, JSON.stringify(messageIds)] : [botId]
    return rows(this.db.prepare(`SELECT id, bot_id, message_id, name, kind, mime_type, size, width, height, preview_url FROM attachments WHERE bot_id = ? AND ${condition} ORDER BY created_at, rowid`).all(...args)).map(mapAttachment)
  }

  getAttachment(id: string, botId: string): AttachmentRecord | null {
    const found = row(this.db.prepare('SELECT id, bot_id, message_id, name, kind, mime_type, size, width, height, preview_url FROM attachments WHERE id = ? AND bot_id = ?').get(id, botId))
    return found ? mapAttachment(found) : null
  }

  attachmentData(id: string, botId: string): Buffer {
    const found = row(this.db.prepare('SELECT data FROM attachments WHERE id = ? AND bot_id = ?').get(id, botId))
    if (!found || !(found.data instanceof Uint8Array)) throw new Error('That attachment is not here.')
    return Buffer.from(found.data)
  }

  attachToMessage(ids: string[], messageId: string, botId: string): void {
    const update = this.db.prepare('UPDATE attachments SET message_id = ? WHERE id = ? AND bot_id = ? AND message_id IS NULL')
    for (const id of ids) update.run(messageId, id, botId)
  }

  removeDraftAttachment(id: string, botId: string): void {
    this.db.prepare('DELETE FROM attachments WHERE id = ? AND bot_id = ? AND message_id IS NULL').run(id, botId)
  }

  private ensureModelCatalog(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS model_catalog (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      context_tokens INTEGER,
      source TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (provider, model)
    )`)
    this.addColumn('model_catalog', 'max_output_tokens', 'INTEGER')
  }

  private userVersion(): number {
    const versionRow = row(this.db.prepare('PRAGMA user_version').get())
    return Number(versionRow?.user_version ?? 0)
  }

  private backupBeforeBots(): void {
    if (!this.filename || this.filename === ':memory:') return
    const dest = `${this.filename}.v2.bak`
    if (fs.existsSync(dest)) return
    this.db.exec('PRAGMA wal_checkpoint(FULL)')
    const escaped = dest.replace(/\\/g, '/').replace(/'/g, "''")
    this.db.exec(`VACUUM INTO '${escaped}'`)
  }

  private migrateToBots(): void {
    this.db.exec(BOT_SCHEMA)
    this.addColumn('conversations', 'bot_id', `TEXT NOT NULL DEFAULT ''`)
    this.addColumn('memories', 'bot_id', `TEXT NOT NULL DEFAULT ''`)
    this.addColumn('skills', 'bot_id', `TEXT NOT NULL DEFAULT ''`)
    this.addColumn('skill_proposals', 'bot_id', `TEXT NOT NULL DEFAULT ''`)
    this.addColumn('runs', 'bot_id', `TEXT NOT NULL DEFAULT ''`)
    const botId = this.ensureInitialBot()
    this.transaction(() => {
      if (this.tableExists('conversations')) this.db.prepare(`UPDATE conversations SET bot_id = ? WHERE bot_id = ''`).run(botId)
      if (this.tableExists('memories')) this.db.prepare(`UPDATE memories SET bot_id = ? WHERE bot_id = ''`).run(botId)
      if (this.tableExists('skills')) this.db.prepare(`UPDATE skills SET bot_id = ? WHERE bot_id = ''`).run(botId)
      if (this.tableExists('skill_proposals')) this.db.prepare(`UPDATE skill_proposals SET bot_id = ? WHERE bot_id = ''`).run(botId)
      if (this.tableExists('runs') && this.tableExists('conversations')) {
        this.db
          .prepare(
            `UPDATE runs SET bot_id = (SELECT bot_id FROM conversations WHERE conversations.id = runs.conversation_id)
             WHERE bot_id = '' AND conversation_id IN (SELECT id FROM conversations)`
          )
          .run()
      }
    })
  }

  private addColumn(table: string, column: string, definition: string): void {
    if (!this.tableExists(table) || this.columnExists(table, column)) return
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  private tableExists(table: string): boolean {
    const found = row(this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table))
    return Boolean(found)
  }

  private columnExists(table: string, column: string): boolean {
    if (!this.tableExists(table)) return false
    return rows(this.db.prepare(`PRAGMA table_info(${table})`).all()).some((item) => text(item, 'name') === column)
  }

  private ensureInitialBot(): string {
    const existing = this.listBots()[0]
    if (existing) {
      if (!this.appConfig().activeBotId) this.saveAppConfig({ ...this.appConfig(), activeBotId: existing.id })
      return existing.id
    }
    const legacy = this.legacySettings()
    const now = Date.now()
    const avatar = assignBuiltin('Riot')
    const id = newId()
    const settings = sanitizeSettings({ ...legacy, pinnedInstructions: '' })
    this.db
      .prepare(
        `INSERT INTO bots (
          id, name, purpose, instructions, workspace_path, settings_json, avatar_kind, avatar_value, avatar_bg, created_at, updated_at
        ) VALUES (?, 'Riot', '', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, legacy.pinnedInstructions, legacy.workspacePath, JSON.stringify(settings), avatar.kind, avatar.value, avatar.background, now, now)
    this.saveAppConfig({
      maxEstimatedSpendPerDayUsd: legacy.maxEstimatedSpendPerDayUsd,
      showToolDetails: false,
      activeBotId: id
    })
    return id
  }

  close(): void {
    this.db.close()
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = fn()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* the connection may already be closing */
      }
      throw error
    }
  }

  interruptUnfinished(now: number): number {
    const note = 'Interrupted because Riot Bot restarted. It was not resumed, and unfinished tool actions were not repeated.'
    const result = this.transaction(() => {
      this.db.prepare(`DELETE FROM codex_sessions WHERE conversation_id IN (SELECT conversation_id FROM runs WHERE status = 'running')`).run()
      const runs = this.db.prepare(`UPDATE runs SET status = 'interrupted', ended_at = ?, note = ? WHERE status = 'running'`).run(now, note) as {
        changes?: number
      }
      this.db.prepare(`UPDATE tasks SET status = 'interrupted', updated_at = ?, outstanding_steps_json = '[]' WHERE status = 'active'`).run(now)
      this.db
        .prepare(`UPDATE model_requests SET outcome = 'interrupted', ended_at = COALESCE(ended_at, ?), error = COALESCE(error, ?) WHERE outcome IS NULL OR outcome = 'started'`)
        .run(now, note)
      this.db
        .prepare(
          `UPDATE tool_calls SET outcome = 'interrupted', ended_at = COALESCE(ended_at, ?), error = ? WHERE outcome IS NULL OR outcome IN ('started', 'pending')`
        )
        .run(now, 'Interrupted by restart. Not run again.')
      this.db.prepare(`UPDATE approvals SET status = 'denied', resolved_at = ? WHERE status = 'pending'`).run(now)
      return runs.changes ?? 0
    })
    return result
  }

  getSettings(botId = this.activeBotId()): Settings {
    const app = this.appConfig()
    const bot = botId ? this.getBot(botId) : null
    if (!bot) {
      const legacy = this.legacySettings()
      return { ...legacy, maxEstimatedSpendPerDayUsd: app.maxEstimatedSpendPerDayUsd, botId: '' }
    }
    const merged = sanitizeSettings({
      ...bot.settings,
      workspacePath: bot.workspacePath,
      pinnedInstructions: bot.instructions,
      maxEstimatedSpendPerDayUsd: app.maxEstimatedSpendPerDayUsd
    })
    return { ...merged, botId: bot.id }
  }

  saveSettings(settings: Settings): void {
    const botId = settings.botId || this.activeBotId()
    const bot = this.getBot(botId)
    if (!bot) throw new Error('That bot is not here.')
    const clean = sanitizeSettings(settings)
    const now = Date.now()
    this.db
      .prepare(`UPDATE bots SET instructions = ?, workspace_path = ?, settings_json = ?, updated_at = ? WHERE id = ?`)
      .run(clean.pinnedInstructions, clean.workspacePath, JSON.stringify({ ...clean, pinnedInstructions: clean.pinnedInstructions }), now, botId)
    const app = this.appConfig()
    this.saveAppConfig({ ...app, maxEstimatedSpendPerDayUsd: clean.maxEstimatedSpendPerDayUsd, activeBotId: app.activeBotId || botId })
  }

  appConfig(): AppConfig {
    if (!this.tableExists('settings')) return { maxEstimatedSpendPerDayUsd: null, showToolDetails: false, activeBotId: '' }
    const stored = row(this.db.prepare(`SELECT value FROM settings WHERE key = 'app'`).get())
    if (!stored) return { maxEstimatedSpendPerDayUsd: null, showToolDetails: false, activeBotId: '' }
    try {
      const parsed = JSON.parse(text(stored, 'value')) as Partial<AppConfig>
      return {
        maxEstimatedSpendPerDayUsd: parsed.maxEstimatedSpendPerDayUsd ?? null,
        showToolDetails: Boolean(parsed.showToolDetails),
        activeBotId: typeof parsed.activeBotId === 'string' ? parsed.activeBotId : ''
      }
    } catch {
      return { maxEstimatedSpendPerDayUsd: null, showToolDetails: false, activeBotId: '' }
    }
  }

  saveAppConfig(config: AppConfig): void {
    this.db.exec(BOT_SCHEMA)
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(config))
  }

  activeBotId(): string {
    const configured = this.appConfig().activeBotId
    if (configured && this.getBot(configured)) return configured
    return this.listBots()[0]?.id ?? ''
  }

  setActiveBot(id: string): void {
    if (!this.getBot(id)) throw new Error('That bot is not here.')
    this.saveAppConfig({ ...this.appConfig(), activeBotId: id })
  }

  listBots(): BotRecord[] {
    if (!this.tableExists('bots')) return []
    return rows(this.db.prepare(`SELECT * FROM bots ORDER BY created_at ASC`).all()).map((record) => mapBot(record))
  }

  getBot(id: string): BotRecord | null {
    if (!id || !this.tableExists('bots')) return null
    const found = row(this.db.prepare(`SELECT * FROM bots WHERE id = ?`).get(id))
    return found ? mapBot(found) : null
  }

  insertBot(bot: BotRecord): void {
    this.db
      .prepare(
        `INSERT INTO bots (
          id, name, purpose, instructions, workspace_path, settings_json, avatar_kind, avatar_value, avatar_bg, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        bot.id,
        bot.name,
        bot.purpose,
        bot.instructions,
        bot.workspacePath,
        JSON.stringify(bot.settings),
        bot.avatarKind,
        bot.avatarValue,
        bot.avatarBg,
        bot.createdAt,
        bot.updatedAt
      )
  }

  updateBotProfile(id: string, patch: { name?: string; purpose?: string; instructions?: string }, now: number): BotRecord | null {
    const current = this.getBot(id)
    if (!current) return null
    this.db
      .prepare(`UPDATE bots SET name = ?, purpose = ?, instructions = ?, updated_at = ? WHERE id = ?`)
      .run(patch.name ?? current.name, patch.purpose ?? current.purpose, patch.instructions ?? current.instructions, now, id)
    return this.getBot(id)
  }

  updateBotAvatar(id: string, avatar: { kind: BotRecord['avatarKind']; value: string; background: string }, now: number): BotRecord | null {
    this.db.prepare(`UPDATE bots SET avatar_kind = ?, avatar_value = ?, avatar_bg = ?, updated_at = ? WHERE id = ?`).run(avatar.kind, avatar.value, avatar.background, now, id)
    return this.getBot(id)
  }

  private legacySettings(): Settings {
    if (!this.tableExists('settings')) return { ...DEFAULT_SETTINGS }
    const stored = row(this.db.prepare(`SELECT value FROM settings WHERE key = 'config'`).get())
    if (!stored) return { ...DEFAULT_SETTINGS }
    try {
      const parsed = JSON.parse(text(stored, 'value')) as Partial<Settings>
      return sanitizeSettings({ ...DEFAULT_SETTINGS, ...parsed })
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  setOngoingConversation(botId: string, conversationId: string): void {
    this.db.prepare(`UPDATE bots SET ongoing_conversation_id = ? WHERE id = ?`).run(conversationId, botId)
  }

  ensureOngoingConversations(now: number): void {
    for (const bot of this.listBots()) {
      if (bot.ongoingConversationId && this.conversationForBot(bot.id, bot.ongoingConversationId)) continue
      const latest = this.listConversations(bot.id)[0]
      if (latest) {
        this.setOngoingConversation(bot.id, latest.id)
        continue
      }
      const created = this.createConversation('New Chat', now, bot.id)
      this.setOngoingConversation(bot.id, created.id)
    }
  }

  private assignOngoingFromLatest(): void {
    if (!this.tableExists('bots') || !this.columnExists('bots', 'ongoing_conversation_id')) return
    for (const bot of this.listBots()) {
      if (bot.ongoingConversationId && this.conversationForBot(bot.id, bot.ongoingConversationId)) continue
      const latest = this.listConversations(bot.id)[0]
      if (latest) this.setOngoingConversation(bot.id, latest.id)
    }
  }

  listConversations(botId = this.activeBotId()): Conversation[] {
    if (!botId || !this.tableExists('conversations')) return []
    return rows(this.db.prepare(`SELECT * FROM conversations WHERE bot_id = ? ORDER BY updated_at DESC`).all(botId)).map(mapConversation)
  }

  createConversation(title: string, now: number, botId = this.activeBotId()): Conversation {
    if (!botId || !this.getBot(botId)) throw new Error('That bot is not here.')
    const id = newId()
    this.db
      .prepare(`INSERT INTO conversations (id, bot_id, title, created_at, updated_at, summary) VALUES (?, ?, ?, ?, ?, '')`)
      .run(id, botId, title, now, now)
    return { id, botId, title, createdAt: now, updatedAt: now, summary: '' }
  }

  getConversation(id: string): Conversation | null {
    if (!this.tableExists('conversations')) return null
    const found = row(this.db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id))
    return found ? mapConversation(found) : null
  }

  conversationForBot(botId: string, id: string): Conversation | null {
    const conversation = this.getConversation(id)
    if (!conversation || conversation.botId !== botId) return null
    return conversation
  }

  deleteConversation(id: string): void {
    const conversation = this.getConversation(id)
    this.transaction(() => {
      const messageIds = rows(this.db.prepare(`SELECT id FROM messages WHERE conversation_id = ?`).all(id)).map((item) => text(item, 'id'))
      for (const messageId of messageIds) {
        this.db.prepare(`DELETE FROM messages_fts WHERE message_id = ?`).run(messageId)
      }
      this.db.prepare(`DELETE FROM tool_calls WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = ?)`).run(id)
      this.db.prepare(`DELETE FROM model_requests WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = ?)`).run(id)
      this.db.prepare(`DELETE FROM budget_reservations WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = ?)`).run(id)
      this.db.prepare(`DELETE FROM approvals WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = ?)`).run(id)
      this.db.prepare(`DELETE FROM tasks WHERE conversation_id = ?`).run(id)
      this.db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(id)
      this.db.prepare(`DELETE FROM runs WHERE conversation_id = ?`).run(id)
      this.db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id)
    })
    if (!conversation) return
    const bot = this.getBot(conversation.botId)
    if (!bot || bot.ongoingConversationId !== id) return
    const latest = this.listConversations(bot.id)[0]
    if (latest) {
      this.setOngoingConversation(bot.id, latest.id)
      return
    }
    const created = this.createConversation('New Chat', Date.now(), bot.id)
    this.setOngoingConversation(bot.id, created.id)
  }

  touchConversation(id: string, now: number, title?: string): void {
    if (title) {
      this.db.prepare(`UPDATE conversations SET updated_at = ?, title = ? WHERE id = ?`).run(now, title, id)
    } else {
      this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now, id)
    }
  }

  setSummary(id: string, summary: string): void {
    this.db.prepare(`UPDATE conversations SET summary = ? WHERE id = ?`).run(summary, id)
  }

  addMessage(message: MessageRecord, attachmentIds: string[] = []): void {
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, content, tool_calls_json, tool_call_id, tool_name, created_at, summarized, run_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          message.id,
          message.conversationId,
          message.role,
          message.content,
          message.toolCallsJson,
          message.toolCallId,
          message.toolName,
          message.createdAt,
          message.summarized ? 1 : 0,
          message.runId
        )
      if (attachmentIds.length) {
        const conversation = this.getConversation(message.conversationId)
        if (!conversation) throw new Error('That conversation is not here.')
        this.attachToMessage(attachmentIds, message.id, conversation.botId)
      }
      if (message.role !== 'notice' && message.content.trim()) {
        this.db
          .prepare(`INSERT INTO messages_fts (message_id, conversation_id, content) VALUES (?, ?, ?)`)
          .run(message.id, message.conversationId, message.content)
      }
    })
  }

  updateMessageContent(id: string, content: string, toolCallsJson: string | null): void {
    this.transaction(() => {
      const existing = this.getMessage(id)
      if (!existing) return
      this.db.prepare(`UPDATE messages SET content = ?, tool_calls_json = ? WHERE id = ?`).run(content, toolCallsJson, id)
      this.db.prepare(`DELETE FROM messages_fts WHERE message_id = ?`).run(id)
      if (existing.role !== 'notice' && content.trim()) {
        this.db.prepare(`INSERT INTO messages_fts (message_id, conversation_id, content) VALUES (?, ?, ?)`).run(id, existing.conversationId, content)
      }
    })
  }

  listMessages(conversationId: string): MessageRecord[] {
    return rows(this.db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`).all(conversationId)).map(mapMessage)
  }

  pageMessages(conversationId: string, beforeId?: string, limit = 80): { messages: MessageRecord[]; hasMore: boolean } {
    const count = Math.max(1, Math.min(100, Math.floor(limit)))
    const anchor = beforeId ? row(this.db.prepare('SELECT created_at, rowid AS sort_id FROM messages WHERE id = ? AND conversation_id = ?').get(beforeId, conversationId)) : null
    if (beforeId && !anchor) throw new Error('That history position is not in this conversation.')
    const found = anchor
      ? rows(this.db.prepare(`SELECT * FROM messages WHERE conversation_id = ? AND (created_at < ? OR (created_at = ? AND rowid < ?)) ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(conversationId, anchor.created_at, anchor.created_at, anchor.sort_id, count + 1))
      : rows(this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(conversationId, count + 1))
    return { messages: found.slice(0, count).reverse().map(mapMessage), hasMore: found.length > count }
  }

  latestMessage(conversationId: string, roles: MessageRecord['role'][] = ['user']): MessageRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM messages WHERE conversation_id = ? AND role IN (${roles.map(() => '?').join(',')}) ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(conversationId, ...roles))
    return found ? mapMessage(found) : null
  }

  unsummarizedMessages(conversationId: string): MessageRecord[] {
    return rows(this.db.prepare(`SELECT * FROM messages WHERE conversation_id = ? AND summarized = 0 AND role <> 'notice' ORDER BY created_at ASC, rowid ASC`).all(conversationId)).map(mapMessage)
  }

  messagesForCompaction(conversationId: string, ids: string[]): MessageRecord[] {
    if (ids.length === 0) return []
    return rows(this.db.prepare(`SELECT messages.* FROM messages JOIN json_each(?) AS selected ON messages.id = selected.value
      WHERE conversation_id = ? AND summarized = 0 AND role <> 'notice' ORDER BY created_at ASC, messages.rowid ASC LIMIT 200`).all(JSON.stringify(ids), conversationId)).map(mapMessage)
  }

  historyIdsBeforeLatestUser(conversationId: string): string[] {
    return rows(this.db.prepare(`WITH last_user AS (SELECT created_at, rowid AS sort_id FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1)
      SELECT messages.id FROM messages, last_user WHERE conversation_id = ? AND summarized = 0 AND role <> 'notice'
      AND (messages.created_at < last_user.created_at OR (messages.created_at = last_user.created_at AND messages.rowid < last_user.sort_id))
      ORDER BY messages.created_at ASC, messages.rowid ASC`).all(conversationId, conversationId)).map((item) => text(item, 'id'))
  }

  getMessage(id: string): MessageRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id))
    return found ? mapMessage(found) : null
  }

  findToolMessage(botId: string, toolCallId: string): MessageRecord | null {
    const found = row(
      this.db
        .prepare(
          `SELECT messages.* FROM messages
           JOIN conversations ON conversations.id = messages.conversation_id
           WHERE conversations.bot_id = ? AND messages.tool_call_id = ?
           ORDER BY messages.created_at DESC LIMIT 1`
        )
        .get(botId, toolCallId)
    )
    return found ? mapMessage(found) : null
  }

  getModelCatalog(provider: string, model: string): { contextTokens: number | null; maxOutputTokens?: number; source: string; fetchedAt: number } | null {
    const found = row(this.db.prepare(`SELECT context_tokens, max_output_tokens, source, fetched_at FROM model_catalog WHERE provider = ? AND model = ?`).get(provider, model))
    if (!found) return null
    const tokens = found.context_tokens
    return {
      contextTokens: tokens == null ? null : Number(tokens),
      ...(found.max_output_tokens != null ? { maxOutputTokens: Number(found.max_output_tokens) } : {}),
      source: text(found, 'source'),
      fetchedAt: Number(found.fetched_at)
    }
  }

  saveModelCatalog(provider: string, model: string, contextTokens: number | null, source: string, fetchedAt: number, maxOutputTokens: number | null = null): void {
    this.db
      .prepare(
        `INSERT INTO model_catalog (provider, model, context_tokens, source, fetched_at, max_output_tokens)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, model) DO UPDATE SET context_tokens = excluded.context_tokens, source = excluded.source, fetched_at = excluded.fetched_at, max_output_tokens = excluded.max_output_tokens`
      )
      .run(provider, model, contextTokens, source, fetchedAt, maxOutputTokens)
  }

  deleteMessage(id: string): void {
    this.transaction(() => {
      this.db.prepare(`DELETE FROM messages_fts WHERE message_id = ?`).run(id)
      this.db.prepare(`DELETE FROM messages WHERE id = ?`).run(id)
    })
  }

  markSummarized(ids: string[]): void {
    const statement = this.db.prepare(`UPDATE messages SET summarized = 1 WHERE id = ?`)
    for (const id of ids) statement.run(id)
  }

  searchMessages(query: string, limit = 8, botId = this.activeBotId()): HistoryHit[] {
    const match = toFtsQuery(query)
    if (!match || !botId) return []
    try {
      const hits = rows(this.db.prepare(`SELECT messages_fts.message_id FROM messages_fts
        JOIN messages ON messages.id = messages_fts.message_id
        JOIN conversations ON conversations.id = messages.conversation_id
        WHERE messages_fts MATCH ? AND conversations.bot_id = ?
        ORDER BY bm25(messages_fts) LIMIT ?`).all(match, botId, Math.max(limit, 1)))
      const results: HistoryHit[] = []
      for (const hit of hits) {
        const message = this.getMessage(text(hit, 'message_id'))
        if (!message) continue
        const conversation = this.getConversation(message.conversationId)
        if (!conversation || conversation.botId !== botId) continue
        results.push({
          messageId: message.id,
          conversationId: message.conversationId,
          role: message.role,
          createdAt: message.createdAt,
          snippet: snippetAround(message.content, query)
        })
        if (results.length >= limit) break
      }
      return results
    } catch {
      return []
    }
  }

  messagesAround(id: string, before: number, after: number, botId = this.activeBotId()): MessageRecord[] {
    const message = this.getMessage(id)
    if (!message) return []
    const conversation = this.getConversation(message.conversationId)
    if (!conversation || conversation.botId !== botId) return []
    const earlier = before > 0 ? this.pageMessages(message.conversationId, id, Math.min(4, before)).messages : []
    const anchor = row(this.db.prepare('SELECT created_at, rowid AS sort_id FROM messages WHERE id = ?').get(id))!
    const later = rows(this.db.prepare(`SELECT * FROM messages WHERE conversation_id = ? AND (created_at > ? OR (created_at = ? AND rowid > ?)) ORDER BY created_at ASC, rowid ASC LIMIT ?`).all(message.conversationId, anchor.created_at, anchor.created_at, anchor.sort_id, Math.max(0, Math.min(4, after)))).map(mapMessage)
    return [...earlier, message, ...later]
  }

  listMemories(botId = this.activeBotId()): MemoryRecord[] {
    if (!botId || !this.tableExists('memories')) return []
    return rows(this.db.prepare(`SELECT * FROM memories WHERE deleted_at IS NULL AND bot_id = ? ORDER BY pinned DESC, updated_at DESC`).all(botId)).map(mapMemory)
  }

  searchMemories(query: string, limit = 5, botId = this.activeBotId()): MemoryRecord[] {
    const match = toFtsQuery(query)
    if (!match || !botId) return []
    try {
      const hits = rows(this.db.prepare(`SELECT memories_fts.memory_id FROM memories_fts
        JOIN memories ON memories.id = memories_fts.memory_id
        WHERE memories_fts MATCH ? AND memories.bot_id = ? AND memories.deleted_at IS NULL
        ORDER BY bm25(memories_fts) LIMIT ?`).all(match, botId, Math.max(limit, 1)))
      const results: MemoryRecord[] = []
      for (const hit of hits) {
        const memory = this.getMemory(text(hit, 'memory_id'), botId)
        if (memory) results.push(memory)
        if (results.length >= limit) break
      }
      return results
    } catch {
      return []
    }
  }

  getMemory(id: string, botId = this.activeBotId()): MemoryRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL`).get(id))
    if (!found) return null
    const memory = mapMemory(found)
    if (botId && memory.botId !== botId) return null
    return memory
  }

  insertMemory(memory: MemoryRecord): void {
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO memories (id, bot_id, content, kind, pinned, created_at, updated_at, source_message_id, conversation_id, provenance, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(
          memory.id,
          memory.botId,
          memory.content,
          memory.kind,
          memory.pinned ? 1 : 0,
          memory.createdAt,
          memory.updatedAt,
          memory.sourceMessageId,
          memory.conversationId,
          memory.provenance
        )
      this.db.prepare(`INSERT INTO memories_fts (memory_id, content) VALUES (?, ?)`).run(memory.id, memory.content)
    })
  }

  updateMemory(id: string, content: string, now: number, provenance: Memory['provenance'], botId = this.activeBotId()): MemoryRecord | null {
    return this.transaction(() => {
      const existing = this.getMemory(id, botId)
      if (!existing) return null
      this.db.prepare(`UPDATE memories SET content = ?, updated_at = ?, provenance = ? WHERE id = ? AND bot_id = ?`).run(content, now, provenance, id, botId)
      this.db.prepare(`DELETE FROM memories_fts WHERE memory_id = ?`).run(id)
      this.db.prepare(`INSERT INTO memories_fts (memory_id, content) VALUES (?, ?)`).run(id, content)
      return this.getMemory(id, botId)
    })
  }

  setMemoryPinned(id: string, pinned: boolean, now: number, botId = this.activeBotId()): MemoryRecord | null {
    this.db.prepare(`UPDATE memories SET pinned = ?, updated_at = ? WHERE id = ? AND bot_id = ? AND deleted_at IS NULL`).run(pinned ? 1 : 0, now, id, botId)
    return this.getMemory(id, botId)
  }

  deleteMemory(id: string, now: number, botId = this.activeBotId()): void {
    this.transaction(() => {
      this.db.prepare(`UPDATE memories SET deleted_at = ? WHERE id = ? AND bot_id = ?`).run(now, id, botId)
      this.db.prepare(`DELETE FROM memories_fts WHERE memory_id = ?`).run(id)
    })
  }

  createRun(conversationId: string, now: number, trigger = 'user_message'): RunRecord {
    const id = newId()
    const botId = this.getConversation(conversationId)?.botId ?? ''
    this.db
      .prepare(
        `INSERT INTO runs (id, bot_id, conversation_id, task_id, trigger, status, started_at, ended_at, model_calls, stop_requested, note)
         VALUES (?, ?, ?, NULL, ?, 'running', ?, NULL, 0, 0, '')`
      )
      .run(id, botId, conversationId, trigger, now)
    return this.getRun(id) as RunRecord
  }

  createDetachedRun(trigger: string, now: number): RunRecord {
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO runs (id, bot_id, conversation_id, task_id, trigger, status, started_at, ended_at, model_calls, stop_requested, note)
         VALUES (?, '', '', NULL, ?, 'running', ?, NULL, 0, 0, '')`
      )
      .run(id, trigger, now)
    return this.getRun(id) as RunRecord
  }

  attachRun(id: string, botId: string, conversationId: string): void {
    this.db.prepare(`UPDATE runs SET bot_id = ?, conversation_id = ? WHERE id = ?`).run(botId, conversationId, id)
  }

  getRun(id: string): RunRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id))
    return found ? mapRun(found) : null
  }

  latestRun(conversationId: string): RunRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM runs WHERE conversation_id = ? ORDER BY started_at DESC LIMIT 1`).get(conversationId))
    return found ? mapRun(found) : null
  }

  activeRun(): RunRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`).get())
    return found ? mapRun(found) : null
  }

  finishRun(id: string, status: RunRecord['status'], now: number, note: string): void {
    this.db.prepare(`UPDATE runs SET status = ?, ended_at = ?, note = ? WHERE id = ?`).run(status, now, note, id)
  }

  requestStop(id: string): void {
    this.db.prepare(`UPDATE runs SET stop_requested = 1 WHERE id = ?`).run(id)
  }

  incrementModelCalls(id: string): number {
    this.db.prepare(`UPDATE runs SET model_calls = model_calls + 1 WHERE id = ?`).run(id)
    return this.getRun(id)?.modelCalls ?? 0
  }

  createTask(conversationId: string, runId: string, objective: string, now: number): TaskRecord {
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO tasks (id, conversation_id, run_id, objective, completed_steps_json, outstanding_steps_json, result, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, '[]', ?, NULL, 'active', ?, ?)`
      )
      .run(id, conversationId, runId, objective, JSON.stringify(['Write a reply']), now, now)
    this.db.prepare(`UPDATE runs SET task_id = ? WHERE id = ?`).run(id, runId)
    return this.getTask(id) as TaskRecord
  }

  getTask(id: string): TaskRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id))
    return found ? mapTask(found) : null
  }

  taskForRun(runId: string): TaskRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM tasks WHERE run_id = ?`).get(runId))
    return found ? mapTask(found) : null
  }

  updateTask(id: string, patch: { completedSteps?: string[]; outstandingSteps?: string[]; result?: string | null; status?: string }, now: number): TaskRecord | null {
    const current = this.getTask(id)
    if (!current) return null
    const completed = patch.completedSteps ?? current.completedSteps
    const outstanding = patch.outstandingSteps ?? current.outstandingSteps
    const result = patch.result === undefined ? current.result : patch.result
    const status = patch.status ?? current.status
    this.db
      .prepare(`UPDATE tasks SET completed_steps_json = ?, outstanding_steps_json = ?, result = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(completed), JSON.stringify(outstanding), result, status, now, id)
    return this.getTask(id)
  }

  insertModelRequest(input: {
    id: string
    runId: string
    trigger: string
    purpose: string
    provider: string
    model: string
    startedAt: number
    attempt: number
    day: string
    reservedUsd: number | null
    contextJson?: string | null
  }): void {
    this.db
      .prepare(
        `INSERT INTO model_requests (
          id, run_id, trigger, purpose, provider, model, started_at, outcome, attempt, day, reserved_usd, context_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.runId,
        input.trigger,
        input.purpose,
        input.provider,
        input.model,
        input.startedAt,
        input.attempt,
        input.day,
        input.reservedUsd,
        input.contextJson ?? null
      )
  }

  updateRequestContext(id: string, contextJson: string): void {
    this.db.prepare(`UPDATE model_requests SET context_json = ? WHERE id = ?`).run(contextJson, id)
  }

  finishModelRequest(id: string, patch: Partial<ModelRequestRow> & { endedAt: number; outcome: string }): void {
    this.db
      .prepare(
        `UPDATE model_requests SET ended_at = ?, outcome = ?, input_tokens = ?, output_tokens = ?, cache_tokens = ?, token_source = ?,
         estimated_cost_usd = ?, reported_cost_usd = ?, cost_label = ?, error = ? WHERE id = ?`
      )
      .run(
        patch.endedAt,
        patch.outcome,
        patch.inputTokens ?? null,
        patch.outputTokens ?? null,
        patch.cacheTokens ?? null,
        patch.tokenSource ?? null,
        patch.estimatedCostUsd ?? null,
        patch.reportedCostUsd ?? null,
        patch.costLabel ?? null,
        patch.error ?? null,
        id
      )
  }

  listModelRequests(limit = 80, botId?: string): ModelRequestRow[] {
    if (!botId) return rows(this.db.prepare(`SELECT * FROM model_requests ORDER BY started_at DESC LIMIT ?`).all(limit)).map(mapRequest)
    return rows(
      this.db
        .prepare(
          `SELECT model_requests.* FROM model_requests
           JOIN runs ON runs.id = model_requests.run_id
           WHERE runs.bot_id = ?
           ORDER BY model_requests.started_at DESC LIMIT ?`
        )
        .all(botId, limit)
    ).map(mapRequest)
  }

  countModelRequests(day: string): number {
    const found = row(this.db.prepare(`SELECT COUNT(*) AS count FROM model_requests WHERE day = ? AND outcome != 'released' AND provider <> 'codex'`).get(day))
    return found ? num(found, 'count') : 0
  }

  insertReservation(input: { id: string; runId: string; requestId: string; day: string; reservedUsd: number; createdAt: number }): void {
    this.db
      .prepare(
        `INSERT INTO budget_reservations (id, run_id, request_id, day, reserved_usd, settled_usd, status, cost_label, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'reserved', 'unsettled', ?)`
      )
      .run(input.id, input.runId, input.requestId, input.day, input.reservedUsd, input.createdAt)
  }

  settleReservation(requestId: string, settledUsd: number, costLabel: string): void {
    this.db
      .prepare(`UPDATE budget_reservations SET status = 'settled', settled_usd = ?, cost_label = ? WHERE request_id = ? AND status = 'reserved'`)
      .run(settledUsd, costLabel, requestId)
  }

  releaseReservation(requestId: string): void {
    this.db
      .prepare(`UPDATE budget_reservations SET status = 'released', settled_usd = 0, cost_label = 'released' WHERE request_id = ? AND status = 'reserved'`)
      .run(requestId)
  }

  sumSpend(filter: { day?: string; runId?: string; botId?: string }): number {
    const clauses: string[] = []
    const args: unknown[] = []
    if (filter.day) {
      clauses.push('day = ?')
      args.push(filter.day)
    }
    if (filter.runId) {
      clauses.push('run_id = ?')
      args.push(filter.runId)
    }
    if (filter.botId) {
      clauses.push(`run_id IN (SELECT id FROM runs WHERE bot_id = ?)`)
      args.push(filter.botId)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const found = row(
      this.db
        .prepare(
          `SELECT COALESCE(SUM(CASE
              WHEN status = 'released' THEN 0
              WHEN status = 'settled' THEN COALESCE(settled_usd, reserved_usd)
              ELSE reserved_usd
            END), 0) AS total FROM budget_reservations ${where}`
        )
        .get(...args)
    )
    return found ? num(found, 'total') : 0
  }

  usageTotals(day: string): UsageTotals {
    const found = row(
      this.db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN status = 'settled' AND cost_label = 'estimated' THEN settled_usd ELSE 0 END), 0) AS estimated,
             COALESCE(SUM(CASE WHEN status = 'settled' AND cost_label = 'reported' THEN settled_usd ELSE 0 END), 0) AS reported,
             COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_usd ELSE 0 END), 0) AS unsettled
           FROM budget_reservations WHERE day = ?`
        )
        .get(day)
    )
    return {
      estimatedUsd: found ? num(found, 'estimated') : 0,
      reportedUsd: found ? num(found, 'reported') : 0,
      unsettledUsd: found ? num(found, 'unsettled') : 0,
      modelCalls: this.countModelRequests(day)
    }
  }

  insertTool(rowInput: ToolRow): void {
    this.db
      .prepare(
        `INSERT INTO tool_calls (id, run_id, request_id, name, arguments_json, result_text, started_at, ended_at, outcome, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rowInput.id,
        rowInput.runId,
        rowInput.requestId,
        rowInput.name,
        rowInput.argumentsJson,
        rowInput.resultText,
        rowInput.startedAt,
        rowInput.endedAt,
        rowInput.outcome,
        rowInput.error
      )
  }

  finishTool(id: string, outcome: string, resultText: string | null, error: string | null, endedAt: number): void {
    this.db.prepare(`UPDATE tool_calls SET outcome = ?, result_text = ?, error = ?, ended_at = ? WHERE id = ?`).run(outcome, resultText, error, endedAt, id)
  }

  listToolsForRequests(requestIds: string[]): ToolRow[] {
    if (requestIds.length === 0) return []
    const marks = requestIds.map(() => '?').join(', ')
    return rows(this.db.prepare(`SELECT * FROM tool_calls WHERE request_id IN (${marks}) ORDER BY started_at ASC`).all(...requestIds)).map(mapTool)
  }

  listToolsForRun(runId: string): ToolRow[] {
    return rows(this.db.prepare(`SELECT * FROM tool_calls WHERE run_id = ? ORDER BY started_at ASC`).all(runId)).map(mapTool)
  }

  insertEdit(edit: FileEditRecord): void {
    this.db
      .prepare(
        `INSERT INTO file_edits (id, run_id, path, before_text, after_text, created_file, created_at, undone_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(edit.id, edit.runId, edit.path, edit.beforeText, edit.afterText, edit.createdFile ? 1 : 0, edit.createdAt)
  }

  getEdit(id: string): FileEditRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM file_edits WHERE id = ?`).get(id))
    return found ? mapEdit(found) : null
  }

  extendFileEdit(runId: string, file: string, before: string | null, after: string): string | null {
    const found = row(this.db.prepare(`SELECT id, after_text FROM file_edits WHERE run_id = ? AND path = ? AND undone_at IS NULL ORDER BY rowid DESC LIMIT 1`).get(runId, file))
    if (!found || found.after_text !== before) return null
    const id = text(found, 'id')
    this.db.prepare('UPDATE file_edits SET after_text = ? WHERE id = ?').run(after, id)
    return id
  }

  markEditUndone(id: string, now: number): void {
    this.db.prepare(`UPDATE file_edits SET undone_at = ? WHERE id = ?`).run(now, id)
  }

  createApproval(input: { runId: string; command: string; cwd: string; timeoutMs: number; now: number }): ApprovalRecord {
    const id = newId()
    this.db
      .prepare(`INSERT INTO approvals (id, run_id, command, cwd, timeout_ms, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`)
      .run(id, input.runId, input.command, input.cwd, input.timeoutMs, input.now)
    return this.getApproval(id) as ApprovalRecord
  }

  getApproval(id: string): ApprovalRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(id))
    return found ? mapApproval(found) : null
  }

  pendingApproval(): ApprovalRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`).get())
    return found ? mapApproval(found) : null
  }

  resolveApproval(id: string, status: 'approved' | 'denied', now: number): ApprovalRecord | null {
    this.db.prepare(`UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`).run(status, now, id)
    return this.getApproval(id)
  }

  listSkills(botId = this.activeBotId()): SkillRecord[] {
    if (!botId || !this.tableExists('skills')) return []
    return rows(
      this.db.prepare(`SELECT * FROM skills WHERE bot_id = ? ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, updated_at DESC`).all(botId)
    ).map(mapSkill)
  }

  getSkill(id: string, botId = this.activeBotId()): SkillRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM skills WHERE id = ? AND deleted_at IS NULL`).get(id))
    if (!found) return null
    const skill = mapSkill(found)
    if (botId && skill.botId !== botId) return null
    return skill
  }

  getSkillAny(id: string, botId = this.activeBotId()): SkillRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id))
    if (!found) return null
    const skill = mapSkill(found)
    if (botId && skill.botId !== botId) return null
    return skill
  }

  searchSkills(query: string, limit = 8, botId = this.activeBotId()): SkillRecord[] {
    const match = toFtsOrQuery(query)
    if (!match) return this.listSkills(botId).filter((skill) => skill.enabled).slice(0, limit)
    try {
      const hits = rows(this.db.prepare(`SELECT skills_fts.skill_id FROM skills_fts
        JOIN skills ON skills.id = skills_fts.skill_id
        WHERE skills_fts MATCH ? AND skills.bot_id = ? AND skills.deleted_at IS NULL AND skills.enabled = 1
        ORDER BY bm25(skills_fts) LIMIT ?`).all(match, botId, Math.max(limit, 1)))
      const results: SkillRecord[] = []
      for (const hit of hits) {
        const skill = this.getSkill(text(hit, 'skill_id'), botId)
        if (skill?.enabled) results.push(skill)
        if (results.length >= limit) break
      }
      return results
    } catch {
      return []
    }
  }

  insertSkill(skill: SkillRecord): void {
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO skills (
            id, bot_id, name, description, procedure, pitfalls, verification, enabled, created_at, updated_at,
            source_conversation_id, source_message_id, version, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(
          skill.id,
          skill.botId,
          skill.name,
          skill.description,
          skill.procedure,
          skill.pitfalls,
          skill.verification,
          skill.enabled ? 1 : 0,
          skill.createdAt,
          skill.updatedAt,
          skill.sourceConversationId,
          skill.sourceMessageId,
          skill.version
        )
      this.db.prepare(`INSERT INTO skills_fts (skill_id, name, description) VALUES (?, ?, ?)`).run(skill.id, skill.name, skill.description)
      this.insertSkillVersion(skill)
    })
  }

  updateSkillRecord(skill: SkillRecord): void {
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE skills SET name = ?, description = ?, procedure = ?, pitfalls = ?, verification = ?, enabled = ?, updated_at = ?, version = ?, deleted_at = NULL
           WHERE id = ? AND bot_id = ?`
        )
        .run(
          skill.name,
          skill.description,
          skill.procedure,
          skill.pitfalls,
          skill.verification,
          skill.enabled ? 1 : 0,
          skill.updatedAt,
          skill.version,
          skill.id,
          skill.botId
        )
      this.db.prepare(`DELETE FROM skills_fts WHERE skill_id = ?`).run(skill.id)
      if (skill.enabled) {
        this.db.prepare(`INSERT INTO skills_fts (skill_id, name, description) VALUES (?, ?, ?)`).run(skill.id, skill.name, skill.description)
      }
      this.insertSkillVersion(skill)
    })
  }

  setSkillEnabled(id: string, enabled: boolean, now: number, botId = this.activeBotId()): SkillRecord | null {
    this.transaction(() => {
      this.db.prepare(`UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ? AND bot_id = ? AND deleted_at IS NULL`).run(enabled ? 1 : 0, now, id, botId)
      this.db.prepare(`DELETE FROM skills_fts WHERE skill_id = ?`).run(id)
      const skill = this.getSkill(id, botId)
      if (skill?.enabled) {
        this.db.prepare(`INSERT INTO skills_fts (skill_id, name, description) VALUES (?, ?, ?)`).run(skill.id, skill.name, skill.description)
      }
    })
    return this.getSkill(id, botId)
  }

  deleteSkill(id: string, now: number, botId = this.activeBotId()): void {
    this.transaction(() => {
      this.db.prepare(`UPDATE skills SET deleted_at = ?, enabled = 0, updated_at = ? WHERE id = ? AND bot_id = ?`).run(now, now, id, botId)
      this.db.prepare(`DELETE FROM skills_fts WHERE skill_id = ?`).run(id)
    })
  }

  listSkillVersions(skillId: string): SkillVersionRecord[] {
    return rows(this.db.prepare(`SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version DESC`).all(skillId)).map(mapSkillVersion)
  }

  getSkillVersion(skillId: string, version: number): SkillVersionRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM skill_versions WHERE skill_id = ? AND version = ?`).get(skillId, version))
    return found ? mapSkillVersion(found) : null
  }

  insertProposal(proposal: ProposalRecord): void {
    this.db.prepare(`UPDATE skill_proposals SET status = 'dismissed' WHERE status = 'pending' AND bot_id = ?`).run(proposal.botId)
    this.db
      .prepare(
        `INSERT INTO skill_proposals (
          id, bot_id, conversation_id, name, description, procedure, pitfalls, verification, update_skill_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(
        proposal.id,
        proposal.botId,
        proposal.conversationId,
        proposal.name,
        proposal.description,
        proposal.procedure,
        proposal.pitfalls,
        proposal.verification,
        proposal.updateSkillId,
        proposal.createdAt
      )
  }

  pendingProposal(botId = this.activeBotId()): ProposalRecord | null {
    if (!botId || !this.tableExists('skill_proposals')) return null
    const found = row(this.db.prepare(`SELECT * FROM skill_proposals WHERE status = 'pending' AND bot_id = ? ORDER BY created_at DESC LIMIT 1`).get(botId))
    return found ? mapProposal(found) : null
  }

  getProposal(id: string, botId = this.activeBotId()): ProposalRecord | null {
    const found = row(this.db.prepare(`SELECT * FROM skill_proposals WHERE id = ?`).get(id))
    if (!found) return null
    const proposal = mapProposal(found)
    if (botId && proposal.botId !== botId) return null
    return proposal
  }

  addReaction(botId: string, messageId: string, emoji: string, now: number): ReactionRecord | null {
    const message = this.getMessage(messageId)
    const conversation = message ? this.getConversation(message.conversationId) : null
    if (!conversation || conversation.botId !== botId) return null
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO message_reactions (id, bot_id, message_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, message_id, emoji) DO NOTHING`
      )
      .run(id, botId, messageId, emoji, now)
    const found = row(this.db.prepare(`SELECT * FROM message_reactions WHERE bot_id = ? AND message_id = ? AND emoji = ?`).get(botId, messageId, emoji))
    return found ? mapReaction(found) : null
  }

  removeReaction(id: string, botId: string): string | null {
    const found = row(this.db.prepare(`SELECT message_id FROM message_reactions WHERE id = ? AND bot_id = ?`).get(id, botId))
    if (!found) return null
    this.db.prepare(`DELETE FROM message_reactions WHERE id = ? AND bot_id = ?`).run(id, botId)
    return text(found, 'message_id')
  }

  listReactions(botId: string, messageIds: string[]): ReactionRecord[] {
    if (!botId || messageIds.length === 0 || !this.tableExists('message_reactions')) return []
    const marks = messageIds.map(() => '?').join(', ')
    return rows(this.db.prepare(`SELECT * FROM message_reactions WHERE bot_id = ? AND message_id IN (${marks}) ORDER BY created_at ASC`).all(botId, ...messageIds)).map(mapReaction)
  }

  resolveProposal(id: string, status: 'saved' | 'dismissed', botId = this.activeBotId()): void {
    this.db.prepare(`UPDATE skill_proposals SET status = ? WHERE id = ? AND bot_id = ? AND status = 'pending'`).run(status, id, botId)
  }

  private insertSkillVersion(skill: SkillRecord): void {
    this.db
      .prepare(
        `INSERT INTO skill_versions (
          id, skill_id, version, name, description, procedure, pitfalls, verification, created_at, source_conversation_id, source_message_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId(),
        skill.id,
        skill.version,
        skill.name,
        skill.description,
        skill.procedure,
        skill.pitfalls,
        skill.verification,
        skill.updatedAt,
        skill.sourceConversationId,
        skill.sourceMessageId
      )
  }
}

export function usageDisclaimer(): string {
  return COST_DISCLAIMER
}

function mapConversation(record: Row): Conversation {
  return {
    id: text(record, 'id'),
    botId: text(record, 'bot_id'),
    title: text(record, 'title'),
    createdAt: num(record, 'created_at'),
    updatedAt: num(record, 'updated_at'),
    summary: text(record, 'summary')
  }
}

function mapMessage(record: Row): MessageRecord {
  const role = text(record, 'role')
  return {
    id: text(record, 'id'),
    conversationId: text(record, 'conversation_id'),
    role: role === 'assistant' || role === 'tool' || role === 'notice' ? role : 'user',
    content: text(record, 'content'),
    toolCallsJson: record.tool_calls_json == null ? null : text(record, 'tool_calls_json'),
    toolCallId: record.tool_call_id == null ? null : text(record, 'tool_call_id'),
    toolName: record.tool_name == null ? null : text(record, 'tool_name'),
    createdAt: num(record, 'created_at'),
    summarized: bool(record, 'summarized'),
    runId: record.run_id == null ? null : text(record, 'run_id')
  }
}

function mapRun(record: Row): RunRecord {
  const status = text(record, 'status')
  return {
    id: text(record, 'id'),
    botId: text(record, 'bot_id'),
    conversationId: text(record, 'conversation_id'),
    taskId: record.task_id == null ? null : text(record, 'task_id'),
    trigger: text(record, 'trigger'),
    status: status as RunRecord['status'],
    startedAt: num(record, 'started_at'),
    endedAt: nullableNum(record, 'ended_at'),
    modelCalls: num(record, 'model_calls'),
    stopRequested: bool(record, 'stop_requested'),
    note: text(record, 'note')
  }
}

function mapTask(record: Row): TaskRecord {
  return {
    id: text(record, 'id'),
    conversationId: text(record, 'conversation_id'),
    runId: text(record, 'run_id'),
    objective: text(record, 'objective'),
    completedSteps: parseStrings(text(record, 'completed_steps_json')),
    outstandingSteps: parseStrings(text(record, 'outstanding_steps_json')),
    result: record.result == null ? null : text(record, 'result'),
    status: text(record, 'status'),
    createdAt: num(record, 'created_at'),
    updatedAt: num(record, 'updated_at')
  }
}

function mapMemory(record: Row): MemoryRecord {
  const kind = text(record, 'kind')
  const provenance = text(record, 'provenance')
  return {
    id: text(record, 'id'),
    botId: text(record, 'bot_id'),
    content: text(record, 'content'),
    kind: kind === 'preference' || kind === 'project' || kind === 'decision' ? kind : 'fact',
    pinned: bool(record, 'pinned'),
    createdAt: num(record, 'created_at'),
    updatedAt: num(record, 'updated_at'),
    sourceMessageId: record.source_message_id == null ? null : text(record, 'source_message_id'),
    conversationId: record.conversation_id == null ? null : text(record, 'conversation_id'),
    provenance: provenance === 'user_explicit' || provenance === 'user_edit' ? provenance : 'assistant_tool'
  }
}

function mapRequest(record: Row): ModelRequestRow {
  const tokenSource = record.token_source == null ? null : text(record, 'token_source')
  return {
    id: text(record, 'id'),
    runId: text(record, 'run_id'),
    trigger: text(record, 'trigger'),
    purpose: text(record, 'purpose'),
    provider: text(record, 'provider'),
    model: text(record, 'model'),
    startedAt: num(record, 'started_at'),
    endedAt: nullableNum(record, 'ended_at'),
    outcome: record.outcome == null ? null : text(record, 'outcome'),
    inputTokens: nullableNum(record, 'input_tokens'),
    outputTokens: nullableNum(record, 'output_tokens'),
    cacheTokens: nullableNum(record, 'cache_tokens'),
    tokenSource: tokenSource === 'reported' || tokenSource === 'estimated' ? tokenSource : null,
    estimatedCostUsd: nullableNum(record, 'estimated_cost_usd'),
    reportedCostUsd: nullableNum(record, 'reported_cost_usd'),
    costLabel: record.cost_label == null ? null : text(record, 'cost_label'),
    reservedUsd: nullableNum(record, 'reserved_usd'),
    error: record.error == null ? null : text(record, 'error'),
    attempt: num(record, 'attempt'),
    day: text(record, 'day'),
    contextJson: record.context_json == null ? null : text(record, 'context_json')
  }
}

function mapTool(record: Row): ToolRow {
  return {
    id: text(record, 'id'),
    runId: text(record, 'run_id'),
    requestId: record.request_id == null ? null : text(record, 'request_id'),
    name: text(record, 'name'),
    argumentsJson: text(record, 'arguments_json'),
    resultText: record.result_text == null ? null : text(record, 'result_text'),
    startedAt: num(record, 'started_at'),
    endedAt: nullableNum(record, 'ended_at'),
    outcome: record.outcome == null ? null : text(record, 'outcome'),
    error: record.error == null ? null : text(record, 'error')
  }
}

function mapEdit(record: Row): FileEditRecord {
  return {
    id: text(record, 'id'),
    runId: record.run_id == null ? null : text(record, 'run_id'),
    path: text(record, 'path'),
    beforeText: record.before_text == null ? null : text(record, 'before_text'),
    afterText: text(record, 'after_text'),
    createdFile: bool(record, 'created_file'),
    createdAt: num(record, 'created_at'),
    undoneAt: nullableNum(record, 'undone_at')
  }
}

function mapApproval(record: Row): ApprovalRecord {
  const status = text(record, 'status')
  return {
    id: text(record, 'id'),
    runId: text(record, 'run_id'),
    command: text(record, 'command'),
    cwd: text(record, 'cwd'),
    timeoutMs: num(record, 'timeout_ms'),
    status: status === 'approved' || status === 'denied' ? status : 'pending',
    createdAt: num(record, 'created_at'),
    resolvedAt: nullableNum(record, 'resolved_at')
  }
}

function mapSkill(record: Row): SkillRecord {
  return {
    id: text(record, 'id'),
    botId: text(record, 'bot_id'),
    name: text(record, 'name'),
    description: text(record, 'description'),
    procedure: text(record, 'procedure'),
    pitfalls: text(record, 'pitfalls'),
    verification: text(record, 'verification'),
    enabled: bool(record, 'enabled'),
    createdAt: num(record, 'created_at'),
    updatedAt: num(record, 'updated_at'),
    sourceConversationId: record.source_conversation_id == null ? null : text(record, 'source_conversation_id'),
    sourceMessageId: record.source_message_id == null ? null : text(record, 'source_message_id'),
    version: num(record, 'version'),
    deletedAt: nullableNum(record, 'deleted_at')
  }
}

function mapSkillVersion(record: Row): SkillVersionRecord {
  return {
    id: text(record, 'id'),
    skillId: text(record, 'skill_id'),
    version: num(record, 'version'),
    name: text(record, 'name'),
    description: text(record, 'description'),
    procedure: text(record, 'procedure'),
    pitfalls: text(record, 'pitfalls'),
    verification: text(record, 'verification'),
    createdAt: num(record, 'created_at'),
    sourceConversationId: record.source_conversation_id == null ? null : text(record, 'source_conversation_id'),
    sourceMessageId: record.source_message_id == null ? null : text(record, 'source_message_id')
  }
}

function mapProposal(record: Row): ProposalRecord {
  return {
    id: text(record, 'id'),
    botId: text(record, 'bot_id'),
    conversationId: record.conversation_id == null ? null : text(record, 'conversation_id'),
    name: text(record, 'name'),
    description: text(record, 'description'),
    procedure: text(record, 'procedure'),
    pitfalls: text(record, 'pitfalls'),
    verification: text(record, 'verification'),
    updateSkillId: record.update_skill_id == null ? null : text(record, 'update_skill_id'),
    status: text(record, 'status'),
    createdAt: num(record, 'created_at')
  }
}

function mapReaction(record: Row): ReactionRecord {
  return {
    id: text(record, 'id'),
    botId: text(record, 'bot_id'),
    messageId: text(record, 'message_id'),
    emoji: text(record, 'emoji'),
    createdAt: num(record, 'created_at')
  }
}

function mapBot(record: Row): BotRecord {
  let settings = sanitizeSettings(DEFAULT_SETTINGS)
  try {
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(text(record, 'settings_json')) as Partial<Settings>) })
  } catch {
    settings = sanitizeSettings(DEFAULT_SETTINGS)
  }
  const kind = text(record, 'avatar_kind')
  return {
    id: text(record, 'id'),
    name: text(record, 'name'),
    purpose: text(record, 'purpose'),
    instructions: text(record, 'instructions'),
    workspacePath: text(record, 'workspace_path'),
    settings,
    avatarKind: kind === 'emoji' || kind === 'image' ? kind : 'builtin',
    avatarValue: text(record, 'avatar_value'),
    avatarBg: text(record, 'avatar_bg'),
    ongoingConversationId: text(record, 'ongoing_conversation_id'),
    createdAt: num(record, 'created_at'),
    updatedAt: num(record, 'updated_at')
  }
}

export function localDayFrom(now: number): string {
  return localDay(now)
}

function mapAttachment(record: Row): AttachmentRecord {
  return {
    id: text(record, 'id'), botId: text(record, 'bot_id'), messageId: record.message_id == null ? null : text(record, 'message_id'),
    name: text(record, 'name'), kind: text(record, 'kind') === 'image' ? 'image' : 'text', mimeType: text(record, 'mime_type'),
    size: num(record, 'size'), width: nullableNum(record, 'width'), height: nullableNum(record, 'height'),
    previewUrl: record.preview_url == null ? null : text(record, 'preview_url')
  }
}
