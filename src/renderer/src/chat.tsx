import { useLayoutEffect, useRef, useState } from 'react'
import type { AttachmentView, AvatarView, ChatMessageView, ConversationDetail, MessagePage, RiotBridge, RunStatus } from '../../shared/types'
import { actionStatus, copyMarkdown, fileChange, isLongForm, stickToBottom } from '../../core/progress'
import { BotAvatar } from './avatar'
import { Markdown } from './markdown'
import { messageOf } from './ui'

export function ChatTranscript(props: {
  detail: ConversationDetail
  running: boolean
  statusLabel: string
  showToolDetails: boolean
  avatar: AvatarView | null
  api: RiotBridge
  onUndo: (id: string) => void
  onError: (message: string) => void
  onOpenSettings?: () => void
  onOlderPage: (page: MessagePage) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [away, setAway] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const prepend = useRef<{ height: number; top: number } | null>(null)
  const turns = groupTurns(props.detail.messages)
  const last = props.detail.messages.at(-1)
  const tail = `${props.detail.messages.length}:${last?.content.length ?? 0}:${props.running}`

  useLayoutEffect(() => {
    const node = scroller.current
    if (prepend.current && node) {
      node.scrollTop = prepend.current.top + node.scrollHeight - prepend.current.height
      prepend.current = null
      return
    }
    if (!stick.current) return
    end.current?.scrollIntoView({ block: 'end' })
  }, [tail])

  async function loadOlder(): Promise<void> {
    const cursor = props.detail.olderMessagesCursor
    if (!cursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await props.api.loadOlderMessages(props.detail.conversation.id, cursor)
      const node = scroller.current
      if (node) prepend.current = { height: node.scrollHeight, top: node.scrollTop }
      stick.current = false
      setAway(true)
      props.onOlderPage(page)
    } catch (reason) {
      props.onError(messageOf(reason, 'Earlier messages could not be loaded.'))
    } finally {
      setLoadingOlder(false)
    }
  }

  function onScroll(): void {
    const node = scroller.current
    if (!node) return
    const near = stickToBottom(node)
    stick.current = near
    setAway(!near)
  }

  function jump(): void {
    stick.current = true
    setAway(false)
    end.current?.scrollIntoView({ block: 'end' })
  }

  return (
    <div className="transcript" ref={scroller} onScroll={onScroll} tabIndex={0} role="region" aria-label="Conversation">
      {props.detail.olderMessagesCursor && <button type="button" className="load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}</button>}
      {turns.map((turn, index) => (
        <TurnView
          key={turn.user?.id ?? turn.rest[0]?.id ?? index}
          turn={turn}
          latest={index === turns.length - 1}
          outcome={turnOutcome(turn, props.detail)}
          running={turnOutcome(turn, props.detail) === 'running'}
          statusLabel={props.statusLabel}
          showToolDetails={props.showToolDetails}
          avatar={props.avatar}
          api={props.api}
          onUndo={props.onUndo}
          onError={props.onError}
          onOpenSettings={props.onOpenSettings}
        />
      ))}
      {away && (
        <button type="button" className="jump" onClick={jump}>
          Jump to latest
        </button>
      )}
      <div ref={end} />
    </div>
  )
}

interface Turn {
  user: ChatMessageView | null
  rest: ChatMessageView[]
}

function turnOutcome(turn: Turn, detail: ConversationDetail): RunStatus | undefined {
  const messages = [turn.user, ...turn.rest].filter((message): message is ChatMessageView => message !== null)
  const runId = messages.find((message) => message.runId)?.runId
  if (runId && runId === detail.run?.id) return detail.run.status
  return messages.find((message) => message.runStatus)?.runStatus
}

function groupTurns(messages: ChatMessageView[]): Turn[] {
  const turns: Turn[] = []
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) {
      const turn: Turn = { user: message.role === 'user' ? message : null, rest: [] }
      if (message.role !== 'user') turn.rest.push(message)
      turns.push(turn)
    } else {
      turns[turns.length - 1].rest.push(message)
    }
  }
  return turns
}

