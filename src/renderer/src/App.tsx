import { useEffect, useRef, useState } from 'react'
import type {
  ActivityEntry,
  AppPreferences,
  ApprovalView,
  AttachmentView,
  ArtifactView,
  Bot,
  BotDraft,
  ChatMessageView,
  ContextView,
  Conversation,
  ConversationDetail,
  CredentialStatus,
  CodexStatus,
  Memory,
  MessagePage,
  ProviderCheckPlan,
  ProviderCheckResult,
  BrowserView,
  HistoryHitView,
  JobView,
  PublicSettings,
  RiotBridge,
  Skill,
  SkillProposal,
  SkillVersion,
  UsageSummary
} from '../../shared/types'
import { formatUsd, TERMINAL_WARNING } from '../../shared/types'
import { AVATAR_CHOICES, AVATAR_COLORS, AVATAR_EMOJIS, BotAvatar } from './avatar'
import { AttachmentList, ChatTranscript } from './chat'
import { JobsPane, LibraryPane } from './jobs'

type Screen = 'chat' | 'jobs' | 'library' | 'memory' | 'skills' | 'activity' | 'settings' | 'new-bot' | 'earlier'

export function App() {
  const api = window.riot
  if (!api) {
    return (
      <main className="boot-error">
        <h1>Riot Bot</h1>
        <p>This window only works inside the Riot Bot app.</p>
      </main>
    )
  }
  return <Shell api={api} />
}

