import { useEffect, useRef, useState } from 'react'
import type { BrowserInput, BrowserMonitor, RiotBridge } from '../../shared/types'
import { messageOf } from './ui'

const actionLabels: Record<string, string> = {
  open: 'Open page', back: 'Go back', read: 'Read page', snapshot: 'Inspect page controls',
  screenshot: 'Capture page', click: 'Click a control', fill: 'Fill a field', select: 'Select an option',
  key: 'Press a key', hover: 'Hover over a control', drag: 'Drag a control', upload: 'Upload a file',
  wait: 'Wait for the page', login: 'Use a saved login', scroll: 'Scroll the page', search: 'Search the web',
  tabs: 'List tabs', 'switch-tab': 'Switch tabs', 'close-tab': 'Close tab', settling: 'Waiting for the browser to settle'
}

export function BrowserPane({ api, botId, disabled }: { api: RiotBridge; botId: string; disabled: boolean }) {
  const [browser, setBrowser] = useState<BrowserMonitor | null>(null)
  const [busy, setBusy] = useState(false)
  const [address, setAddress] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const addressField = useRef<HTMLInputElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const pending = useRef(Promise.resolve())
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const next = await api.browserMonitor(botId, !document.hidden && !busy && !disabled)
        if (current) setBrowser(document.hidden ? { ...next, preview: null, frameId: null } : next)
      } catch (reason) {
        if (current) { setBrowser(null); setError(messageOf(reason)) }
      } finally {
        if (current) timer = setTimeout(() => void refresh(), 450)
      }
    }
    const hide = () => {
      if (document.hidden) setBrowser(value => value && { ...value, preview: null, frameId: null })
    }
    void refresh()
    document.addEventListener('visibilitychange', hide)
    return () => {
      current = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [api, botId, busy, disabled])

  async function act(action: () => Promise<string | void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try { await pending.current; setNotice((await action()) ?? '') }
    catch (reason) { setError(messageOf(reason)) }
    finally { setBusy(false) }
  }

  const controlsDisabled = busy || disabled || !browser
  const frameId = !controlsDisabled && browser?.takeover ? browser.frameId : null
  function sendInput(input: BrowserInput) {
    pending.current = pending.current.then(async () => {
      if (mounted.current) await api.browserInput(botId, input)
    }).catch(reason => { if (mounted.current) setError(messageOf(reason)) })
  }
  useEffect(() => {
    const element = viewport.current
    if (!frameId || !element) return
    const wheel = (event: WheelEvent) => {
      const position = pagePosition(element, event.clientX, event.clientY)
      if (!position) return
      event.preventDefault()
      const scale = event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? 600 : 1
      sendInput({ type: 'scroll', frameId, ...position, delta: Math.max(-960, Math.min(960, event.deltaY * scale)) })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [api, botId, frameId])
  const status = browser?.takeover ? 'You have control' : browser?.activeAction ? actionLabels[browser.activeAction] : browser?.open ? 'Browser ready' : 'Browser closed'
  return <div className="bot-menu browser-pane">
    <section className="settings-section" aria-label="Browser controls">
      <h3>{browser ? status : 'Checking browser…'}</h3>
      <div className="row">
        {browser?.open ? <>
          {browser.takeover
            ? <button type="button" disabled={controlsDisabled} onClick={() => void act(api.resumeBrowser)}>Let bot continue</button>
            : <button type="button" disabled={controlsDisabled || Boolean(browser.activeAction)} onClick={() => void act(api.takeoverBrowser)}>Take control</button>}
          <button type="button" disabled={controlsDisabled} onClick={() => void act(api.closeBrowser)}>Close browser</button>
        </> : browser?.installed
          ? <button type="button" disabled={controlsDisabled} onClick={() => void act(async () => {
            const result = await api.openBrowser()
            const opened = await api.browserMonitor(botId, false)
            return opened.open ? api.takeoverBrowser() : result
          })}>Open browser</button>
          : <button type="button" disabled={controlsDisabled || browser?.installing} onClick={() => void act(api.installBrowser)}>{browser?.installing ? 'Installing Chromium…' : 'Install Chromium'}</button>}
      </div>
      {!browser?.installed && browser && <p className="help">{browser.installing ? browser.progress : browser.downloadNote}</p>}
      {browser?.open && <>
        <form className="browser-address" onSubmit={event => {
          event.preventDefault()
          void act(async () => { await api.browserInput(botId, { type: 'navigate', address }); setAddress('') })
        }}>
          <button type="button" aria-label="Go back" disabled={controlsDisabled || !browser.takeover} onClick={() => void act(() => api.browserInput(botId, { type: 'back' }))}>Back</button>
          <input ref={addressField} aria-label="Website address" placeholder={browser.address || 'Enter a website address'} value={address} maxLength={2048} disabled={controlsDisabled || !browser.takeover} onChange={event => setAddress(event.target.value)} />
          <button type="submit" disabled={controlsDisabled || !browser.takeover || !address.trim()}>Go</button>
          {browser.tabs > 1 && <select aria-label="Browser tab" value={browser.activeTab} disabled={controlsDisabled || !browser.takeover} onChange={event => {
            const index = Number(event.target.value)
            void act(() => api.browserInput(botId, { type: 'tab', index }))
          }}>{Array.from({ length: browser.tabs }, (_, index) => <option key={index} value={index + 1}>Tab {index + 1}</option>)}</select>}
        </form>
        <div ref={viewport} className="browser-preview" tabIndex={frameId ? 0 : undefined} aria-label="Browser page" onClick={event => {
          const position = pagePosition(event.currentTarget, event.clientX, event.clientY)
          if (!frameId || !position) return
          event.currentTarget.focus()
          sendInput({ type: 'click', frameId, ...position })
        }} onKeyDown={event => {
          if (!frameId || event.nativeEvent.isComposing) return
          if (event.shiftKey && event.key === 'Escape') { event.preventDefault(); addressField.current?.focus(); return }
          if (event.ctrlKey && event.key.toLowerCase() === 'v') return
          const printable = [...event.key].length === 1
          if (!printable && !/^(Backspace|Delete|Enter|Escape|Tab|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(event.key)) return
          event.preventDefault()
          if (printable && !event.ctrlKey && !event.altKey && !event.metaKey) sendInput({ type: 'text', frameId, text: event.key })
          else {
            const key = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', event.key].filter(Boolean).join('+')
            sendInput({ type: 'key', frameId, key })
          }
        }} onPaste={event => {
          const value = event.clipboardData.getData('text/plain')
          if (!frameId || !value || value.length > 512) return
          event.preventDefault()
          sendInput({ type: 'text', frameId, text: value })
        }}>
          {browser.preview && !busy && !disabled && browser.activeAction !== 'login'
            ? <img src={browser.preview} alt="Active browser page" draggable={false} />
            : <p className="help">{browser.activeAction === 'login' ? 'View paused during saved sign-in.' : 'Loading browser view…'}</p>}
        </div>
        {browser.takeover && <p className="help">Click the page to use it. Shift+Esc returns focus to the address bar.</p>}
      </>}
      {error && <p role="alert">{error}</p>}
      {notice && <p className="help" role="status">{notice}</p>}
    </section>
    <section className="settings-section" aria-label="Recent browser steps">
      <h3>Recent browser steps</h3>
      {browser?.steps.length ? <ol className="browser-steps">{browser.steps.map(step => <li key={step.id}>
        <div><strong>{actionLabels[step.action] ?? 'Browser step'}{step.target ? ` · ${step.target}` : ''}</strong><span>{step.outcome === 'finished' ? 'Finished' : step.outcome}</span></div>
        {step.issues.length > 0 && <p className="help">{step.issues.join(' ')}</p>}
      </li>)}</ol> : <p className="help">Steps appear when your bot uses the browser.</p>}
    </section>
  </div>
}

function pagePosition(element: HTMLElement, clientX: number, clientY: number) {
  const image = element.querySelector('img')
  if (!image) return null
  const bounds = image.getBoundingClientRect()
  const x = (clientX - bounds.left) / bounds.width
  const y = (clientY - bounds.top) / bounds.height
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null
}