function TurnView(props: {
  turn: Turn
  latest: boolean
  outcome: RunStatus | undefined
  running: boolean
  statusLabel: string
  showToolDetails: boolean
  avatar: AvatarView | null
  api: RiotBridge
  onUndo: (id: string) => void
  onError: (message: string) => void
  onOpenSettings?: () => void
}) {
  const prose = props.turn.rest.filter((message) => message.role === 'assistant' && message.content.trim())
  const tools = props.turn.rest.filter((message) => message.role === 'tool' && message.toolName !== 'react')
  const files = [...new Map(props.turn.rest.flatMap(message => {
    const change = fileChange(message.toolName, message.content)
    return change ? [[change.editId, message] as const] : []
  })).values()]
  const notices = props.turn.rest.filter((message) => message.role === 'notice')
  const status = props.running ? props.statusLabel || 'Working…' : props.outcome ? actionStatus(tools.length, props.outcome) : `${tools.length} recorded actions · outcome unavailable`
  const incomplete = props.outcome && props.outcome !== 'completed' && props.outcome !== 'running'
  const long = prose.some((message) => isLongForm(message.content))

  async function copy(): Promise<void> {
    try {
      await props.api.copyText(copyMarkdown(prose.map((message) => message.content)))
    } catch (reason) {
      props.onError(messageOf(reason, 'Could not copy that message.'))
    }
  }

  return (
    <>
      {props.turn.user && (
        <div className="bubble-wrap user">
          <article className="bubble user">
            <p>{props.turn.user.content}</p>
            <AttachmentList attachments={props.turn.user.attachments ?? []} />
          </article>
          <ReactionList message={props.turn.user} api={props.api} onError={props.onError} />
        </div>
      )}
      {(prose.length > 0 || tools.length > 0 || files.length > 0 || notices.length > 0 || (props.latest && props.running)) && (
        <div className="assistant-group">
          {props.avatar && <BotAvatar avatar={props.avatar} size={32} />}
          <div className="assistant-body">
            {props.running && <p className="status-line">{status}</p>}
            {prose.map((message) => (
              <article key={message.id} className={long ? 'bubble assistant document' : 'bubble assistant compact'}>
                <Markdown
                  text={message.content}
                  compact={!isLongForm(message.content)}
                  onOpenLink={(url) => {
                    void props.api.openExternal(url).catch((reason: unknown) => props.onError(messageOf(reason, 'That link could not be opened.')))
                  }}
                  onOpenFile={(path) => void props.api.revealWorkspaceFile(path).catch((reason: unknown) => props.onError(messageOf(reason, 'That file could not be shown.')))}
                />
                {incomplete && message.id === prose.at(-1)?.id && <p className="interrupted">{props.outcome === 'paused' ? 'Paused · partial reply' : props.outcome === 'failed' ? 'Failed · partial reply' : 'Interrupted · partial reply'}</p>}
              </article>
            ))}
            {files.length > 0 && <details className="file-changes" open={props.showToolDetails}><summary>{files.length === 1 ? '1 file change' : `${files.length} file changes`} · View files & undo</summary>{files.map((message) => {
              const change = fileChange(message.toolName, message.content)
              if (!change) return null
              return (
                <div key={message.id} className="file-change">
                  <p>{change.path ? <button type="button" className="linkish" title="Show file in folder" onClick={() => void props.api.revealWorkspaceFile(change.path!, change.editId).catch(reason => props.onError(messageOf(reason, 'That file could not be shown.')))}>{change.path}</button> : 'Saved file change'}</p>
                  <button type="button" onClick={() => props.onUndo(change.editId)}>
                    Undo this edit
                  </button>
                </div>
              )
            })}</details>}
            {notices.map((message) => (
              <div key={message.id} className={message.content.startsWith('Interrupted.') || message.content.includes('empty reply') ? 'banner warn' : 'notice'}>
                <p>{message.content}</p>
                {props.onOpenSettings && message.content.includes('Open Settings') && (
                  <button type="button" onClick={props.onOpenSettings}>
                    Open Settings
                  </button>
                )}
                {message.content.includes('Take over the browser') && <BrowserRecovery api={props.api} onError={props.onError} />}
              </div>
            ))}
            {!props.running && tools.length > 0 && (
              <details className="tool" open={props.showToolDetails}>
                <summary>{status}</summary>
                {tools.map((message) => (
                  <div key={message.id} className="tool-detail">
                    <strong>{message.toolName}</strong>
                    {message.toolStartedAt != null && (
                      <p className="help">
                        {new Date(message.toolStartedAt).toLocaleTimeString()}
                        {message.toolEndedAt != null ? ` – ${new Date(message.toolEndedAt).toLocaleTimeString()}` : ''}
                      </p>
                    )}
                    {message.toolError && <p className="warn-text">{message.toolError}</p>}
                    <pre>{message.content}</pre>
                  </div>
                ))}
              </details>
            )}
            {prose.length > 0 && (
              <button type="button" className="quiet" onClick={() => void copy()}>
                Copy
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function BrowserRecovery({ api, onError }: { api: RiotBridge; onError: (message: string) => void }) {
  const [note, setNote] = useState('')
  const act = (work: Promise<string>): void => {
    void work.then(setNote).catch((error: unknown) => onError(messageOf(error, 'The browser could not be updated.')))
  }
  return (
    <div>
      <div className="row">
        <button type="button" onClick={() => act(api.takeoverBrowser())}>Take over browser</button>
        <button type="button" onClick={() => act(api.resumeBrowser())}>Resume browser</button>
      </div>
      {note && <p role="status">{note}</p>}
    </div>
  )
}

export function AttachmentList({ attachments, onRemove }: { attachments: AttachmentView[]; onRemove?: (id: string) => void }) {
  if (!attachments.length) return null
  return <div className="attachments" aria-label={onRemove ? 'Draft attachments' : 'Message attachments'}>
    {attachments.map((item) => <div className="attachment" key={item.id}>
      {item.previewUrl && <img src={item.previewUrl} alt={`Preview of ${item.name}`} />}
      <div><strong>{item.name}</strong><span className="help">{item.kind === 'image' ? `${item.width} × ${item.height} · ` : 'Text · '}{Math.max(1, Math.ceil(item.size / 1000))} KB</span></div>
      {onRemove && <button type="button" className="quiet" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>Remove</button>}
    </div>)}
  </div>
}

function ReactionList(props: { message: ChatMessageView; api: RiotBridge; onError: (message: string) => void }) {
  const reactions = props.message.reactions ?? []
  if (reactions.length === 0) return null
  return (
    <div className="reactions">
      {reactions.map((reaction) => (
        <button
          key={reaction.id}
          type="button"
          className="reaction"
          aria-label={`${reaction.label}. Remove reaction`}
          onClick={() => {
            void props.api.removeReaction(reaction.id).catch((reason: unknown) => props.onError(messageOf(reason, 'Could not remove that reaction.')))
          }}
        >
          <span role="img" aria-label={reaction.label}>
            {reaction.emoji}
          </span>
        </button>
      ))}
    </div>
  )
}