function Shell({ api }: { api: RiotBridge }) {
  const [screen, setScreen] = useState<Screen>('chat')
  const [bots, setBots] = useState<Bot[]>([])
  const [bot, setBot] = useState<Bot | null>(null)
  const [jobs, setJobs] = useState<JobView[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactView[]>([])
  const [preferences, setPreferences] = useState<AppPreferences>({ showToolDetails: false })
  const [activityScope, setActivityScope] = useState<'bot' | 'app'>('bot')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [credentials, setCredentials] = useState<CredentialStatus | null>(null)
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [proposal, setProposal] = useState<SkillProposal | null>(null)
  const [approval, setApproval] = useState<ApprovalView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftAttachments, setDraftAttachments] = useState<AttachmentView[]>([])
  const [busy, setBusy] = useState(false)
  const [ongoingId, setOngoingId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [browserNote, setBrowserNote] = useState('')
  const conversationId = useRef<string | null>(null)
  const viewedBotId = useRef<string | null>(null)
  const activityScopeRef = useRef(activityScope)
  const drafts = useRef<Record<string, string>>({})
  viewedBotId.current = bot?.id ?? null
  activityScopeRef.current = activityScope

  async function refreshActivity(scope = activityScopeRef.current): Promise<void> {
    const botId = viewedBotId.current
    const next = await api.listActivity(scope)
    if (scope === activityScopeRef.current && botId === viewedBotId.current) setActivity(next)
  }

  async function loadConversation(id: string): Promise<void> {
    const next = await api.openConversation(id)
    conversationId.current = next.conversation.id
    setDetail(next)
    setScreen('chat')
  }

  async function reload(): Promise<void> {
    const snapshot = await api.getSnapshot()
    setBots(snapshot.bots)
    setBot(snapshot.bot)
    viewedBotId.current = snapshot.bot?.id ?? null
    setJobs(snapshot.jobs ?? [])
    setArtifacts(snapshot.artifacts ?? [])
    setPreferences(snapshot.preferences)
    setOngoingId(snapshot.ongoingConversationId)
    setConversations(snapshot.conversations)
    setSettings(snapshot.settings)
    setCredentials(snapshot.credentials)
    setCodex(snapshot.codex)
    setUsage(snapshot.usage)
    if (activityScopeRef.current === 'bot') setActivity(snapshot.activity)
    else void refreshActivity()
    setMemories(snapshot.memories)
    setSkills(snapshot.skills)
    setProposal(snapshot.skillProposal)
    setApproval(snapshot.pendingApproval)
    setDraftAttachments(snapshot.draftAttachments ?? [])
    if (snapshot.current) {
      conversationId.current = snapshot.current.conversation.id
      setDetail(snapshot.current)
    } else {
      conversationId.current = null
      setDetail(null)
    }
  }

  useEffect(() => {
    void reload().catch((reason: unknown) => setError(messageOf(reason)))
    return api.onEvent((event) => {
      if (event.type === 'jobs-changed') {
        void api.listJobs('app').then(setJobs).catch(() => undefined)
        const id = viewedBotId.current
        void api.getSnapshot().then((snapshot) => { if (id === viewedBotId.current && id === snapshot.bot?.id) setDraftAttachments(snapshot.draftAttachments ?? []) }).catch(() => undefined)
        return
      }
      if (event.type === 'artifacts-changed') {
        const id = viewedBotId.current
        void api.listArtifacts().then((items) => { if (id === viewedBotId.current) setArtifacts(items) }).catch(() => undefined)
        return
      }
      if (event.type === 'codex-status') {
        setCodex(event.status)
        return
      }
      if (event.type === 'error') {
        setError(event.message)
        return
      }
      if (event.type === 'approval') {
        setApproval(event.approval)
        return
      }
      if (event.type === 'usage') {
        setUsage(event.usage)
        return
      }
      if (event.type === 'memories-changed') {
        void api.listMemories().then(setMemories).catch(() => undefined)
        return
      }
      if (event.type === 'skills-changed') {
        void api.listSkills().then(setSkills).catch(() => undefined)
        return
      }
      if (event.type === 'skill-proposal') {
        if (!event.proposal || event.proposal.botId === viewedBotId.current) setProposal(event.proposal)
        return
      }
      if ((event.type === 'delta' || event.type === 'message') && event.conversationId === conversationId.current) {
        setDetail((current) => mergeMessage(current, event.message))
        if (event.message.role === 'user' && event.message.attachments?.length) {
          const sent = new Set(event.message.attachments.map((item) => item.id))
          setDraftAttachments((current) => current.filter((item) => !sent.has(item.id)))
        }
        return
      }
      if (event.type === 'browser-progress') {
        setBrowserNote(event.progress)
        return
      }
      if (event.type === 'run') {
        if (event.conversationId === conversationId.current) {
          setDetail((current) => (current ? {
            ...current, run: event.run, task: event.task,
            messages: current.messages.map((message) => message.runId === event.run.id ? { ...message, runStatus: event.run.status } : message)
          } : current))
        }
        if (event.run.status !== 'running') {
          void refreshActivity().catch(() => undefined)
          void api.getUsage().then(setUsage).catch(() => undefined)
          void api.getSnapshot().then((snapshot) => {
            if (snapshot.bot?.id !== viewedBotId.current) return
            setConversations(snapshot.conversations)
            setOngoingId(snapshot.ongoingConversationId)
          }).catch(() => undefined)
        }
      }
    })
  }, [api])

  const botJobs = jobs.filter((job) => job.botId === bot?.id)
  const running = botJobs.some((job) => job.status === 'running') || detail?.run?.status === 'running'
  const queued = botJobs.filter((job) => job.status === 'queued').length
  const viewingEarlier = Boolean(detail && ongoingId && detail.conversation.id !== ongoingId && screen === 'chat')
  useEffect(() => {
    if (settings?.provider === 'codex') void api.getCodexStatus().then(setCodex).catch(() => undefined)
  }, [api, settings?.provider])

  const configured = settings && credentials ? providerReady(settings, credentials, codex) : false

  async function send(): Promise<void> {
    if (!detail || (!draft.trim() && !draftAttachments.length) || busy) return
    const text = draft
    const attachmentIds = draftAttachments.map((item) => item.id)
    const sendingBotId = bot?.id
    setDraft('')
    setDraftAttachments([])
    if (bot) drafts.current[bot.id] = ''
    setError(null)
    setBusy(true)
    try {
      await api.queueMessage(detail.conversation.id, text, attachmentIds)
    } catch (reason) {
      if (bot) drafts.current[bot.id] = text
      if (bot?.id === viewedBotId.current) setDraft(text)
      const snapshot = await api.getSnapshot().catch(() => null)
      if (snapshot && snapshot.bot?.id === sendingBotId && viewedBotId.current === sendingBotId) setDraftAttachments(snapshot.draftAttachments ?? [])
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function selectBot(id: string): Promise<void> {
    if (bot) drafts.current[bot.id] = draft
    setMenuOpen(false)
    await api.selectBot(id)
    await reload()
    setDraft(drafts.current[id] ?? '')
    setScreen('chat')
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">R</span>
          <div>
            <strong>Riot Bot</strong>
            <p>On this computer</p>
          </div>
        </div>
        <button
          className="new-chat"
          onClick={() => {
            if (bot) drafts.current[bot.id] = draft
            setMenuOpen(false)
            setScreen('new-bot')
          }}
        >
          New Bot
        </button>
        <div className="bot-list">
          {bots.map((item) => (
            <div key={item.id} className={item.id === bot?.id ? 'bot-row active' : 'bot-row'}>
              <button
                type="button"
                className="bot-select"
                aria-current={item.id === bot?.id ? 'true' : undefined}
                onClick={() => {
                  void selectBot(item.id).catch((reason: unknown) => setError(messageOf(reason)))
                }}
              >
                <BotAvatar avatar={item.avatar} label={item.name} size={28} />
                <span>{item.name}</span>
                {jobs.some((job) => job.botId === item.id && (job.status === 'running' || job.status === 'queued')) && <small className="bot-job-status">{jobs.some((job) => job.botId === item.id && job.awaitingApproval) ? 'Approval' : jobs.some((job) => job.botId === item.id && job.status === 'running') ? 'Working' : 'Queued'}</small>}
              </button>
              {item.id === bot?.id && (
                <button type="button" className="bot-menu-button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
                  Menu
                </button>
              )}
            </div>
          ))}
        </div>
        {menuOpen && bot && (
          <BotMenu
            api={api}
            bot={bot}
            note={browserNote}
            onNote={setBrowserNote}
            onError={(next) => setError(next)}
            onBot={(next) => {
              setBot(next)
              setBots((current) => current.map((item) => (item.id === next.id ? next : item)))
            }}
            onEarlier={() => {
              setMenuOpen(false)
              setScreen('earlier')
            }}
            onSettings={() => {
              setMenuOpen(false)
              setScreen('settings')
            }}
          />
        )}
        <nav>
          <button className={screen === 'chat' ? 'active' : ''} onClick={() => setScreen('chat')}>
            Chat
          </button>
          <button className={screen === 'jobs' ? 'active' : ''} onClick={() => setScreen('jobs')}>Jobs</button>
          <button className={screen === 'library' ? 'active' : ''} onClick={() => setScreen('library')}>Library</button>
          <button className={screen === 'memory' ? 'active' : ''} onClick={() => setScreen('memory')}>
            Memory
          </button>
          <button className={screen === 'skills' ? 'active' : ''} onClick={() => setScreen('skills')}>
            Skills
          </button>
          <button className={screen === 'activity' ? 'active' : ''} onClick={() => setScreen('activity')}>
            Activity
          </button>
          <button className={screen === 'settings' ? 'active' : ''} onClick={() => setScreen('settings')}>
            Settings
          </button>
        </nav>
        <p className="desktop-note">Close to tray · Quit from the tray menu</p>
      </aside>
      <section className="main">
        <header className="topbar">
          <div className="title-lockup">
            {bot && screen === 'chat' && <BotAvatar avatar={bot.avatar} label={bot.name} size={36} />}
            <div>
              <h1>{screen === 'chat' ? (viewingEarlier ? detail?.conversation.title : bot?.name) ?? 'Chat' : screenTitle(screen)}</h1>
              <p className="status">
                {bot ? bot.name : 'Riot Bot'}
                {bot?.purpose ? ` · ${bot.purpose}` : ''}
                {running ? ' · Working. You can queue your next message.' : queued ? ' · Queued.' : ' · Ready.'}
                {jobs.some((job) => job.botId !== bot?.id && job.status === 'running') ? ' Other bots are working.' : ''}
              </p>
            </div>
          </div>
          <button className="stop" disabled={!running} onClick={() => void api.stop()}>
            Stop
          </button>
        </header>
        {error && (
          <div className="banner warn">
            {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        {approval && (
          <ApprovalCard
            approval={approval}
            onResolve={(approved) => {
              void api.resolveApproval(approval.id, approved).catch((reason: unknown) => setError(messageOf(reason)))
            }}
          />
        )}
        {screen === 'new-bot' && settings && (
          <NewBotForm
            settings={settings}
            onCreate={async (input) => {
              if (bot) drafts.current[bot.id] = draft
              const result = await api.createBot(input)
              await reload()
              setDraft('')
              setScreen('chat')
              setError(/failed|stopped|temporary|not available/i.test(result.status) ? result.status : null)
            }}
            onError={(next) => setError(next)}
          />
        )}
        {screen === 'earlier' && (
          <EarlierPane
            api={api}
            conversations={conversations.filter((item) => item.id !== ongoingId)}
            onOpen={(id) => void loadConversation(id).catch((reason: unknown) => setError(messageOf(reason)))}
            onError={(next) => setError(next)}
          />
        )}
        {screen === 'chat' && detail && (
          <ChatPane
            key={detail.conversation.id}
            detail={detail}
            draft={draft}
            attachments={draftAttachments}
            running={running}
            submitting={busy}
            queued={queued}
            onJobs={() => setScreen('jobs')}
            readOnly={viewingEarlier}
            onBack={() => {
              if (!ongoingId) return
              void loadConversation(ongoingId).catch((reason: unknown) => setError(messageOf(reason)))
            }}
            onOpenSettings={() => setScreen('settings')}
            configured={configured}
            configurationNote={settings?.provider === 'codex' && codex?.connected && codex.models.length > 0 && !codex.models.some((model) => model.id === settings.model) ? `The saved model ${settings.model} is not listed for this Codex account. Choose an available model in Settings.` : undefined}
            showToolDetails={preferences.showToolDetails}
            avatar={bot?.avatar ?? null}
            proposal={proposal}
            api={api}
            onProposal={setProposal}
            onDraft={setDraft}
            onSend={() => void send()}
            onUndo={(id) => void api.undoEdit(id).then((result) => setError(result.ok ? null : result.message))}
            onError={(next) => setError(next)}
            onOlderPage={(page) => setDetail((current) => current?.conversation.id === page.conversationId ? {
              ...current,
              olderMessagesCursor: page.olderMessagesCursor,
              messages: [...page.messages.filter((message) => !current.messages.some((existing) => existing.id === message.id)), ...current.messages]
            } : current)}
            onAttachments={(items) => {
              if (viewedBotId.current === detail.conversation.botId) setDraftAttachments((current) => [...current, ...items.filter((item) => !current.some((existing) => existing.id === item.id))])
            }}
            onRemoveAttachment={(id) => {
              void api.removeDraftAttachment(id).then(() => setDraftAttachments((current) => current.filter((item) => item.id !== id))).catch((reason: unknown) => setError(messageOf(reason)))
            }}
          />
        )}
        {screen === 'jobs' && <JobsPane api={api} jobs={jobs} bots={bots} botId={bot?.id ?? null} onOpen={(id) => void selectBot(id).catch((reason: unknown) => setError(messageOf(reason)))} onError={setError} />}
        {screen === 'library' && <LibraryPane api={api} artifacts={artifacts} onError={setError} />}
        {screen === 'memory' && (
          <MemoryPane
            memories={memories}
            onSave={async (id, content) => {
              await api.updateMemory(id, content)
              setMemories(await api.listMemories())
            }}
            onDelete={async (id) => {
              await api.deleteMemory(id)
              setMemories(await api.listMemories())
            }}
            onPin={async (id, pinned) => {
              await api.pinMemory(id, pinned)
              setMemories(await api.listMemories())
            }}
            onError={(next) => setError(next)}
          />
        )}
        {screen === 'skills' && (
          <SkillsPane
            api={api}
            skills={skills}
            onChange={setSkills}
            onError={(next) => setError(next)}
          />
        )}
        {screen === 'activity' && (
          <ActivityPane
            activity={activity}
            usage={usage}
            scope={activityScope}
            onScope={(scope) => {
              setActivityScope(scope)
              activityScopeRef.current = scope
              void refreshActivity(scope).catch((reason: unknown) => setError(messageOf(reason)))
            }}
          />
        )}
        {screen === 'settings' && settings && credentials && bot && (
          <SettingsPane
            bot={bot}
            preferences={preferences}
            settings={settings}
            credentials={credentials}
            codex={codex}
            onCodex={setCodex}
            api={api}
            onSaved={(next, status) => {
              setSettings(next)
              setCredentials(status)
              void api.getSnapshot().then((snapshot) => {
                if (snapshot.bot?.id !== viewedBotId.current) return
                setBots(snapshot.bots)
                setBot(snapshot.bot)
                setPreferences(snapshot.preferences)
              })
            }}
            onPreferences={setPreferences}
            onError={(next) => setError(next)}
          />
        )}
      </section>
    </div>
  )
}

function ChatPane(props: {
  detail: ConversationDetail
  draft: string
  attachments: AttachmentView[]
  running: boolean
  submitting: boolean
  queued: number
  onJobs: () => void
  readOnly?: boolean
  onBack?: () => void
  onOpenSettings?: () => void
  configured: boolean
  configurationNote?: string
  showToolDetails: boolean
  avatar: Bot['avatar'] | null
  proposal: SkillProposal | null
  api: RiotBridge
  onProposal: (proposal: SkillProposal | null) => void
  onDraft: (value: string) => void
  onSend: () => void
  onUndo: (id: string) => void
  onError: (message: string) => void
  onOlderPage: (page: MessagePage) => void
  onAttachments: (items: AttachmentView[]) => void
  onRemoveAttachment: (id: string) => void
}) {
  const [attaching, setAttaching] = useState(false)

  async function attach(work: () => Promise<AttachmentView[]>): Promise<void> {
    if (attaching) return
    setAttaching(true)
    try { props.onAttachments(await work()) } catch (reason) { props.onError(messageOf(reason)) } finally { setAttaching(false) }
  }

  async function upload(files: File[]): Promise<void> {
    await attach(async () => {
      for (const file of files) {
        if (file.size > 8_000_000) throw new Error('Attachments must be 8 MB or smaller.')
        const item = await props.api.stageAttachment({ botId: props.detail.conversation.botId, name: file.name || 'Screenshot.png', bytes: Array.from(new Uint8Array(await file.arrayBuffer())) })
        props.onAttachments([item])
      }
      return []
    })
  }
  return (
    <>
      {!props.configured && (
        <div className="banner">
          <span>{props.configurationNote ?? 'Choose a model in Settings and connect Codex with ChatGPT, or add an API key for OpenAI or OpenRouter. Opening the app does not start a model turn.'}</span>
          <button type="button" onClick={props.onOpenSettings}>Open Settings</button>
        </div>
      )}
      {props.proposal && <SkillProposalCard proposal={props.proposal} api={props.api} onProposal={props.onProposal} onError={props.onError} />}
      {props.detail.messages.length === 0 && <p className="empty">This chat is empty. Send a message when you are ready.</p>}
      <ChatTranscript
        detail={props.detail}
        running={props.detail.run?.status === 'running'}
        statusLabel={props.detail.task?.outstandingSteps[0] || 'Working…'}
        showToolDetails={props.showToolDetails}
        avatar={props.avatar}
        api={props.api}
        onUndo={props.onUndo}
        onError={props.onError}
        onOpenSettings={props.onOpenSettings}
        onOlderPage={props.onOlderPage}
      />
      {props.readOnly && (
        <div className="banner">
          <span>This is an earlier conversation. New messages stay in the ongoing chat.</span>
          <button type="button" onClick={props.onBack}>
            Back to the ongoing chat
          </button>
        </div>
      )}
      {!props.readOnly && (
      <>
      {(props.running || props.queued > 0) && <div className="queue-strip"><span>{props.running ? 'This bot is working.' : 'Waiting for a worker.'} {props.queued > 0 ? `${props.queued} message${props.queued === 1 ? '' : 's'} queued.` : 'Your next message will wait its turn.'}</span><button onClick={props.onJobs}>View jobs</button></div>}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (!attaching) props.onSend()
        }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          void upload(Array.from(event.dataTransfer.files))
        }}
      >
        <div className="composer-body">
          <AttachmentList attachments={props.attachments} onRemove={props.onRemoveAttachment} />
          <textarea
            value={props.draft}
            placeholder={props.running ? 'Queue a message for this bot' : 'Message Riot Bot'}
            rows={3}
            onChange={(event) => props.onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!attaching) props.onSend()
              }
            }}
            onPaste={(event) => {
              if (!event.clipboardData.files.length) return
              event.preventDefault()
              void upload(Array.from(event.clipboardData.files))
            }}
          />
          <div className="attachment-controls">
            <button type="button" disabled={attaching} onClick={() => void attach(() => props.api.pickAttachments())}>Attach files</button>
            <button type="button" disabled={attaching} onClick={() => void attach(async () => [await props.api.pasteScreenshot()])}>Paste screenshot</button>
            <span className="help">{attaching ? 'Adding attachment…' : 'Win+Shift+S, then Ctrl+V · PNG/JPEG or UTF-8 text/code · Up to 4 files'}</span>
          </div>
        </div>
        <button className="send" type="submit" disabled={attaching || props.submitting || (!props.draft.trim() && !props.attachments.length)}>
          {props.submitting ? 'Saving…' : props.running || props.queued ? 'Queue' : 'Send'}
        </button>
      </form>
      </>
      )}
    </>
  )
}

