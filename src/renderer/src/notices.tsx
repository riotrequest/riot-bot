import { useEffect, useRef, useState } from 'react'
import type { AppNotice, NoticeBridge } from '../../shared/types'

export function NoticeStack({ notices, onDismiss, onOpen, floating = false }: {
  notices: AppNotice[]
  onDismiss: (id: string) => void
  onOpen: (notice: AppNotice) => void
  floating?: boolean
}) {
  if (!notices.length) return null
  return (
    <section className={floating ? 'notice-stack floating' : 'notice-stack'} aria-label="Notifications" aria-live="polite">
      {notices.map((notice) => (
        <article className="notice-card" key={notice.id}>
          <p className="eyebrow">{notice.kind === 'reminder' ? 'REMINDER' : 'RIOT'}</p>
          <h2>{notice.title}</h2>
          <p className="notice-body">{notice.body}</p>
          <div className="row">
            <button type="button" className="notice-open" onClick={() => onOpen(notice)}>{notice.kind === 'reminder' ? 'View schedule' : 'Open'}</button>
            <button type="button" onClick={() => onDismiss(notice.id)}>Dismiss</button>
          </div>
        </article>
      ))}
    </section>
  )
}

export function NoticePopup({ api }: { api: NoticeBridge }) {
  const [notices, setNotices] = useState<AppNotice[]>([])
  const frame = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    document.documentElement.classList.add('notice-host')
    document.body.classList.add('notice-host')
    const stop = api.onChange(setNotices)
    return () => {
      stop()
      document.documentElement.classList.remove('notice-host')
      document.body.classList.remove('notice-host')
    }
  }, [api])
  useEffect(() => {
    const content = body.current
    const popup = frame.current
    if (!content || !popup) return
    const report = (): void => {
      const style = getComputedStyle(popup)
      const pad = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
      api.resize(Math.ceil(content.getBoundingClientRect().height + pad))
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(content)
    return () => observer.disconnect()
  }, [api, notices])
  return (
    <div className="notice-popup" ref={frame}>
      <div className="notice-popup-body" ref={body}>
        <NoticeStack floating notices={notices} onDismiss={api.dismiss} onOpen={(notice) => api.open(notice.id)} />
      </div>
    </div>
  )
}
