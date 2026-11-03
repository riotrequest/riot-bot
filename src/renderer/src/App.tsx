import { useEffect, useRef, useState } from 'react'
import type {
  ActivityEntry,
  AppPreferences,
  AppSettings,
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
import { ChatWelcome, EmptyState, Icon, ModelBadge, ProviderPicker, messageOf, providerName, type IconName } from './ui'

type Screen = 'chat' | 'jobs' | 'library' | 'memory' | 'skills' | 'activity' | 'settings' | 'bot-settings' | 'new-bot' | 'earlier'

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
  const [loaded, setLoaded] = useState(false)
  const [bots, setBots] = useState<Bot[]>([])
  const [bot, setBot] = useState<Bot | null>(null)
  const [jobs, setJobs] = useState<JobView[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactView[]>([])
  const [preferences, setPreferences] = useState<AppPreferences>({ showToolDetails: false })
  const [activityScope, setActivityScope] = useState<'bot' | 'app'>('bot')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
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
  const [editingBusy, setEditingBusy] = useState(false)
  const [ongoingId, setOngoingId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Bot | null>(null)
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
    setAppSettings(snapshot.appSettings)
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
    setLoaded(true)
    if (!snapshot.bot) setScreen('new-bot')
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
  const activeTaskCount = botJobs.filter(job => job.status === 'running' || job.status === 'queued').length
  const viewingEarlier = Boolean(detail && ongoingId && detail.conversation.id !== ongoingId && screen === 'chat')
  useEffect(() => {
    if (settings?.provider === 'codex') void api.getCodexStatus().then(setCodex).catch(() => undefined)
  }, [api, settings?.provider])

  const configured = settings && credentials ? providerReady(settings, credentials, codex) : false

  async function send(): Promise<void> {
    if (!detail || (!draft.trim() && !draftAttachments.length) || busy) return
    if (!configured) { showScreen('bot-settings'); return }
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
    if (editingBusy) return
    if (bot) drafts.current[bot.id] = draft
    setMenuOpen(false)
    await api.selectBot(id)
    await reload()
    setDraft(drafts.current[id] ?? '')
    setScreen('chat')
  }

  function showScreen(next: Screen): void {
    if (editingBusy) return
    setMenuOpen(false)
    setScreen(next)
  }

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Bots and app settings">
        <div className="brand">
          <span className="mark"><Icon name="spark" /></span>
          <div>
            <strong>Riot Bot</strong>
            <p>A little help, every day.</p>
          </div>
        </div>
        <button
          className="new-chat"
          disabled={editingBusy}
          onClick={() => {
            if (bot) drafts.current[bot.id] = draft
            setMenuOpen(false)
            setScreen('new-bot')
          }}
        >
          <Icon name="plus" /> New bot
        </button>
        <p className="sidebar-label">YOUR BOTS <span>{bots.length}</span></p>
        <div className="bot-list">
          {bots.map((item) => (
            <div key={item.id} className={item.id === bot?.id ? 'bot-row active' : 'bot-row'}>
              <button
                type="button"
                className="bot-select"
                disabled={editingBusy}
                aria-current={item.id === bot?.id ? 'true' : undefined}
                onClick={() => {
                  void selectBot(item.id).catch((reason: unknown) => setError(messageOf(reason)))
                }}
              >
                <BotAvatar avatar={item.avatar} label={item.name} size={28} />
                <span className="bot-row-label"><strong>{item.name}</strong><small>{item.purpose || 'Your personal assistant'}</small></span>
                {jobs.some((job) => job.botId === item.id && (job.status === 'running' || job.status === 'queued')) && <small className="bot-job-status">{jobs.some((job) => job.botId === item.id && job.awaitingApproval) ? 'Approval' : jobs.some((job) => job.botId === item.id && job.status === 'running') ? 'Working' : 'Queued'}</small>}
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <nav className="utility-nav" aria-label="App controls">
            <button disabled={editingBusy} className={!menuOpen && screen === 'settings' ? 'active' : ''} aria-label="App settings" aria-current={!menuOpen && screen === 'settings' ? 'page' : undefined} onClick={() => showScreen('settings')}><Icon name="settings" /> Settings</button>
            <button disabled={!bot || editingBusy} className={!menuOpen && screen === 'activity' ? 'active' : ''} aria-current={!menuOpen && screen === 'activity' ? 'page' : undefined} onClick={() => showScreen('activity')}><Icon name="activity" /> Usage & activity</button>
          </nav>
          <p className="desktop-note"><span className="status-dot" /> Runs on your computer</p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="title-lockup">
            {bot && (screen === 'chat' || menuOpen) && <BotAvatar avatar={bot.avatar} label={bot.name} size={36} />}
            <div>
              <h1>{menuOpen ? 'Bot settings' : screen === 'chat' ? (viewingEarlier ? detail?.conversation.title : bot?.name) ?? 'Welcome to Riot' : screenTitle(screen)}</h1>
              {screen === 'chat' && !menuOpen && settings ? <ModelBadge provider={settings.provider} model={settings.model} models={codex?.models} onClick={() => showScreen('bot-settings')} /> : <p className="status">
                {menuOpen ? 'A name, a personality, and a space of its own.' : screen === 'chat' ? running ? 'Working on it. You can add your next message.' : queued ? 'Your request is in line. You can add another message.' : configured ? 'Your ongoing conversation. Pick up anywhere.' : 'Let’s get your assistant ready.' : screenDescription(screen)}
              </p>}
            </div>
          </div>
          <div className="topbar-actions">
            {screen === 'chat' && bot && <span className={`connection-status ${configured ? '' : 'pending'}`}><span className={`status-dot ${configured ? '' : 'pending'}`} />{running ? 'Working' : queued ? 'In queue' : configured ? 'Ready to chat' : 'Setup needed'}</span>}
            {menuOpen && <button type="button" className="back-button" disabled={editingBusy} onClick={() => { setMenuOpen(false); setScreen('bot-settings') }}><Icon name="back" /> Back</button>}
            {running && <button className="stop" onClick={() => void api.stop().catch((reason: unknown) => setError(messageOf(reason)))}>Stop</button>}
          </div>
        </header>
        {error && (
          <div className="banner warn" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        {approval && (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            onResolve={(approved) => {
              void api.resolveApproval(approval.id, approved).catch((reason: unknown) => setError(messageOf(reason)))
            }}
          />
        )}
        {menuOpen && bot ? (
          <BotMenu
            api={api}
            bot={bot}
            running={running}
            onDelete={() => setDeleteTarget(bot)}
            note={browserNote}
            onNote={setBrowserNote}
            onError={setError}
            onBusy={setEditingBusy}
            onBot={(next) => {
              if (next.id !== viewedBotId.current) return
              setBot(next)
              setBots((current) => current.map((item) => (item.id === next.id ? next : item)))
              setSettings(current => current ? { ...current, pinnedInstructions: next.instructions } : current)
            }}
            onEarlier={() => { setMenuOpen(false);setScreen('earlier') }}
            onSettings={() => { setMenuOpen(false);setScreen('bot-settings') }}
          />
        ) : <>
        {!loaded && <div className="empty-state" role="status">Getting your workspace ready…</div>}
        {screen === 'new-bot' && settings && appSettings && (
          <NewBotForm
            settings={{ ...settings, ...appSettings }}
            api={api}
            codex={codex}
            onCodex={setCodex}
            onCreate={async (input) => {
              if (bot) drafts.current[bot.id] = draft
              const result = await api.createBot(input)
              await reload()
              setDraft('')
              setScreen('chat')
              setError(/failed|stopped|temporary|not available/i.test(result.status) ? result.status : null)
            }}
            onError={setError}
            onCancel={bot ? () => setScreen('chat') : undefined}
            onBusy={setEditingBusy}
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
            botName={bot?.name ?? 'Riot Bot'}
            botPurpose={bot?.purpose ?? ''}
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
            onOpenSettings={() => setScreen('bot-settings')}
            configured={configured}
            configurationNote={settings?.provider === 'codex' && codex?.connected && codex.models.length > 0 && !codex.models.some((model) => model.id === settings.model) ? `The saved model ${settings.model} is not listed for this Codex account. Choose an available model in Bot settings.` : undefined}
            showToolDetails={preferences.showToolDetails}
            avatar={bot?.avatar ?? null}
            proposal={proposal}
            api={api}
            onProposal={(next) => {if (viewedBotId.current === detail.conversation.botId) setProposal(next)}}
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
        {screen === 'settings' && appSettings && credentials && <AppSettingsPane settings={appSettings} preferences={preferences} credentials={credentials} codex={codex} onCodex={setCodex} api={api} onPreferences={setPreferences} onError={setError} onBusy={setEditingBusy} onDone={() => setScreen(bot ? 'chat' : 'new-bot')} onSaved={(next, status) => { setAppSettings(next); setCredentials(status); setSettings(current => current ? { ...current, maxEstimatedSpendPerDayUsd: next.maxEstimatedSpendPerDayUsd } : current) }} />}
        {screen === 'bot-settings' && settings && appSettings && credentials && bot && (
          <SettingsPane
            key={bot.id}
            bot={bot}
            appSettings={appSettings}
            settings={settings}
            credentials={credentials}
            codex={codex}
            onCodex={setCodex}
            api={api}
            onSaved={(next, status) => {
              setCredentials(status)
              if (bot.id !== viewedBotId.current) return
              setSettings(next)
              void api.getSnapshot().then((snapshot) => {
                if (snapshot.bot?.id !== viewedBotId.current) return
                setBots(snapshot.bots)
                setBot(snapshot.bot)
                setPreferences(snapshot.preferences)
              }).catch((reason: unknown) => setError(messageOf(reason)))
            }}
            onAppSettings={() => showScreen('settings')}
            onProfile={() => setMenuOpen(true)}
            onError={(next) => setError(next)}
            onDone={() => setScreen('chat')}
            onBusy={setEditingBusy}
          />
        )}
        </>}
      </main>
      <aside className="workspace-sidebar" aria-label="Workspace">
        <div className="workspace-heading"><p className="sidebar-label">WORKSPACE</p><strong title={bot?.name}>{bot?.name ?? 'Choose a bot to get started'}</strong></div>
        <nav className="workspace-nav" aria-label="Bot workspace">
          {([
            ['chat', 'chat', 'Chat'], ['jobs', 'tasks', 'Tasks'], ['library', 'files', 'Files'],
            ['memory', 'memory', 'Memories'], ['skills', 'spark', 'Skills']
          ] as [Screen, IconName, string][]).map(([value, icon, label]) => <button key={value} disabled={!bot || editingBusy} className={(!menuOpen && screen === value) || (menuOpen && value === 'bot-settings') ? 'active' : ''} aria-current={(!menuOpen && screen === value) || (menuOpen && value === 'bot-settings') ? 'page' : undefined} onClick={() => showScreen(value)}>
            <Icon name={icon} /><span>{label}</span>{value === 'jobs' && activeTaskCount > 0 && <small className="nav-count">{activeTaskCount}</small>}
          </button>)}
        </nav>
        <div className="workspace-footer">
          {bot && !configured && <button className="connection-nudge" disabled={editingBusy} onClick={() => showScreen('bot-settings')}><span className="status-dot pending" /><span><strong>Connect your AI</strong><small>One step to your first chat</small></span><Icon name="chevron" /></button>}
          <nav className="workspace-nav" aria-label="Bot controls"><button disabled={!bot || editingBusy} className={menuOpen || screen === 'bot-settings' ? 'active' : ''} aria-current={menuOpen || screen === 'bot-settings' ? 'page' : undefined} onClick={() => showScreen('bot-settings')}><Icon name="settings" /><span>Bot settings</span></button></nav>
          <p>Model, profile, files & tools<br />for this bot.</p>
        </div>
      </aside>
      {deleteTarget && <DeleteBotDialog bot={deleteTarget} onCancel={() => setDeleteTarget(null)} onDelete={async (confirmationName) => {
        const result = await api.deleteBot(deleteTarget.id,confirmationName)
        delete drafts.current[deleteTarget.id]
        setDeleteTarget(null)
        setMenuOpen(false)
        setDraft('')
        await reload()
        setScreen(result.snapshot.bot ? 'chat' : 'new-bot')
        setError(result.cleanupWarning)
      }} />}
    </div>
  )
}

function ChatPane(props: {
  detail: ConversationDetail
  botName: string
  botPurpose: string
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
  const composer = useRef<HTMLTextAreaElement>(null)

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
      {!props.configured && props.detail.messages.length > 0 && (
        <div className="banner">
          <span>{props.configurationNote ?? 'Connect your AI to continue this conversation. Your messages are saved here.'}</span>
          <button type="button" onClick={props.onOpenSettings}>Connect your AI</button>
        </div>
      )}
      {props.proposal && <SkillProposalCard key={props.proposal.id} proposal={props.proposal} api={props.api} onProposal={props.onProposal} onError={props.onError} />}
      {props.detail.messages.length === 0 && !props.readOnly ? <ChatWelcome name={props.botName} purpose={props.botPurpose} configured={props.configured} onConnect={props.onOpenSettings} onPrompt={(prompt) => { props.onDraft(prompt); composer.current?.focus() }} /> : <ChatTranscript
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
      />}
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
      {(props.running || props.queued > 0) && <div className="queue-strip"><span>{props.running ? 'Your bot is working.' : 'Your message is waiting its turn.'} {props.queued > 0 ? `${props.queued} message${props.queued === 1 ? '' : 's'} in line.` : 'You can add your next request below.'}</span><button onClick={props.onJobs}>View tasks</button></div>}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (!attaching) { if (props.configured) props.onSend(); else props.onOpenSettings?.() }
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
            ref={composer}
            aria-label={`Message ${props.botName}`}
            aria-describedby="composer-hint"
            value={props.draft}
            placeholder={props.running ? 'Add your next request…' : `Ask ${props.botName} anything, or describe a task…`}
            rows={2}
            onChange={(event) => props.onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!attaching) { if (props.configured) props.onSend(); else props.onOpenSettings?.() }
              }
            }}
            onPaste={(event) => {
              if (!event.clipboardData.files.length) return
              event.preventDefault()
              void upload(Array.from(event.clipboardData.files))
            }}
          />
          <div className="attachment-controls">
            <button type="button" disabled={attaching} title="Add up to 4 images or text files" onClick={() => void attach(() => props.api.pickAttachments())}><Icon name="attach" /> Attach files</button>
            <button type="button" disabled={attaching} title="Copy a screenshot, then paste it here" onClick={() => void attach(async () => [await props.api.pasteScreenshot()])}><Icon name="image" /> Paste screenshot</button>
            <span className="help" role="status">{attaching ? 'Adding attachment…' : 'Images & text · Up to 4 files'}</span>
          </div>
        </div>
        <button className="send" type="submit" disabled={attaching || props.submitting || (!props.draft.trim() && !props.attachments.length)}>
          {props.submitting ? 'Saving…' : !props.configured ? 'Connect to send' : props.running || props.queued ? 'Add to queue' : 'Send'} <Icon name="arrow" />
        </button>
      </form>
      <p className="composer-hint" id="composer-hint">Enter to send <span>·</span> Shift + Enter for a new line</p>
      </>
      )}
    </>
  )
}

export function ApprovalCard({ approval, onResolve }: { approval: ApprovalView; onResolve: (approved: boolean) => void }) {
  const files = approval.kind === 'codex' && approval.title === 'Allow this Codex file?'
  const browser = approval.kind === 'browser'
  const firstLine = approval.command.trim().split(/[\r\n]/, 1)[0]
  const preview = firstLine.slice(0, 160) + (approval.command.trim().length > Math.min(firstLine.length,160) ? '…' : '')
  return (
    <section className="approval" aria-label="Approval request">
      <strong>{files ? 'Allow file changes?' : browser ? 'Allow browser action?' : 'Allow command?'}</strong>
      <p className="approval-summary">{files ? 'Codex wants to update project files.' : <code>{preview}</code>}</p>
      <p className="approval-warning">{approval.warning}</p>
      <p className="approval-folder" title={approval.cwd}>Folder: {approval.cwd}</p>
      <details className="approval-details">
        <summary>{files ? 'View changes' : browser ? 'View action details' : 'View command'}</summary>
        <p className="help">Time limit: {Math.round(approval.timeoutMs / 1000)} seconds</p>
        <pre tabIndex={0} aria-label="Request details"><code>{approval.command}</code></pre>
      </details>
      <div className="row approval-actions">
        <button type="button" onClick={() => onResolve(false)}>
          Don’t allow
        </button>
        <button type="button" className="send" onClick={() => onResolve(true)}>
          {files ? 'Allow changes' : browser ? 'Allow action' : 'Allow command'}
        </button>
      </div>
    </section>
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
      <div className="page-intro"><h2>A little context goes a long way.</h2><p>Facts and preferences your bot can remember for next time. You can edit or remove them whenever you like.</p></div>
      <input aria-label="Search memories" value={query} placeholder="Find a memory…" onChange={(event) => setQuery(event.target.value)} />
      {shown.length === 0 && <EmptyState icon="memory" title={query ? 'No matching memories' : 'Your bot is getting to know you'}>{query ? 'Try a different word or clear your search.' : 'Try saying “Remember this: I prefer short, straightforward answers” in chat.'}</EmptyState>}
      <details className="subtle-details"><summary>How memories work</summary><p className="help">“Remember this” saves your wording. Removing a memory stops it being used in future replies; earlier chats can still mention it. Avoid saving passwords or other secrets.</p></details>
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
      <div className="page-intro"><h2>Know where things stand.</h2><p>See today’s usage across the app. Expand an entry below when you need the details.</p></div>
      <div className="row">
        <button type="button" aria-pressed={scope === 'bot'} className={scope === 'bot' ? 'send' : ''} onClick={() => onScope('bot')}>
          This bot
        </button>
        <button type="button" className={scope === 'app' ? 'send' : ''} onClick={() => onScope('app')}>
          All bots
        </button>
      </div>
      {usage && (
        <div className="usage">
          <h2>Today across all bots</h2><p className="help">{usage.day}</p>
          <p>{usage.modelCalls} API model calls · {usage.codexTurns ?? 0} native Codex turns</p>
          <p>API estimated {formatUsd(usage.estimatedUsd)}</p>
          <p>API reported {formatUsd(usage.reportedUsd)}</p>
          <p>API unsettled reservations {formatUsd(usage.unsettledUsd)}</p>
          <p className="help">{usage.disclaimer}</p>
        </div>
      )}
      {activity.length === 0 && <EmptyState icon="activity" title="Nothing to track yet">Usage appears here after you send a message. Opening the app doesn’t start an AI task.</EmptyState>}
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

function AppSettingsPane(props: {
  settings: AppSettings
  preferences: AppPreferences
  credentials: CredentialStatus
  codex: CodexStatus | null
  api: RiotBridge
  onCodex: (status: CodexStatus) => void
  onSaved: (settings: AppSettings, credentials: CredentialStatus) => void
  onPreferences: (preferences: AppPreferences) => void
  onError: (message: string) => void
  onBusy: (busy: boolean) => void
  onDone: () => void
}) {
  const [tab, setTab] = useState<'connection' | 'preferences'>('connection')
  const [draft, setDraft] = useState(props.settings)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const keySaved = draft.provider === 'openai' ? props.credentials.openaiConfigured : draft.provider === 'openrouter' && props.credentials.openrouterConfigured
  const changed = JSON.stringify(draft) !== JSON.stringify(props.settings) || Boolean(key.trim())
  function update(patch: Partial<AppSettings>): void { setDraft(current => ({ ...current, ...patch })); setNote(''); setError('') }
  async function save(): Promise<void> {
    if (saving) return
    setSaving(true); props.onBusy(true); setNote(''); setError('')
    try {
      let credentials = props.credentials
      if (key.trim() && draft.provider !== 'codex') {
        credentials = (await props.api.setCredential(draft.provider, key.trim())).status
        setKey('')
        props.onSaved(props.settings, credentials)
      }
      const next = await props.api.updateAppSettings(draft)
      setDraft(next)
      props.onSaved(next, credentials)
      setNote('App settings saved. Existing bots keep their chosen models.')
    } catch (reason) { setError(messageOf(reason)) }
    finally { setSaving(false); props.onBusy(false) }
  }
  return <form className="settings-page" noValidate onSubmit={event => { event.preventDefault(); void save() }}>
    <nav className="settings-tabs" aria-label="App settings sections">
      <button type="button" disabled={saving} className={tab === 'connection' ? 'active' : ''} aria-current={tab === 'connection' ? 'page' : undefined} onClick={() => setTab('connection')}>Connections & default model</button>
      <button type="button" disabled={saving} className={tab === 'preferences' ? 'active' : ''} aria-current={tab === 'preferences' ? 'page' : undefined} onClick={() => setTab('preferences')}>Preferences & spending</button>
    </nav>
    <fieldset className="settings-content" disabled={saving}>
      {tab === 'connection' ? <>
        <div className="page-intro"><p className="eyebrow">ACROSS YOUR WHOLE APP</p><h2>Your starting point for every new bot.</h2><p>Manage shared connections and choose the model new bots start with. Existing bots keep their own choices.</p></div>
        <section className="settings-section"><div className="section-heading"><span className="step-number">1</span><h3>Choose your default connection</h3></div><ProviderPicker value={draft.provider} onChange={provider => { setKey(''); update({ provider, model: '' }) }} /></section>
        <section className="settings-section"><div className="section-heading"><span className="step-number">2</span><h3>{draft.provider === 'codex' ? 'Connect your ChatGPT account' : 'Connect your provider'}</h3>{keySaved && <span className="small-badge"><Icon name="check" /> Key saved</span>}</div>
          {draft.provider === 'codex' ? <CodexConnection api={props.api} status={props.codex} onChange={props.onCodex} onError={props.onError} /> : <>
            <p className="help">This key is shared by all bots using {providerName(draft.provider)}. API usage is billed by your provider.</p>
            <label>API key<input type="password" autoComplete="off" spellCheck={false} value={key} placeholder={keySaved ? 'A key is saved. Paste here only to replace it.' : `Paste your ${providerName(draft.provider)} API key`} onChange={event => { setKey(event.target.value); setNote('') }} /></label>
            <p className="help">{props.credentials.explanation} New keys are saved with Save app settings.</p>
            {keySaved && <details className="subtle-details"><summary>Manage saved key</summary><p className="help">Removing this key disconnects all bots using {providerName(draft.provider)}.</p><button type="button" className="danger" onClick={() => { if (draft.provider !== 'codex') void props.api.clearCredential(draft.provider).then(status => props.onSaved(props.settings, status)).catch(reason => props.onError(messageOf(reason))) }}>Remove saved key</button></details>}
          </>}
        </section>
        <section className="settings-section"><div className="section-heading"><span className="step-number">3</span><h3>Choose your default model</h3></div><ModelField provider={draft.provider} model={draft.model} codex={props.codex} onChange={model => update({ model })} /><p className="help">{draft.provider === 'codex' ? 'Sign in first to load the models available to your account.' : 'Copy the exact model ID from your provider’s catalog.'} New bots start with this choice; each bot can use a different model in Bot settings.</p></section>
      </> : <>
        <div className="page-intro"><p className="eyebrow">ACROSS YOUR WHOLE APP</p><h2>Make Riot work your way.</h2><p>These preferences apply across your bots.</p></div>
        <section className="settings-section"><h3>Conversation display</h3><label className="check permission-option"><input type="checkbox" checked={props.preferences.showToolDetails} onChange={event => void props.api.updatePreferences({ showToolDetails: event.target.checked }).then(props.onPreferences).catch(reason => props.onError(messageOf(reason)))} /><span><strong>Show tool details by default</strong><small>Expand technical action logs in every chat. This preference saves immediately.</small></span></label></section>
        <section className="settings-section"><h3>App-wide spending ceiling</h3><OptionalMoney label="All bots, per day (USD)" value={draft.maxEstimatedSpendPerDayUsd} onChange={maxEstimatedSpendPerDayUsd => update({ maxEstimatedSpendPerDayUsd })} /><p className="help">Leave blank to turn this ceiling off. It covers API spending across all bots. Each API bot needs its model’s input and output prices in Bot settings → Limits for spending estimates. Codex account usage is managed separately.</p></section>
      </>}
    </fieldset>
    <footer className="settings-savebar"><div role="status" aria-live="polite">{error ? <p className="danger" role="alert">{error}</p> : <p className={note ? 'save-success' : 'help'}>{note || (changed ? 'You have unsaved app settings.' : 'Shared settings for Riot Bot')}</p>}</div><div className="row"><button type="button" disabled={saving} onClick={props.onDone}>{changed ? 'Discard changes' : 'Done'}</button><button className="send" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save app settings'}<Icon name="check" /></button></div></footer>
  </form>
}

function SettingsPane(props: {
  bot: Bot
  appSettings: AppSettings
  settings: PublicSettings
  credentials: CredentialStatus
  codex: CodexStatus | null
  onCodex: (status: CodexStatus) => void
  api: RiotBridge
  onSaved: (settings: PublicSettings, credentials: CredentialStatus) => void
  onAppSettings: () => void
  onProfile: () => void
  onError: (message: string) => void
  onDone: () => void
  onBusy: (busy: boolean) => void
}) {
  const [tab, setTab] = useState<'connection' | 'workspace' | 'limits' | 'advanced'>('connection')
  const [draft, setDraft] = useState(props.settings)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  const [saveError, setSaveError] = useState('')
  useEffect(() => setDraft(props.settings), [props.settings])
  const changed = JSON.stringify(draft) !== JSON.stringify(props.settings)
  useEffect(() => { if (draft.provider === 'codex') void props.api.getCodexStatus().then(props.onCodex).catch(reason => props.onError(messageOf(reason))) }, [props.api, draft.provider])
  function update(patch: Partial<PublicSettings>): void {
    setDraft(current => ({ ...current, ...patch }))
    setSavedNote('')
    setSaveError('')
  }
  function chooseModel(provider: PublicSettings['provider'], model: string): void {
    update({ provider, model, ...(provider !== draft.provider || model !== draft.model ? { modelContextTokens: null, inputUsdPerMillion: null, outputUsdPerMillion: null } : {}) })
  }
  async function save(): Promise<void> {
    if (saving) return
    setSaving(true)
    props.onBusy(true)
    setSavedNote('')
    setSaveError('')
    try {
      const next = await props.api.updateSettings(draft)
      props.onSaved(next, props.credentials)
      setDraft(next)
      setSavedNote(providerReady(next, props.credentials, props.codex) ? 'Saved. You’re ready to chat.' : 'Saved. Finish connecting your AI to start chatting.')
    } catch (reason) { setSaveError(messageOf(reason)) }
    finally { setSaving(false); props.onBusy(false) }
  }
  return <form className="settings-page" noValidate onSubmit={event => { event.preventDefault(); void save() }}>
    <nav className="settings-tabs" aria-label="Bot settings sections">
      <button type="button" disabled={saving} onClick={props.onProfile}>Profile & browser</button>
      {([['connection', 'Model'], ['workspace', 'Files & tools'], ['limits', 'Limits'], ['advanced', 'Advanced']] as const).map(([value, label]) => <button key={value} type="button" disabled={saving} aria-current={tab === value ? 'page' : undefined} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}
    </nav>
    <fieldset className="settings-content" disabled={saving}>
      {tab === 'connection' && <>
        <div className="page-intro"><p className="eyebrow">JUST FOR {props.bot.name.toUpperCase()}</p><h2>This bot’s model.</h2><p>Choose what powers {props.bot.name}. Other bots keep their own settings.</p></div>
        <section className="settings-section"><h3>Start with your app default</h3><p className="help">{props.appSettings.model ? `${providerName(props.appSettings.provider)} · ${props.appSettings.model}` : 'No app default has been chosen yet.'}</p><div className="row"><button type="button" disabled={!props.appSettings.model} onClick={() => chooseModel(props.appSettings.provider, props.appSettings.model)}>Use app default</button><button type="button" onClick={props.onAppSettings}>App settings</button></div><p className="help">Use app default copies that choice to this form. Save below to apply it to this bot.</p></section>
        <section className="settings-section"><h3>Or choose a model for this bot</h3>
          <ProviderPicker value={draft.provider} onChange={provider => chooseModel(provider, '')} />
          <ModelField provider={draft.provider} model={draft.model} codex={props.codex} onChange={model => chooseModel(draft.provider, model)} />
          <p className="help">{draft.provider === 'codex' ? props.codex?.connected ? 'Choose from the models available to your ChatGPT account.' : 'Connect your ChatGPT account in app Settings to load models.' : 'Copy the exact model ID from your provider’s catalog.'}</p>
        </section>
        <div className="callout"><strong>Connections are shared across the app</strong><p>{draft.provider === 'codex' ? props.codex?.connected ? 'Your ChatGPT account is connected.' : 'Your ChatGPT account needs to be connected.' : (draft.provider === 'openai' ? props.credentials.openaiConfigured : props.credentials.openrouterConfigured) ? `An API key for ${providerName(draft.provider)} is saved.` : `Add a ${providerName(draft.provider)} API key in app Settings.`}</p><button type="button" onClick={props.onAppSettings}>Manage connections in app Settings</button></div>
      </>}
      {tab === 'workspace' && <>
        <div className="page-intro"><h2>A place to get things done.</h2><p>Choose where your bot works and what it can do.</p></div>
        <section className="settings-section"><h3>Your bot’s working folder</h3><p className="help">Files your bot creates are kept here. Saved versions also appear in Files.</p>
          <label>Folder location<input value={draft.workspacePath} onChange={event => update({ workspacePath: event.target.value, workspaceEditing: false })} /></label>
          <div className="row"><button type="button" onClick={() => void props.api.pickWorkspace().then(folder => { if (folder) update({ workspacePath: folder, workspaceEditing: false }) }).catch(reason => props.onError(messageOf(reason)))}>Choose folder…</button><button type="button" onClick={() => void props.api.openWorkspace().catch(reason => props.onError(messageOf(reason)))}>Open saved folder</button></div>
          <label className="check permission-option"><input type="checkbox" checked={draft.workspaceEditing} onChange={event => update({ workspaceEditing: event.target.checked })} /><span><strong>Allow creating and editing files</strong><small>Enable this only for a folder you want this bot to work in. Changing folders turns this off until you enable it again.</small></span></label>
        </section>
        <section className="settings-section"><h3>Help beyond the conversation</h3>
          <label className="check permission-option"><input type="checkbox" checked={draft.toolsEnabled} onChange={event => update({ toolsEnabled: event.target.checked })} /><span><strong>Allow tools</strong><small>{draft.provider === 'codex' ? 'Use Codex’s shell and web search, plus Riot’s memory and file tools.' : 'Let your bot use available tools to search, work with files, and remember useful details.'}</small></span></label>
          <div className="callout"><strong>You stay in control</strong><p>{draft.provider === 'codex' ? 'Codex uses its own sandbox and approval rules. Safe reads can run automatically; requests needing approval appear in chat. Native reads can extend beyond this folder, and native edits do not have Riot’s Undo button.' : TERMINAL_WARNING}</p></div>
        </section>
      </>}
      {tab === 'limits' && <>
        <div className="page-intro"><h2>Set a comfortable pace.</h2><p>Limit how long a task can run. You can stop your bot at any time.</p></div>
        <section className="settings-section"><h3>Time per task</h3><NumberField label="Maximum minutes" value={Math.round(draft.maxTaskDurationMs / 60000)} onChange={value => update({ maxTaskDurationMs: value * 60 * 1000 })} /><p className="help">When time runs out, work pauses and partial results are kept.</p></section>
        {draft.provider === 'codex' ? <div className="callout"><strong>Uses your ChatGPT account limits</strong><p>Codex manages its own usage and context. Riot’s API dollar and token limits do not apply. The task timer and Stop still work.</p></div> : <section className="settings-section"><h3>Optional spending limits</h3><p className="help">Leave these blank to use time and call limits only. To estimate spending, Riot needs both token prices from your provider.</p>
          <div className="grid"><OptionalMoney label="Per task (USD)" value={draft.maxEstimatedSpendPerTaskUsd} onChange={value => update({ maxEstimatedSpendPerTaskUsd: value })} /><OptionalMoney label="This bot, per day (USD)" value={draft.botSpendPerDayUsd} onChange={value => update({ botSpendPerDayUsd: value })} /></div>
          <p className="help">The app-wide spending ceiling is managed in app Settings. This bot’s limit can make it tighter.</p>
          <h4>Model prices, per million tokens</h4><div className="grid"><OptionalMoney label="Input price (USD)" value={draft.inputUsdPerMillion} onChange={value => update({ inputUsdPerMillion: value })} /><OptionalMoney label="Output price (USD)" value={draft.outputUsdPerMillion} onChange={value => update({ outputUsdPerMillion: value })} /></div><p className="help">These are estimates. Your provider’s bill may differ.</p>
        </section>}
      </>}
      {tab === 'advanced' && <>
        <div className="page-intro"><p className="eyebrow">FOR WHEN YOU NEED MORE CONTROL</p><h2>The finer details.</h2><p>The defaults work for most tasks. Change these only when you have a specific reason.</p></div>
        {draft.provider !== 'codex' && <section className="settings-section"><h3>Replies</h3><label className="check"><input type="checkbox" checked={draft.streaming} onChange={event => update({ streaming: event.target.checked })} />Show replies as they’re written (streaming)</label></section>}
        {draft.provider !== 'codex' && <>
          <details className="settings-section advanced-details"><summary>Model limits & context</summary><div className="grid">
            <NumberField label="Model calls per task" value={draft.maxModelCallsPerTask} onChange={value => update({ maxModelCallsPerTask: value })} />
            <label>Reply allowance<select value={draft.replyMode} onChange={event => update({ replyMode: event.target.value === 'manual' ? 'manual' : 'automatic' })}><option value="automatic">Automatic</option><option value="manual">Manual cap</option></select></label>
            {draft.replyMode === 'manual' && <NumberField label="Reply chunk token limit" value={draft.maxOutputTokens} onChange={value => update({ maxOutputTokens: value })} />}
            <label>Context fitting<select value={draft.contextMode} onChange={event => update({ contextMode: event.target.value === 'manual' ? 'manual' : 'automatic' })}><option value="automatic">Automatic</option><option value="manual">Manual input budget</option></select></label>
            {draft.contextMode === 'manual' && <NumberField label="Manual input working budget" value={draft.contextTokenBudget} onChange={value => update({ contextTokenBudget: value })} />}
            <label>Model context capacity<input type="number" min="1024" step="1" placeholder="Use documented size" value={draft.modelContextTokens ?? ''} onChange={event => update({ modelContextTokens: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <NumberField label="Tool preview characters" value={draft.maxToolOutputChars} onChange={value => update({ maxToolOutputChars: value })} />
          </div><p className="help">Automatic mode manages older messages and reserves room for replies. If the provider does not publish a context capacity, a blank value uses a conservative 32,768-token fallback. Manual mode uses your input budget as the ceiling.</p></details>
          <details className="settings-section advanced-details"><summary>Web search settings</summary><label>Search URL template<input value={draft.searchUrlTemplate} onChange={event => update({ searchUrlTemplate: event.target.value })} /></label><p className="help">Use an HTTPS search address containing {'{query}'}. Browser search has no separate search fee; AI calls still use your normal budget.</p></details>
          <details className="settings-section advanced-details"><summary>Test your saved connection</summary><p className="help">Save settings first. The test preview explains the API calls before you run them.</p><ProviderCheck api={props.api} onError={props.onError} /></details>
        </>}
      </>}
    </fieldset>
    <footer className="settings-savebar">
      <div role="status" aria-live="polite">{saveError ? <p className="danger" role="alert">{saveError}</p> : <p className={savedNote ? 'save-success' : 'help'}>{savedNote || (changed ? 'You have unsaved changes.' : `Settings for ${props.bot.name}`)}</p>}</div>
      <div className="row"><button type="button" disabled={saving} onClick={props.onDone}>{changed ? 'Discard changes' : 'Back to chat'}</button><button type="submit" className="send" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}<Icon name="check" /></button></div>
    </footer>
  </form>
}

function CodexConnection({ api, status, onChange, onError }: { api: RiotBridge; status: CodexStatus | null; onChange: (status: CodexStatus) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  async function action(work: () => Promise<CodexStatus>): Promise<void> {
    setBusy(true)
    try { onChange(await work()) } catch (error) { onError(messageOf(error)) } finally { setBusy(false) }
  }
  useEffect(() => { void api.getCodexStatus().then(onChange).catch(error => onError(messageOf(error))) }, [api])
  return <div className="callout">
    <strong>{status?.connected ? 'Your ChatGPT account is connected' : status?.installed === false ? 'One-time Codex setup needed' : status?.loginPending ? 'Finish signing in in your browser' : 'Connect with your ChatGPT account'}</strong>
    <p>{status?.connected ? `${status.email ?? 'ChatGPT account'}${status.plan ? ` · ${status.plan}` : ''}` : status?.installed === false ? 'This connection needs the official Codex CLI installed on your computer. Install it, then restart Riot Bot. You can also choose an API connection above.' : 'A browser window will open for sign-in. Come back here when you’re done.'}</p>
    {status?.note && <p className="help" role="status">{status.note}</p>}
    {status?.limits.map((limit, index) => <p key={`${limit.name}-${index}`} className="help">{limit.name}: {limit.usedPercent}% used{limit.resetsAt ? ` · resets ${new Date(limit.resetsAt * 1000).toLocaleString()}` : ''}</p>)}
    <div className="row">
      {!status?.connected && !status?.loginPending && <button type="button" disabled={busy || status?.installed === false} onClick={() => void action(() => api.connectCodex())}>Sign in with ChatGPT</button>}
      {status?.loginPending && <button type="button" disabled={busy} onClick={() => void action(() => api.cancelCodexLogin())}>Cancel sign-in</button>}
      <button type="button" disabled={busy} onClick={() => void action(() => api.getCodexStatus())}>{busy ? 'Checking…' : 'Refresh connection'}</button>
    </div>
    <details className="subtle-details"><summary>About this connection</summary><p className="help">Sign-in and status checks do not start an AI task. Your account’s Codex usage limits apply when you send a message. Sign-in is shared by your Riot bots and kept separate from other apps. Listed models can still have account restrictions.</p>{status?.connected && <button type="button" disabled={busy} onClick={() => void action(() => api.disconnectCodex())}>Disconnect Codex</button>}</details>
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

export function SkillProposalCard(props: {
  proposal: SkillProposal
  api: RiotBridge
  onProposal: (proposal: SkillProposal | null) => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(props.proposal)
  useEffect(() => setDraft(props.proposal), [props.proposal])
  async function resolve(action: 'save' | 'dismiss'): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      await props.api.resolveSkillProposal(props.proposal.id, action, action === 'save' ? draft : undefined)
      props.onProposal(null)
    } finally {setSaving(false)}
  }
  return (
    <article className="skill-proposal" aria-label="Skill preview">
      <strong>{props.proposal.updateSkillId ? 'Update this skill?' : 'Save this skill?'}</strong>
      <strong className="skill-proposal-name">{draft.name}</strong>
      <p className="help">Preview for this bot. Choose Save skill to keep it.</p>
      <div className="skill-proposal-body">
      {editing ? (
        <SkillFields draft={draft} onChange={setDraft} />
      ) : (
        <>
          <p>{draft.description}</p>
          <details>
            <summary>View skill details</summary>
            <pre>{draft.procedure}</pre>
            {draft.pitfalls && <p>Pitfalls: {draft.pitfalls}</p>}
            {draft.verification && <p>Check: {draft.verification}</p>}
            <p className="help">A skill cannot grant permissions or raise a budget.</p>
          </details>
        </>
      )}
      </div>
      <div className="row skill-proposal-actions">
        <button type="button" className="send" disabled={saving} onClick={() => void resolve('save').catch((reason: unknown) => props.onError(messageOf(reason)))}>
          {saving ? 'Saving…' : 'Save skill'}
        </button>
        <button type="button" disabled={saving} onClick={() => setEditing((current) => !current)}>
          {editing ? 'Done editing' : 'Edit'}
        </button>
        <button type="button" disabled={saving} onClick={() => void resolve('dismiss').catch((reason: unknown) => props.onError(messageOf(reason)))}>
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
      <div className="page-intro"><h2>Teach it once. Reuse it next time.</h2><p>Skills are repeatable instructions for things you do often, like drafting a newsletter or reviewing a document.</p></div>
      {props.skills.filter((skill) => !skill.deletedAt).length === 0 && <EmptyState icon="spark" title="Keep your favorite ways of working">After working through a task in Chat, say “Save this workflow as a skill.” You’ll review it before it’s saved.</EmptyState>}
      <details className="subtle-details"><summary>How skills work</summary><p className="help">Your bot can load a saved procedure when it is useful. Skills cannot change permissions or spending limits. Imported skills start disabled; importing does not install or run code. Disabled or deleted skills stop being used in later requests.</p></details>
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
      <details className="card skill-editor">
        <summary>{editingId ? 'A skill is being edited above' : 'Create a skill manually'}</summary>
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
      </details>
      <details className="card skill-editor">
        <summary>Import a skill from text</summary>
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
      </details>
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
  if (screen === 'jobs') return 'Tasks'
  if (screen === 'library') return 'Files'
  if (screen === 'memory') return 'Memories'
  if (screen === 'skills') return 'Skills'
  if (screen === 'activity') return 'Usage & activity'
  if (screen === 'new-bot') return 'Create a bot'
  if (screen === 'bot-settings') return 'Bot settings'
  if (screen === 'earlier') return 'Earlier conversations'
  return 'App settings'
}

function screenDescription(screen: Screen): string {
  if (screen === 'jobs') return 'See what’s in progress, finished, or waiting for you.'
  if (screen === 'library') return 'The files your bot has made, all in one place.'
  if (screen === 'memory') return 'Useful things your bot remembers about you.'
  if (screen === 'skills') return 'Your favorite ways of working, ready to reuse.'
  if (screen === 'activity') return 'Keep an eye on usage and see what happened.'
  if (screen === 'new-bot') return 'A few details now. A helpful sidekick from here on.'
  if (screen === 'earlier') return 'Pick up a saved conversation from the past.'
  if (screen === 'bot-settings') return 'Model, personality, files, and tools for this bot.'
  return 'Shared connections, defaults, and preferences for Riot.'
}

function BotMenu(props: {
  api: RiotBridge
  bot: Bot
  running: boolean
  onDelete: () => void
  note: string
  onNote: (value: string) => void
  onError: (message: string) => void
  onBot: (bot: Bot) => void
  onEarlier: () => void
  onSettings: () => void
  onBusy: (busy: boolean) => void
}) {
  const [name, setName] = useState(props.bot.name)
  const [purpose, setPurpose] = useState(props.bot.purpose)
  const [instructions, setInstructions] = useState(props.bot.instructions)
  const [browser, setBrowser] = useState<BrowserView | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [browserBusy, setBrowserBusy] = useState(false)
  useEffect(() => {
    setName(props.bot.name)
    setPurpose(props.bot.purpose)
    setInstructions(props.bot.instructions)
  }, [props.bot])
  useEffect(() => { void props.api.getSnapshot().then(snapshot => setBrowser(snapshot.browser)).catch(reason => props.onError(messageOf(reason))) }, [props.api, props.bot.id])
  async function saveProfile(): Promise<void> {
    if (saving) return
    setSaving(true)
    props.onBusy(true)
    setSaved(false)
    try { props.onBot(await props.api.updateBot({ name, purpose, instructions })); setSaved(true) }
    catch (reason) { props.onError(messageOf(reason)) }
    finally { setSaving(false); props.onBusy(false) }
  }
  async function browserAction(action: () => Promise<string>): Promise<void> {
    if (browserBusy) return
    setBrowserBusy(true)
    try { props.onNote(await action()); setBrowser((await props.api.getSnapshot()).browser) }
    catch (reason) { props.onError(messageOf(reason)) }
    finally { setBrowserBusy(false) }
  }
  return <section className="bot-menu" id="bot-settings-panel" aria-label="Bot settings panel">
    <div className="page-intro"><h2>Make {props.bot.name} feel like yours.</h2><p>Give your bot a clear purpose and a personality that works for you.</p></div>
    <form className="settings-section" onSubmit={event => { event.preventDefault(); void saveProfile() }} onChange={() => setSaved(false)}>
      <label>Bot name<input disabled={saving} required minLength={2} maxLength={40} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>What it helps with<input disabled={saving} maxLength={400} value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
      <details className="subtle-details"><summary>Extra instructions <span>Optional</span></summary><p className="help">Tell your bot how you like things done. For example, “Keep answers short and ask if anything is unclear.”</p><label>Instructions<textarea disabled={saving} rows={4} maxLength={8000} value={instructions} onChange={event => setInstructions(event.target.value)} /></label></details>
      <div className="row"><button className="send" disabled={saving} type="submit">{saving ? 'Saving…' : 'Save profile'}</button>{saved && <p className="save-success" role="status">Profile saved.</p>}</div>
    </form>
    <details className="settings-section advanced-details"><summary>Icon & color</summary><p className="help">Changes here save straight away.</p>
      <div className="avatar-picker">{AVATAR_CHOICES.map(choice => <button key={choice.value} type="button" className="bot-chip" aria-label={`${choice.label} icon`} aria-pressed={props.bot.avatar.kind === 'builtin' && props.bot.avatar.value === choice.value} onClick={() => void props.api.setAvatar({ kind: 'builtin', value: choice.value, background: props.bot.avatar.background }).then(props.onBot).catch(reason => props.onError(messageOf(reason)))}><BotAvatar avatar={{ kind: 'builtin', value: choice.value, background: props.bot.avatar.background, imageUrl: null }} size={28} /></button>)}
        {AVATAR_EMOJIS.map(emoji => <button key={emoji} type="button" className="bot-chip" aria-label={`${emoji} icon`} aria-pressed={props.bot.avatar.kind === 'emoji' && props.bot.avatar.value === emoji} onClick={() => void props.api.setAvatar({ kind: 'emoji', value: emoji, background: props.bot.avatar.background }).then(props.onBot).catch(reason => props.onError(messageOf(reason)))}>{emoji}</button>)}
      </div><div className="row">{AVATAR_COLORS.map((color, index) => <button key={color} type="button" className="swatch" style={{ background: color }} aria-label={`${['Coral', 'Teal', 'Blue', 'Amber', 'Purple', 'Green'][index]} background`} aria-pressed={props.bot.avatar.background === color} onClick={() => {
        const avatar = props.bot.avatar
        if (avatar.kind === 'image') { props.onError('Choose an icon or emoji first to change its background.'); return }
        void props.api.setAvatar({ kind: avatar.kind, value: avatar.value, background: color }).then(props.onBot).catch(reason => props.onError(messageOf(reason)))
      }} />)}</div>
    </details>
    <section className="settings-section"><h3>Your bot’s space</h3><p className="folder-path">{props.bot.workspacePath || 'No folder chosen yet.'}</p><div className="row"><button type="button" onClick={() => void props.api.openWorkspace().catch(reason => props.onError(messageOf(reason)))}><Icon name="files" /> Open working folder</button><button type="button" disabled={saving} onClick={props.onSettings}>Model, files & limits</button><button type="button" disabled={saving} onClick={props.onEarlier}>Earlier conversations</button></div></section>
    <details className="settings-section advanced-details"><summary>Browser & website sign-ins</summary><p className="help">Your bot has a separate browser profile. Open its browser to sign in to a website yourself, then let your bot continue.</p>
      <p className="help">{browser?.installed ? `${browser.browserName || 'A browser'} is available.` : 'Install a browser to get started.'} {browser?.downloadNote}</p>
      <div className="row">{!browser?.open ? <button type="button" disabled={browserBusy || !browser?.installed} onClick={() => void browserAction(() => props.api.openBrowser())}>Open browser</button> : <>
        <button type="button" disabled={browserBusy} onClick={() => void browserAction(() => props.api.closeBrowser())}>Close browser</button>
        {browser.takeover ? <button type="button" disabled={browserBusy} onClick={() => void browserAction(() => props.api.resumeBrowser())}>Let bot continue</button> : <button type="button" disabled={browserBusy} onClick={() => void browserAction(() => props.api.takeoverBrowser())}>Use browser myself</button>}
      </>}{!browser?.installed && <button type="button" disabled={browserBusy || browser?.installing} onClick={() => void browserAction(() => props.api.installBrowser())}>{browser?.installing ? 'Installing…' : 'Install Chromium'}</button>}</div>
      {browser?.open && <p className="help">Open websites may keep making their own requests, even when your bot is idle.</p>}{props.note && <p className="help" role="status">{props.note}</p>}
    </details>
    <details className="settings-section advanced-details danger-zone"><summary>Delete this bot</summary><p className="help">Permanently remove this bot’s conversations, memories, skills, saved file copies, and browser profile. Your working folder stays.</p><button className="danger" type="button" disabled={props.running || saving} onClick={props.onDelete}>Delete bot…</button>{props.running && <p className="help">Stop this bot’s work before deleting it.</p>}</details>
  </section>
}

function DeleteBotDialog(props: {bot: Bot;onCancel: () => void;onDelete: (name: string) => Promise<void>}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [confirmation,setConfirmation] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close()},[])
  return <dialog ref={dialog} className="delete-bot-dialog" aria-labelledby="delete-bot-title" onCancel={(event)=>{event.preventDefault();if(!busy)props.onCancel()}}>
    <form onSubmit={(event)=>{event.preventDefault();if(busy||confirmation!==props.bot.name)return;setBusy(true);setError('');void props.onDelete(confirmation).catch((reason:unknown)=>{setError(messageOf(reason));setBusy(false)})}}>
      <h2 id="delete-bot-title">Delete {props.bot.name}?</h2>
      <p>This removes this bot’s chats, memories, skills, queued tasks, saved file copies, avatar and browser profile from Riot.</p>
      <p>Your project folder and shared provider sign-ins stay. Usage totals and Codex’s own managed session history remain.</p>
      <p className="help">Project folder: {props.bot.workspacePath || 'None'}</p>
      <label><span>Type <strong>{props.bot.name}</strong> to confirm</span><input autoFocus aria-label="Bot name to confirm deletion" value={confirmation} disabled={busy} onChange={(event)=>setConfirmation(event.target.value)} /></label>
      {error && <p className="delete-error" role="alert">{error}</p>}
      <div className="row"><button type="button" disabled={busy} onClick={props.onCancel}>Cancel</button><button type="submit" className="danger" disabled={busy||confirmation!==props.bot.name}>{busy ? 'Deleting…' : 'Delete Bot'}</button></div>
    </form>
  </dialog>
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

export function ModelField(props: {provider: PublicSettings['provider'];model: string;codex: CodexStatus | null;loading?: boolean;onChange: (model: string) => void}) {
  return <label>
    {props.provider === 'codex' ? 'Codex model' : 'Model ID'}
    {props.provider === 'codex' ? <select aria-label="Codex model" value={props.model} disabled={props.loading && !props.codex?.models.length} onChange={(event) => props.onChange(event.target.value)}>
      <option value="">{props.loading ? 'Loading Codex models…' : props.codex?.connected ? 'Choose an available model' : 'Connect Codex to load models'}</option>
      {props.model && !props.codex?.models.some(model => model.id === props.model) && <option value={props.model}>{props.model} · current choice</option>}
      {props.codex?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select> : <input aria-label="Model ID" value={props.model} placeholder="Paste the model ID from your provider" onChange={(event) => props.onChange(event.target.value)} />}
  </label>
}

export function NewBotForm(props: { settings: PublicSettings; api: RiotBridge; codex: CodexStatus | null; onCodex: (status: CodexStatus) => void; onCreate: (draft: BotDraft) => Promise<void>; onError: (message: string) => void; onCancel?: () => void; onBusy?: (busy: boolean) => void }) {
  const [purpose, setPurpose] = useState('')
  const [name, setName] = useState('My helper')
  const [provider, setProvider] = useState(props.settings.provider)
  const [model, setModel] = useState(props.settings.model)
  const [folder, setFolder] = useState('')
  const [avatarValue, setAvatarValue] = useState('spark')
  const [avatarKind, setAvatarKind] = useState<'builtin' | 'emoji' | 'image'>('builtin')
  const [background, setBackground] = useState(AVATAR_COLORS[0])
  const [bytes, setBytes] = useState<number[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [localError, setLocalError] = useState('')
  useEffect(() => {
    if (provider !== 'codex') return
    let current = true
    setLoadingModels(true)
    void props.api.getCodexStatus().then(status => { if (current) props.onCodex(status) }).catch((reason: unknown) => { if (current) props.onError(messageOf(reason)) }).finally(() => { if (current) setLoadingModels(false) })
    return () => { current = false }
  }, [props.api, props.onCodex, props.onError, provider])
  return <form className="new-bot-page" onSubmit={event => {
    event.preventDefault()
    if (busy || purpose.trim().length < 2) return
    setBusy(true)
    props.onBusy?.(true)
    setLocalError('')
    void props.onCreate({ purpose, name, provider, model, workspaceKind: folder ? 'existing' : 'suggested', workspacePath: folder, avatarKind, avatarValue, avatarBackground: background, avatarBytes: bytes })
      .catch((reason: unknown) => setLocalError(messageOf(reason))).finally(() => { setBusy(false); props.onBusy?.(false) })
  }}>
    <fieldset disabled={busy} className="new-bot-content">
      <div className="page-intro"><p className="eyebrow">A HELPER OF YOUR OWN</p><h2>What could you use a hand with?</h2><p>Give your bot a job. It gets its own conversation, memories, and files.</p></div>
      <div className="bot-templates" aria-label="Bot ideas">{[
        ['Everyday helper', 'Help me plan my day, answer questions, and get everyday tasks done.', 'spark'],
        ['Writing partner', 'Help me draft, edit, and improve my writing in a clear, natural voice.', 'files'],
        ['Research assistant', 'Help me research topics, compare options, and make sense of information.', 'memory']
      ].map(([title, description, icon]) => <button type="button" key={title} className={purpose === description ? 'selected' : ''} aria-pressed={purpose === description} onClick={() => { setPurpose(description); setName(title); setAvatarKind('builtin'); setBytes(undefined); setAvatarValue(icon === 'files' ? 'leaf' : icon === 'memory' ? 'moon' : 'spark') }}><Icon name={icon as IconName} /><strong>{title}</strong></button>)}</div>
      <section className="settings-section">
        <label>What should this bot help with?<textarea autoFocus required minLength={2} maxLength={400} value={purpose} rows={3} placeholder="For example: Help me write newsletters for my small business." onChange={event => setPurpose(event.target.value)} /></label>
        <label>Give it a name<input value={name} maxLength={40} placeholder="For example: Scout" onChange={event => setName(event.target.value)} /></label>
        <p className="help">Use any name you like. If you clear it, an API connection may use one short setup request to suggest one.</p>
      </section>
      <div className="inherit-note"><Icon name="check" /><div><strong>{model ? `Uses ${provider === props.settings.provider && model === props.settings.model ? 'app default' : 'custom connection'}: ${providerName(provider)}` : 'You can connect your AI after creating your bot'}</strong><p>{model ? model : 'Create it now, then we’ll guide you through setup.'}</p></div></div>
      <details className="settings-section advanced-details"><summary>Connection & model <span>Optional</span></summary><p className="help">Your app default is filled in. Change it only if you want this bot to use a different model. Shared sign-ins and API keys are managed in app Settings.</p>
        <ProviderPicker value={provider} onChange={value => { setProvider(value); setModel('') }} />
        <ModelField provider={provider} model={model} codex={props.codex} loading={loadingModels} onChange={setModel} />
      </details>
      <details className="settings-section advanced-details"><summary>Working folder <span>Automatic</span></summary><p className="help">We’ll create a new folder for this bot in RiotBot\workspaces. You can also choose an existing folder; editing starts off for existing files.</p><div className="row">
        <button type="button" onClick={() => void props.api.pickWorkspace().then(picked => { if (picked) setFolder(picked) }).catch(reason => props.onError(messageOf(reason)))}>Choose an existing folder…</button>{folder && <button type="button" onClick={() => setFolder('')}>Use a new folder instead</button>}
      </div>{folder && <p className="folder-path">{folder}</p>}</details>
      <details className="settings-section advanced-details"><summary>Icon & color <span>Make it yours</span></summary>
        <div className="avatar-picker">{AVATAR_CHOICES.map(choice => <button key={choice.value} type="button" aria-label={`${choice.label} icon`} aria-pressed={avatarKind === 'builtin' && avatarValue === choice.value} className={avatarKind === 'builtin' && avatarValue === choice.value ? 'bot-chip active' : 'bot-chip'} onClick={() => { setAvatarKind('builtin'); setAvatarValue(choice.value); setBytes(undefined) }}><BotAvatar avatar={{ kind: 'builtin', value: choice.value, background, imageUrl: null }} label={choice.label} /></button>)}
          {AVATAR_EMOJIS.map(emoji => <button key={emoji} type="button" aria-label={`${emoji} icon`} aria-pressed={avatarKind === 'emoji' && avatarValue === emoji} className={avatarKind === 'emoji' && avatarValue === emoji ? 'bot-chip active' : 'bot-chip'} onClick={() => { setAvatarKind('emoji'); setAvatarValue(emoji); setBytes(undefined) }}>{emoji}</button>)}
        </div>
        <div className="row">{AVATAR_COLORS.map((color, index) => <button key={color} type="button" className="swatch" style={{ background: color }} aria-label={`${['Coral', 'Teal', 'Blue', 'Amber', 'Purple', 'Green'][index]} background`} aria-pressed={background === color} onClick={() => setBackground(color)} />)}</div>
        <label>Or upload an image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => {
          const file = event.target.files?.[0]
          if (!file) return
          if (file.size > 8_000_000) { setLocalError('Choose an image smaller than 8 MB.'); return }
          void file.arrayBuffer().then(buffer => { setBytes([...new Uint8Array(buffer)]); setAvatarKind('image'); setLocalError('') }).catch(reason => setLocalError(messageOf(reason)))
        }} /></label>{bytes && <p className="help">Your uploaded image is selected.</p>}
      </details>
    </fieldset>
    <footer className="settings-savebar"><div role="status">{localError ? <p className="danger" role="alert">{localError}</p> : <p className="help">You can change all of this later.</p>}</div><div className="row">{props.onCancel && <button type="button" disabled={busy} onClick={props.onCancel}>Cancel</button>}<button className="send" type="submit" disabled={busy || purpose.trim().length < 2}>{busy ? 'Creating your bot…' : 'Create bot'}<Icon name="arrow" /></button></div></footer>
  </form>
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