function ApprovalCard({ approval, onResolve }: { approval: ApprovalView; onResolve: (approved: boolean) => void }) {
  return (
    <div className="approval">
      <strong>{approval.title || 'Allow this command?'}</strong>
      <p>{approval.warning}</p>
      <dl>
        <div>
          <dt>Command</dt>
          <dd>
            <code>{approval.command}</code>
          </dd>
        </div>
        <div>
          <dt>Folder</dt>
          <dd>{approval.cwd}</dd>
        </div>
        <div>
          <dt>Time limit</dt>
          <dd>{Math.round(approval.timeoutMs / 1000)} seconds</dd>
        </div>
      </dl>
      <div className="row">
        <button type="button" onClick={() => onResolve(false)}>
          Don’t allow
        </button>
        <button type="button" className="send" onClick={() => onResolve(true)}>
          Allow this command
        </button>
      </div>
    </div>
  )
}

function MemoryPane(props: {
  memories: Memory[]
  onSave: (id: string, content: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onPin: (id: string, pinned: boolean) => Promise<void>
  onError: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  const shown = props.memories.filter((memory) => memory.content.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="panel">
      <p className="help">A memory is a fact or preference. A skill, on the Skills screen, is a procedure. Explicit “remember this” saves the wording you gave, including a guess, and you can correct or delete it. Obvious secret patterns are blocked, but that check does not catch every secret. Deleting a memory removes it from later requests. The original chat can still mention it.</p>
      <input value={query} placeholder="Filter memories" onChange={(event) => setQuery(event.target.value)} />
      {shown.length === 0 && <p className="empty">No memories yet. Say “remember this: …” in a chat, or let Riot Bot save a confirmed fact.</p>}
      {shown.map((memory) => (
        <MemoryCard key={memory.id} memory={memory} {...props} />
      ))}
    </div>
  )
}

function MemoryCard({
  memory,
  onSave,
  onDelete,
  onPin,
  onError
}: {
  memory: Memory
  onSave: (id: string, content: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onPin: (id: string, pinned: boolean) => Promise<void>
  onError: (message: string) => void
}) {
  const [content, setContent] = useState(memory.content)
  useEffect(() => setContent(memory.content), [memory.content])
  return (
    <article className="card">
      <header>
        <span>{memory.kind}</span>
        <span>{memory.provenance === 'user_explicit' ? 'You asked to remember this' : memory.provenance === 'user_edit' ? 'Edited by you' : 'Saved during a chat'}</span>
        <time>{new Date(memory.updatedAt).toLocaleString()}</time>
      </header>
      <textarea value={content} rows={3} onChange={(event) => setContent(event.target.value)} />
      <div className="row">
        <button
          type="button"
          onClick={() => {
            void onSave(memory.id, content).catch((reason: unknown) => onError(messageOf(reason)))
          }}
        >
          Save correction
        </button>
        <button type="button" onClick={() => void onPin(memory.id, !memory.pinned).catch((reason: unknown) => onError(messageOf(reason)))}>
          {memory.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button type="button" className="danger" onClick={() => void onDelete(memory.id).catch((reason: unknown) => onError(messageOf(reason)))}>
          Delete
        </button>
      </div>
    </article>
  )
}

function ActivityPane({ activity, usage, scope, onScope }: { activity: ActivityEntry[]; usage: UsageSummary | null; scope: 'bot' | 'app'; onScope: (scope: 'bot' | 'app') => void }) {
  return (
    <div className="panel">
      <div className="row">
        <button type="button" className={scope === 'bot' ? 'send' : ''} onClick={() => onScope('bot')}>
          This bot
        </button>
        <button type="button" className={scope === 'app' ? 'send' : ''} onClick={() => onScope('app')}>
          All bots
        </button>
      </div>
      {usage && (
        <div className="usage">
          <h2>Today, all bots, {usage.day}</h2>
          <p>{usage.modelCalls} API model calls · {usage.codexTurns ?? 0} native Codex turns</p>
          <p>API estimated {formatUsd(usage.estimatedUsd)}</p>
          <p>API reported {formatUsd(usage.reportedUsd)}</p>
          <p>API unsettled reservations {formatUsd(usage.unsettledUsd)}</p>
          <p className="help">{usage.disclaimer}</p>
        </div>
      )}
      {activity.length === 0 && <p className="empty">No model calls yet.</p>}
      {activity.map((entry) => (
        <details key={entry.id} className="card">
          <summary>
            <span>{labelPurpose(entry.purpose)}</span>
            <span>{entry.provider}</span>
            <span>{entry.model}</span>
            <span>{entry.outcome ?? 'in progress'}</span>
            <span>{entry.costLabel === 'subscription' ? 'ChatGPT account usage' : entry.costLabel === 'reported' ? `Reported ${formatUsd(entry.reportedCostUsd ?? 0)}` : entry.costLabel === 'estimated' ? `Estimated ${formatUsd(entry.estimatedCostUsd ?? 0)}` : entry.costLabel ?? 'Cost unknown'}</span>
          </summary>
          <dl className="tech">
            <div>
              <dt>Trigger</dt>
              <dd>{entry.trigger}</dd>
            </div>
            <div>
              <dt>Task</dt>
              <dd>{entry.runId}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{new Date(entry.startedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>
                {entry.tokenSource ?? 'n/a'}: in {entry.inputTokens ?? '—'} / out {entry.outputTokens ?? '—'} / cache {entry.cacheTokens ?? '—'}
              </dd>
            </div>
            <div>
              <dt>Attempt</dt>
              <dd>{entry.attempt}</dd>
            </div>
          </dl>
          {entry.context && <ContextDetails context={entry.context} />}
          {entry.error && <p className="warn-text">{entry.error}</p>}
          {entry.tools.map((tool, index) => (
            <details key={`${tool.name}-${index}`}>
              <summary>
                {tool.name} · {tool.outcome ?? 'in progress'}
              </summary>
              <pre>{tool.argumentsPreview}</pre>
              {tool.resultPreview && <pre>{tool.resultPreview}</pre>}
              {tool.error && <p>{tool.error}</p>}
            </details>
          ))}
        </details>
      ))}
    </div>
  )
}

function SettingsPane(props: {
  bot: Bot
  preferences: AppPreferences
  settings: PublicSettings
  credentials: CredentialStatus
  codex: CodexStatus | null
  onCodex: (status: CodexStatus) => void
  api: RiotBridge
  onSaved: (settings: PublicSettings, credentials: CredentialStatus) => void
  onPreferences: (preferences: AppPreferences) => void
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState(props.settings)
  const [key, setKey] = useState('')
  const [keyNote, setKeyNote] = useState(props.credentials.explanation)
  const [savedNote, setSavedNote] = useState('')
  const [botName, setBotName] = useState(props.bot.name)
  const [botPurpose, setBotPurpose] = useState(props.bot.purpose)
  useEffect(() => setDraft(props.settings), [props.settings])
  useEffect(() => {
    setBotName(props.bot.name)
    setBotPurpose(props.bot.purpose)
  }, [props.bot])
  const configured = props.settings.provider === 'openai' ? props.credentials.openaiConfigured : props.credentials.openrouterConfigured
  return (
    <form
      className="panel settings"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setSavedNote('')
        const pendingKey = key.trim()
        void props.api
          .updateBot({ name: botName, purpose: botPurpose, instructions: draft.pinnedInstructions })
          .then(() => props.api.updateSettings(draft))
          .then(async (next) => {
            if (!pendingKey || draft.provider === 'codex') {
              props.onSaved(next, props.credentials)
              setSavedNote('Settings saved.')
              return
            }
            const result = await props.api.setCredential(draft.provider, pendingKey)
            setKey('')
            setKeyNote(result.message)
            props.onSaved(next, result.status)
            setSavedNote('Settings and API key saved.')
          })
          .catch((reason: unknown) => props.onError(messageOf(reason)))
      }}
    >
      <p className="help">Each bot chooses its own backend and model. API keys and the Codex connection are shared across this app’s bots.</p>
      <label>
        Bot name
        <input value={botName} onChange={(event) => setBotName(event.target.value)} />
      </label>
      <p className="help">Renaming does not move the workspace folder.</p>
      <label>
        Purpose
        <input value={botPurpose} onChange={(event) => setBotPurpose(event.target.value)} />
      </label>
      <p className="help">Workspace: {props.bot.workspacePath || 'No folder yet.'}</p>
      <button type="button" onClick={() => void props.api.openWorkspace().catch((reason: unknown) => props.onError(messageOf(reason)))}>
        Open workspace
      </button>
      <label>
        Provider
        <select value={draft.provider} onChange={(event) => { setKey(''); setDraft({ ...draft, provider: event.target.value as PublicSettings['provider'], model: '' }) }}>
          <option value="openai">OpenAI</option>
          <option value="openrouter">OpenRouter</option>
          <option value="codex">Codex · ChatGPT sign-in (preview)</option>
        </select>
      </label>
      <label>
        {draft.provider === 'codex' ? 'Codex model' : 'Model ID'}
        {draft.provider === 'codex' ? <select value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}>
          <option value="">{props.codex?.connected ? 'Choose an available model' : 'Connect Codex to load models'}</option>
          {draft.model && !props.codex?.models.some(model => model.id === draft.model) && <option value={draft.model}>{draft.model} · current choice</option>}
          {props.codex?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select> : <input value={draft.model} placeholder="Paste the model ID from your provider" onChange={(event) => setDraft({ ...draft, model: event.target.value })} />}
      </label>
      <p className="help">Riot Bot does not pick a model for you, and it does not assume every model can use tools or streaming.</p>
      {draft.provider === 'codex' ? <CodexConnection api={props.api} status={props.codex} onChange={props.onCodex} onError={props.onError} /> : <>
      <label>
        API key
        <input type="password" value={key} autoComplete="off" placeholder={configured ? 'A key is saved. Paste a new one to replace it.' : 'Paste an API key'} onChange={(event) => setKey(event.target.value)} />
      </label>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            if (draft.provider === 'codex') return
            void props.api
              .setCredential(draft.provider, key)
              .then((result) => {
                setKey('')
                setKeyNote(result.message)
                props.onSaved(draft, result.status)
              })
              .catch((reason: unknown) => props.onError(messageOf(reason)))
          }}
        >
          Save key
        </button>
        <button
          type="button"
          onClick={() => {
            if (draft.provider === 'codex') return
            void props.api
              .clearCredential(draft.provider)
              .then((status) => {
                setKeyNote(status.explanation)
                props.onSaved(draft, status)
              })
              .catch((reason: unknown) => props.onError(messageOf(reason)))
          }}
        >
          Clear key
        </button>
      </div>
      <p className="help">{keyNote}</p>
      </>}
      <label>
        Workspace folder
        <input value={draft.workspacePath} onChange={(event) => setDraft({ ...draft, workspacePath: event.target.value })} />
      </label>
      <button
        type="button"
        onClick={() => {
          void props.api.pickWorkspace().then((folder) => {
            if (folder) setDraft((current) => ({ ...current, workspacePath: folder }))
          })
        }}
      >
        Browse…
      </button>
      <label className="check">
        <input type="checkbox" checked={draft.workspaceEditing} onChange={(event) => setDraft({ ...draft, workspaceEditing: event.target.checked })} />
        Allow Riot Bot to create and edit files in this folder
      </label>
      <div className="callout">
        <strong>Terminal commands</strong>
        <p>{draft.provider === 'codex' ? 'Codex uses its native sandbox and approval rules. Safe read commands can run automatically. Commands that need approval appear here; broader network and filesystem permission grants are declined. Read-only mode prevents writes, but does not limit every native file read to this workspace. Native edits do not have Riot’s Undo button.' : TERMINAL_WARNING}</p>
      </div>
      {draft.provider !== 'codex' &&
      <label className="check">
        <input type="checkbox" checked={draft.streaming} onChange={(event) => setDraft({ ...draft, streaming: event.target.checked })} />
        Stream replies. Turn this off if a model rejects streaming.
      </label>
      }
      <label className="check">
        <input type="checkbox" checked={draft.toolsEnabled} onChange={(event) => setDraft({ ...draft, toolsEnabled: event.target.checked })} />
        {draft.provider === 'codex' ? 'Allow native shell, web search, and Riot memory/file tools.' : 'Allow tools. Turn this off if a model cannot use them.'}
      </label>
      <label>
        Instructions
        <textarea value={draft.pinnedInstructions} rows={4} onChange={(event) => setDraft({ ...draft, pinnedInstructions: event.target.value })} />
      </label>
      <div className="grid">
        <NumberField label="Task minutes" value={Math.round(draft.maxTaskDurationMs / 60000)} onChange={(value) => setDraft({ ...draft, maxTaskDurationMs: value * 60 * 1000 })} />
        {draft.provider !== 'codex' && <>
        <OptionalMoney label="Estimated spend per task (USD)" value={draft.maxEstimatedSpendPerTaskUsd} onChange={(value) => setDraft({ ...draft, maxEstimatedSpendPerTaskUsd: value })} />
        <OptionalMoney label="App daily spend ceiling (USD)" value={draft.maxEstimatedSpendPerDayUsd} onChange={(value) => setDraft({ ...draft, maxEstimatedSpendPerDayUsd: value })} />
        <OptionalMoney label="This bot’s daily limit (USD)" value={draft.botSpendPerDayUsd} onChange={(value) => setDraft({ ...draft, botSpendPerDayUsd: value })} />
        <OptionalMoney label="Input price per million tokens" value={draft.inputUsdPerMillion} onChange={(value) => setDraft({ ...draft, inputUsdPerMillion: value })} />
        <OptionalMoney label="Output price per million tokens" value={draft.outputUsdPerMillion} onChange={(value) => setDraft({ ...draft, outputUsdPerMillion: value })} />
        </>}
      </div>
      {draft.provider === 'codex' ? <p className="help">Codex manages its native tool loop, streaming, and context compaction. Riot’s API call, reply-token, context, and dollar limits do not control native turns. The task timer and Stop still apply. Native turns use your signed-in account’s Codex limits and any usage settings you have enabled there. Riot never switches to an API key automatically.</p> : <>
      <p className="help">
        Replies continue automatically when needed, and large files can be written in chunks. Context is managed automatically. Your task time and spending limits still apply. Browser search has no separate search fee.
      </p>
      <details className="tool">
        <summary>Advanced model limits</summary>
        <div className="grid">
          <NumberField label="Model calls per task" value={draft.maxModelCallsPerTask} onChange={(value) => setDraft({ ...draft, maxModelCallsPerTask: value })} />
          <label>Reply allowance<select value={draft.replyMode} onChange={event => setDraft({ ...draft, replyMode: event.target.value === 'manual' ? 'manual' : 'automatic' })}><option value="automatic">Automatic · includes model reasoning</option><option value="manual">Manual cap</option></select></label>
          {draft.replyMode === 'manual' && <NumberField label="Reply chunk token limit" value={draft.maxOutputTokens} onChange={(value) => setDraft({ ...draft, maxOutputTokens: value })} />}
          <label>
            Context fitting
            <select value={draft.contextMode} onChange={(event) => setDraft({ ...draft, contextMode: event.target.value === 'manual' ? 'manual' : 'automatic' })}>
              <option value="automatic">Automatic</option>
              <option value="manual">Manual input budget</option>
            </select>
          </label>
          <NumberField label="Manual input working budget" value={draft.contextTokenBudget} onChange={(value) => setDraft({ ...draft, contextTokenBudget: value })} />
          <label>
            Model context capacity
            <input
              type="number"
              min="1024"
              step="1"
              placeholder="Use documented size"
              value={draft.modelContextTokens ?? ''}
              onChange={(event) => setDraft({ ...draft, modelContextTokens: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </label>
          <NumberField label="Tool detail preview characters" value={draft.maxToolOutputChars} onChange={(value) => setDraft({ ...draft, maxToolOutputChars: value })} />
          <label>
            Search URL template
            <input value={draft.searchUrlTemplate} onChange={(event) => setDraft({ ...draft, searchUrlTemplate: event.target.value })} />
          </label>
        </div>
        <p className="help">
          Automatic mode compacts older chat toward about 12,000 fitted input tokens and reserves the reply limit once. If the provider does not publish a context length, enter one here or leave it blank. Blank uses a labeled conservative limit of 32,768 tokens. That number is not a claim about the model. Manual mode uses the input working budget as the hard ceiling. The default manual budget is 8,000 estimated tokens.
        </p>
      </details>
      <p className="help">Leave the dollar boxes blank to turn dollar limits off. The app daily ceiling applies to every bot. A bot limit can only tighten it. If a dollar box is filled in, both prices are required. Prices are your estimate, not a promise of the invoice.</p>
      </>}
      <label className="check">
        <input
          type="checkbox"
          checked={props.preferences.showToolDetails}
          onChange={(event) => {
            void props.api
              .updatePreferences({ showToolDetails: event.target.checked })
              .then((next) => props.onPreferences(next))
              .catch((reason: unknown) => props.onError(messageOf(reason)))
          }}
        />
        Show tool details by default
      </label>
      {draft.provider !== 'codex' && <ProviderCheck api={props.api} onError={props.onError} />}
      <div className="row">
        <button className="send" type="submit">
          Save settings
        </button>
        {savedNote && <p className="help">{savedNote}</p>}
      </div>
    </form>
  )
}

function CodexConnection({ api, status, onChange, onError }: { api: RiotBridge; status: CodexStatus | null; onChange: (status: CodexStatus) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  async function action(work: () => Promise<CodexStatus>): Promise<void> {
    setBusy(true)
    try { onChange(await work()) } catch (error) { onError(messageOf(error)) } finally { setBusy(false) }
  }
  useEffect(() => { void api.getCodexStatus().then(onChange).catch(error => onError(messageOf(error))) }, [api])
  return <div className="callout">
    <strong>Codex connection (preview)</strong>
    <p>{status?.connected ? `Connected: ${status.email ?? 'ChatGPT account'}${status.plan ? ` · ${status.plan}` : ''}` : 'Sign in with your own ChatGPT account through the official Codex CLI.'}</p>
    <p className="help">{status?.note}</p>
    <p className="help">Sending a message starts a native Codex turn with its own tools and web search. Sign-in and status checks do not start a turn. Credentials stay in Riot Bot’s separate Codex profile and are managed by the official CLI.</p>
    {status?.limits.map((limit, index) => <p key={`${limit.name}-${index}`} className="help">{limit.name}: {limit.usedPercent}% used{limit.resetsAt ? ` · resets ${new Date(limit.resetsAt * 1000).toLocaleString()}` : ''}</p>)}
    <div className="row">
      {!status?.connected && !status?.loginPending && <button type="button" disabled={busy || status?.installed === false} onClick={() => void action(() => api.connectCodex())}>Sign in with ChatGPT</button>}
      {status?.loginPending && <button type="button" disabled={busy} onClick={() => void action(() => api.cancelCodexLogin())}>Cancel sign-in</button>}
      <button type="button" disabled={busy} onClick={() => void action(() => api.getCodexStatus())}>Refresh Codex status</button>
      {status?.connected && <button type="button" disabled={busy} onClick={() => void action(() => api.disconnectCodex())}>Disconnect Codex</button>}
    </div>
    <p className="help">The model catalog is a list of available model IDs, not a guarantee of account access. Subscription activity is shown separately from API dollars.</p>
  </div>
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" step="any" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function OptionalMoney({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label>
      {label}
      <input
        type="number"
        min="0"
        step="any"
        value={value ?? ''}
        placeholder="Off"
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      />
    </label>
  )
}

function providerReady(settings: PublicSettings, credentials: CredentialStatus, codex: CodexStatus | null): boolean {
  if (settings.provider === 'codex') return Boolean(settings.model.trim() && codex?.connected && !codex.loginPending && (!codex.models.length || codex.models.some(model => model.id === settings.model)))
  if (!settings.model.trim()) return false
  return settings.provider === 'openai' ? credentials.openaiConfigured : credentials.openrouterConfigured
}

function ContextDetails({ context }: { context: ContextView }) {
  return (
    <details className="tool" open>
      <summary>Context</summary>
      <dl className="tech">
        <div>
          <dt>{context.capacitySource === 'manual' ? 'Input working budget' : 'Usable input'}</dt>
          <dd>
            {context.contextLimit} fitted tokens.
            {context.capacitySource === 'fallback' ? ' Conservative limit, not a documented model window.' : ''}
            {context.capacitySource === 'provider' ? ' From the provider’s published context length.' : ''}
            {context.capacitySource === 'configured' ? ' From the capacity entered in Advanced settings.' : ''}
            {context.assemblyTarget != null && context.capacitySource !== 'manual' ? ` Older chat is compacted toward ${context.assemblyTarget}.` : ''}
          </dd>
        </div>
        <div>
          <dt>Estimated input</dt>
          <dd>{context.estimatedInputTokens} tokens, estimated</dd>
        </div>
        <div>
          <dt>Reported input</dt>
          <dd>{context.reportedInputTokens == null ? 'The provider did not report input tokens.' : `${context.reportedInputTokens} tokens, reported by the provider`}</dd>
        </div>
        <div>
          <dt>Reply token limit</dt>
          <dd>{context.replyAllowance} tokens reserved for the reply, counted separately from the input budget</dd>
        </div>
        <div>
          <dt>Model context capacity</dt>
          <dd>
            {context.modelContextTokens == null
              ? 'Not documented. Riot Bot does not invent a model window.'
              : `${context.modelContextTokens} tokens, including input and reply`}
          </dd>
        </div>
        <div>
          <dt>Instructions</dt>
          <dd>{context.instructionsTokens} estimated</dd>
        </div>
        <div>
          <dt>Memories</dt>
          <dd>
            {context.memoriesTokens} estimated
            {context.memoryIds.length > 0 ? ` · included ${context.memoryIds.join(', ')}` : ' · none included'}
          </dd>
        </div>
        <div>
          <dt>Summary</dt>
          <dd>{context.summaryTokens} estimated</dd>
        </div>
        <div>
          <dt>Skills</dt>
          <dd>
            {context.skillsTokens} estimated
            {context.skills.length > 0 ? ` · ${context.skills.map((skill) => `${skill.name} (${skill.detail})`).join(', ')}` : ' · none included'}
          </dd>
        </div>
        <div>
          <dt>History</dt>
          <dd>{context.historyTokens} estimated</dd>
        </div>
        <div>
          <dt>Tool definitions</dt>
          <dd>{context.toolsTokens} estimated</dd>
        </div>
        <div>
          <dt>Compaction</dt>
          <dd>{context.compacted ? 'A summary step ran for this task. Its usage is listed as Summary.' : 'No summary step was attached to this request.'}</dd>
        </div>
        <div>
          <dt>Older conversation</dt>
          <dd>
            {context.omittedCount > 0
              ? `${context.omittedCount} older messages were left out of this request. The original transcript is still saved.`
              : 'No older messages were left out of this request.'}
          </dd>
        </div>
      </dl>
      <p className="help">{context.note}</p>
    </details>
  )
}

function SkillProposalCard(props: {
  proposal: SkillProposal
  api: RiotBridge
  onProposal: (proposal: SkillProposal | null) => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.proposal)
  useEffect(() => setDraft(props.proposal), [props.proposal])
  async function resolve(action: 'save' | 'dismiss'): Promise<void> {
    await props.api.resolveSkillProposal(props.proposal.id, action, action === 'save' ? draft : undefined)
    props.onProposal(null)
  }
  return (
    <article className="approval">
      <strong>{props.proposal.updateSkillId ? 'Update this skill?' : 'Save this skill?'}</strong>
      <p className="help">This is a preview. It does not change later chats until you press Save. A skill cannot grant permissions or raise a budget.</p>
      {editing ? (
        <SkillFields draft={draft} onChange={setDraft} />
      ) : (
        <>
          <p>
            <strong>{props.proposal.name}</strong> — {props.proposal.description}
          </p>
          <pre>{props.proposal.procedure}</pre>
          {props.proposal.pitfalls && <p>Pitfalls: {props.proposal.pitfalls}</p>}
          {props.proposal.verification && <p>Check: {props.proposal.verification}</p>}
        </>
      )}
      <div className="row">
        <button type="button" className="send" onClick={() => void resolve('save').catch((reason: unknown) => props.onError(messageOf(reason)))}>
          Save
        </button>
        <button type="button" onClick={() => setEditing((current) => !current)}>
          {editing ? 'Done editing' : 'Edit'}
        </button>
        <button type="button" onClick={() => void resolve('dismiss').catch((reason: unknown) => props.onError(messageOf(reason)))}>
          Dismiss
        </button>
      </div>
    </article>
  )
}

function SkillsPane(props: { api: RiotBridge; skills: Skill[]; onChange: (skills: Skill[]) => void; onError: (message: string) => void }) {
  const blank = { name: '', description: '', procedure: '', pitfalls: '', verification: '' }
  const [draft, setDraft] = useState(blank)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [versions, setVersions] = useState<SkillVersion[]>([])
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState<typeof blank | null>(null)
  const [exported, setExported] = useState('')
  async function refresh(): Promise<void> {
    props.onChange(await props.api.listSkills())
  }
  return (
    <div className="panel">
      <p className="help">
        A skill is a procedure you can reuse. Chats see a short catalog, then load the full procedure with a tool. Imported and suggested skills are lower-trust notes. They cannot change permissions, budgets, or rules, and importing one does not run code or install anything. A disabled or deleted skill leaves later requests. Older messages that mention it can remain in the transcript.
      </p>
      {props.skills.filter((skill) => !skill.deletedAt).length === 0 && <p className="empty">No skills yet. Save one here, or ask in a chat to save a workflow as a skill.</p>}
      {props.skills.filter((skill) => !skill.deletedAt).map((skill) => (
        <article key={skill.id} className="card">
          <header>
            <strong>{skill.name}</strong>
            <span>{skill.enabled ? 'Enabled' : 'Disabled'}</span>
            <span>Version {skill.version}</span>
          </header>
          <p>{skill.description}</p>
          {editingId === skill.id && (
            <>
              <SkillFields draft={draft} onChange={setDraft} />
              <div className="row">
                <button
                  type="button"
                  className="send"
                  onClick={() => {
                    void props.api
                      .updateSkill(skill.id, draft)
                      .then(refresh)
                      .then(() => setEditingId(null))
                      .catch((reason: unknown) => props.onError(messageOf(reason)))
                  }}
                >
                  Save edit
                </button>
              </div>
              {versions.length > 0 && (
                <div className="row">
                  {versions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => {
                        void props.api
                          .restoreSkillVersion(skill.id, version.version)
                          .then(refresh)
                          .catch((reason: unknown) => props.onError(messageOf(reason)))
                      }}
                    >
                      Restore version {version.version}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="row">
            <button
              type="button"
              onClick={() => {
                setEditingId(skill.id)
                setDraft(skill)
                void props.api.listSkillVersions(skill.id).then(setVersions).catch((reason: unknown) => props.onError(messageOf(reason)))
              }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                void props.api
                  .setSkillEnabled(skill.id, !skill.enabled)
                  .then(refresh)
                  .catch((reason: unknown) => props.onError(messageOf(reason)))
              }}
            >
              {skill.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              type="button"
              onClick={() => {
                void props.api
                  .exportSkills([skill.id])
                  .then(setExported)
                  .catch((reason: unknown) => props.onError(messageOf(reason)))
              }}
            >
              Export
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                void props.api
                  .deleteSkill(skill.id)
                  .then(refresh)
                  .catch((reason: unknown) => props.onError(messageOf(reason)))
              }}
            >
              Delete
            </button>
          </div>
        </article>
      ))}
      {props.skills.some((skill) => skill.deletedAt) && (
        <article className="card">
          <strong>Deleted</strong>
          <p className="help">Deleted skills are left out of later requests. The original chat can still mention them. Restore puts the saved version back.</p>
          {props.skills
            .filter((skill) => skill.deletedAt)
            .map((skill) => (
              <div key={skill.id} className="row">
                <span>{skill.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    void props.api
                      .restoreSkillVersion(skill.id, skill.version)
                      .then(refresh)
                      .catch((reason: unknown) => props.onError(messageOf(reason)))
                  }}
                >
                  Restore version {skill.version}
                </button>
              </div>
            ))}
        </article>
      )}
      <article className="card">
        <strong>{editingId ? 'Editing above' : 'New skill'}</strong>
        {!editingId && <SkillFields draft={draft} onChange={setDraft} />}
        {!editingId && (
          <button
            type="button"
            className="send"
            onClick={() => {
              void props.api
                .saveSkill(draft)
                .then(() => {
                  setDraft(blank)
                  return refresh()
                })
                .catch((reason: unknown) => props.onError(messageOf(reason)))
            }}
          >
            Save skill
          </button>
        )}
      </article>
      <article className="card">
        <strong>Import Markdown</strong>
        <p className="help">Preview comes first. Confirming adds the skill disabled, so it is not used until you enable it.</p>
        <textarea rows={6} value={importText} placeholder="Paste a skill file" onChange={(event) => setImportText(event.target.value)} />
        <div className="row">
          <button
            type="button"
            onClick={() => {
              void props.api
                .previewSkillImport(importText)
                .then(setImportPreview)
                .catch((reason: unknown) => props.onError(messageOf(reason)))
            }}
          >
            Preview import
          </button>
          {importPreview && (
            <button
              type="button"
              onClick={() => {
                void props.api
                  .importSkill(importText)
                  .then(() => {
                    setImportText('')
                    setImportPreview(null)
                    return refresh()
                  })
                  .catch((reason: unknown) => props.onError(messageOf(reason)))
              }}
            >
              Import disabled
            </button>
          )}
        </div>
        {importPreview && (
          <div>
            <p>
              <strong>{importPreview.name}</strong> — {importPreview.description}
            </p>
            <pre>{importPreview.procedure}</pre>
          </div>
        )}
      </article>
      {exported && (
        <article className="card">
          <strong>Exported Markdown</strong>
          <textarea rows={8} readOnly value={exported} />
        </article>
      )}
    </div>
  )
}

function SkillFields<T extends { name: string; description: string; procedure: string; pitfalls: string; verification: string }>(props: {
  draft: T
  onChange: (draft: T) => void
}) {
  const set = (key: 'name' | 'description' | 'procedure' | 'pitfalls' | 'verification', value: string): void => {
    props.onChange({ ...props.draft, [key]: value })
  }
  return (
    <div className="grid">
      <label>
        Name
        <input value={props.draft.name} onChange={(event) => set('name', event.target.value)} />
      </label>
      <label>
        When to use it
        <input value={props.draft.description} onChange={(event) => set('description', event.target.value)} />
      </label>
      <label>
        Procedure
        <textarea rows={5} value={props.draft.procedure} onChange={(event) => set('procedure', event.target.value)} />
      </label>
      <label>
        Pitfalls
        <textarea rows={3} value={props.draft.pitfalls} onChange={(event) => set('pitfalls', event.target.value)} />
      </label>
      <label>
        Verification
        <textarea rows={3} value={props.draft.verification} onChange={(event) => set('verification', event.target.value)} />
      </label>
    </div>
  )
}

function ProviderCheck(props: { api: RiotBridge; onError: (message: string) => void }) {
  const [plan, setPlan] = useState<ProviderCheckPlan | null>(null)
  const [result, setResult] = useState<ProviderCheckResult | null>(null)
  const [running, setRunning] = useState(false)
  return (
    <div className="callout">
      <strong>Provider check</strong>
      <p className="help">This is optional and uses API credits. It is not started by opening Settings. A passing check on one model does not mean every model works.</p>
      <button
        type="button"
        onClick={() => {
          setResult(null)
          void props.api
            .planProviderCheck()
            .then(setPlan)
            .catch((reason: unknown) => props.onError(messageOf(reason)))
        }}
      >
        Preview provider check
      </button>
      {plan && (
        <>
          <p>{plan.message}</p>
          {plan.blockedReason && <p className="warn-text">{plan.blockedReason}</p>}
          <button
            type="button"
            className="send"
            disabled={Boolean(plan.blockedReason) || running}
            onClick={() => {
              setRunning(true)
              void props.api
                .runProviderCheck()
                .then(setResult)
                .catch((reason: unknown) => props.onError(messageOf(reason)))
                .finally(() => setRunning(false))
            }}
          >
            {running ? 'Checking…' : 'Start provider check'}
          </button>
        </>
      )}
      {result && (
        <ul>
          {result.steps.map((step) => (
            <li key={step.name}>
              {step.ok ? 'Passed' : 'Did not pass'}: {step.name}. {step.detail}
            </li>
          ))}
          <li>{result.modelCalls} model calls were recorded.</li>
        </ul>
      )}
    </div>
  )
}

function screenTitle(screen: Screen): string {
  if (screen === 'jobs') return 'Jobs'
  if (screen === 'library') return 'Library'
  if (screen === 'memory') return 'Memory'
  if (screen === 'skills') return 'Skills'
  if (screen === 'activity') return 'Activity'
  if (screen === 'new-bot') return 'New Bot'
  if (screen === 'earlier') return 'Earlier conversations'
  return 'Settings'
}

function BotMenu(props: {
  api: RiotBridge
  bot: Bot
  note: string
  onNote: (value: string) => void
  onError: (message: string) => void
  onBot: (bot: Bot) => void
  onEarlier: () => void
  onSettings: () => void
}) {
  const [name, setName] = useState(props.bot.name)
  const [purpose, setPurpose] = useState(props.bot.purpose)
  const [instructions, setInstructions] = useState(props.bot.instructions)
  const [browser, setBrowser] = useState<BrowserView | null>(null)

  useEffect(() => {
    setName(props.bot.name)
    setPurpose(props.bot.purpose)
    setInstructions(props.bot.instructions)
    void props.api.getSnapshot().then((snapshot) => setBrowser(snapshot.browser)).catch(() => undefined)
  }, [props.api, props.bot])

  async function saveProfile(): Promise<void> {
    try {
      props.onBot(await props.api.updateBot({ name, purpose, instructions }))
    } catch (reason) {
      props.onError(messageOf(reason))
    }
  }

  async function browserAction(action: () => Promise<string>): Promise<void> {
    try {
      const message = await action()
      props.onNote(message)
      setBrowser((await props.api.getSnapshot()).browser)
    } catch (reason) {
      props.onError(messageOf(reason))
    }
  }

  return (
    <div className="bot-menu">
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Purpose
        <input value={purpose} onChange={(event) => setPurpose(event.target.value)} />
      </label>
      <label>
        Instructions
        <textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
      </label>
      <button type="button" onClick={() => void saveProfile()}>
        Save bot
      </button>
      <div className="avatar-picker">
        {AVATAR_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className="swatch"
            style={{ background: props.bot.avatar.background }}
            onClick={() => {
              void props.api.setAvatar({ kind: 'builtin', value: choice.value, background: props.bot.avatar.background }).then(props.onBot).catch((reason: unknown) => props.onError(messageOf(reason)))
            }}
          >
            <BotAvatar avatar={{ kind: 'builtin', value: choice.value, background: props.bot.avatar.background, imageUrl: null }} size={22} />
          </button>
        ))}
      </div>
      <div className="avatar-picker">
        {AVATAR_EMOJIS.slice(0, 8).map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              void props.api.setAvatar({ kind: 'emoji', value: emoji, background: props.bot.avatar.background }).then(props.onBot).catch((reason: unknown) => props.onError(messageOf(reason)))
            }}
          >
            {emoji}
          </button>
        ))}
        {AVATAR_COLORS.slice(0, 5).map((color) => (
          <button key={color} type="button" className="swatch" style={{ background: color }} onClick={() => {
            const kind = props.bot.avatar.kind === 'image' ? 'builtin' : props.bot.avatar.kind
            void props.api.setAvatar({ kind, value: props.bot.avatar.value, background: color }).then(props.onBot).catch((reason: unknown) => props.onError(messageOf(reason)))
          }} />
        ))}
      </div>
      <button type="button" onClick={() => void props.api.openWorkspace().catch((reason: unknown) => props.onError(messageOf(reason)))}>
        Open Workspace
      </button>
      <button type="button" onClick={props.onEarlier}>
        Earlier conversations
      </button>
      <button type="button" onClick={props.onSettings}>
        Settings
      </button>
      <p className="help">{browser?.installed ? `${browser.browserName || 'A browser'} is available.` : 'No supported browser was found.'} {browser?.downloadNote}</p>
      {browser?.open && <p className="help">A signed-in page can keep making ordinary website requests while the window is open. That is not a model call.</p>}
      <div className="row">
        <button type="button" onClick={() => void browserAction(() => props.api.openBrowser())}>Open Browser</button>
        <button type="button" onClick={() => void browserAction(() => props.api.closeBrowser())}>Close Browser</button>
      </div>
      <div className="row">
        <button type="button" onClick={() => void browserAction(() => props.api.takeoverBrowser())}>Take over</button>
        <button type="button" onClick={() => void browserAction(() => props.api.resumeBrowser())}>Resume</button>
      </div>
      <button type="button" disabled={browser?.installing} onClick={() => void browserAction(() => props.api.installBrowser())}>
        Install Chromium
      </button>
      {props.note && <p className="help">{props.note}</p>}
    </div>
  )
}

function EarlierPane(props: {
  api: RiotBridge
  conversations: Conversation[]
  onOpen: (id: string) => void
  onError: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<HistoryHitView[]>([])
  const visible = props.conversations.filter((conversation) => conversation.title.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="panel">
      <p className="help">These chats stay saved. New messages go to this bot’s ongoing conversation. Search stays on this bot.</p>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault()
          void props.api.searchHistory(query).then(setHits).catch((reason: unknown) => props.onError(messageOf(reason)))
        }}
      >
        <input value={query} placeholder="Search this bot" onChange={(event) => setQuery(event.target.value)} />
        <button type="submit">Search</button>
      </form>
      {visible.map((conversation) => (
        <button key={conversation.id} type="button" className="chat-link" onClick={() => props.onOpen(conversation.id)}>
          {conversation.title}
        </button>
      ))}
      {visible.length === 0 && <p className="empty">No earlier conversations.</p>}
      {hits.map((hit) => (
        <button key={hit.messageId} type="button" className="chat-link" onClick={() => props.onOpen(hit.conversationId)}>
          <strong>{hit.title}</strong>
          <span>{hit.snippet}</span>
        </button>
      ))}
    </div>
  )
}

