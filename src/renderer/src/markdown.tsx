import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ text, compact = false, onOpenLink }: { text: string; compact?: boolean; onOpenLink?: (url: string) => void }) {
  const components: Components = {
    a: ({ href, children }) => {
      if (href && /^https?:\/\//i.test(href) && onOpenLink) {
        return (
          <button type="button" className="linkish" onClick={() => onOpenLink(href)}>
            {children}
          </button>
        )
      }
      return <span className="linkish">{children}</span>
    },
    img: () => null,
    table: ({ children }) => (
      <div className="table-scroll">
        <table>{children}</table>
      </div>
    )
  }
  return (
    <div className={compact ? 'markdown compact' : 'markdown'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