function NewBotForm(props: { settings: PublicSettings; onCreate: (draft: BotDraft) => Promise<void>; onError: (message: string) => void }) {
  const [purpose, setPurpose] = useState('')
  const [name, setName] = useState('')
  const [provider, setProvider] = useState(props.settings.provider)
  const [model, setModel] = useState(props.settings.model)
  const [folder, setFolder] = useState('')
  const [avatarValue, setAvatarValue] = useState('spark')
  const [avatarKind, setAvatarKind] = useState<'builtin' | 'emoji' | 'image'>('builtin')
  const [background, setBackground] = useState(AVATAR_COLORS[0])
  const [bytes, setBytes] = useState<number[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="panel settings"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        void props
          .onCreate({
            purpose,
            name,
            provider,
            model,
            workspaceKind: folder ? 'existing' : 'suggested',
            workspacePath: folder,
            avatarKind,
            avatarValue,
            avatarBackground: background,
            avatarBytes: bytes
          })
          .catch((reason: unknown) => props.onError(messageOf(reason)))
          .finally(() => setBusy(false))
      }}
    >
      <p className="help">A bot keeps its own chats, memories, skills, and workspace. It can create files in its new workspace. {provider === 'codex' ? 'Codex bots use a local default name when left blank; setup does not start a native turn.' : 'If you leave the name blank and a model is configured, one short setup request suggests a name and instructions.'}</p>
      <label>
        What should this bot help with?
        <textarea value={purpose} rows={3} onChange={(event) => setPurpose(event.target.value)} />
      </label>
      <label>
        Name
        <input value={name} placeholder="Leave blank to let the bot choose." onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Provider
        <select value={provider} onChange={(event) => { setProvider(event.target.value as PublicSettings['provider']); setModel('') }}>
          <option value="openai">OpenAI</option>
          <option value="openrouter">OpenRouter</option>
          <option value="codex">Codex · ChatGPT sign-in (preview)</option>
        </select>
      </label>
      <label>
        Model ID
        <input value={model} onChange={(event) => setModel(event.target.value)} />
      </label>
      <p className="help">Suggested workspace: a new folder under your home directory in RiotBot\workspaces. Choose another folder if you already have one. Existing files stay where they are.</p>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            void window.riot?.pickWorkspace().then((picked) => {
              if (picked) setFolder(picked)
            })
          }}
        >
          Choose another folder
        </button>
        {folder && <span>{folder}</span>}
      </div>
      <p className="help">Avatar</p>
      <div className="avatar-picker">
        {AVATAR_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={avatarKind === 'builtin' && avatarValue === choice.value ? 'bot-chip active' : 'bot-chip'}
            onClick={() => {
              setAvatarKind('builtin')
              setAvatarValue(choice.value)
              setBytes(undefined)
            }}
          >
            <BotAvatar avatar={{ kind: 'builtin', value: choice.value, background, imageUrl: null }} label={choice.label} />
          </button>
        ))}
        {AVATAR_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className={avatarKind === 'emoji' && avatarValue === emoji ? 'bot-chip active' : 'bot-chip'}
            onClick={() => {
              setAvatarKind('emoji')
              setAvatarValue(emoji)
              setBytes(undefined)
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="row">
        {AVATAR_COLORS.map((color) => (
          <button key={color} type="button" className="swatch" style={{ background: color }} aria-label={color} onClick={() => setBackground(color)} />
        ))}
      </div>
      <label>
        Upload an image
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            void file.arrayBuffer().then((buffer) => {
              setBytes([...new Uint8Array(buffer)])
              setAvatarKind('image')
            })
          }}
        />
      </label>
      <button className="send" type="submit" disabled={busy || purpose.trim().length < 2}>
        Create bot
      </button>
    </form>
  )
}

function labelPurpose(purpose: string): string {
  if (purpose === 'reply_continuation') return 'Automatic continuation'
  if (purpose === 'codex_turn') return 'Native Codex turn'
  if (purpose === 'compaction') return 'Summary'
  if (purpose === 'tool_continuation') return 'Follow-up'
  if (purpose === 'chat') return 'Reply'
  if (purpose === 'bot_setup') return 'Bot setup'
  return purpose
}

function mergeMessage(current: ConversationDetail | null, message: ChatMessageView): ConversationDetail | null {
  if (!current) return current
  const exists = current.messages.some((item) => item.id === message.id)
  const messages = exists ? current.messages.map((item) => (item.id === message.id ? message : item)) : [...current.messages, message]
  return { ...current, messages }
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong.'
}
