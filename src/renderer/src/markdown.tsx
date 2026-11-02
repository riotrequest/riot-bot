import type { Components } from 'react-markdown'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const SourceBlock: Components['pre'] = ({ node, children }) => {
  const code = node?.children[0]
  const source = code?.type === 'element' && code.tagName === 'code' ? code.children.filter(child => child.type === 'text').map(child => child.value).join('') : ''
  const lines = source.trimEnd().split('\n').length
  const block = <pre>{children}</pre>
  return source.length > 1200 || lines > 16 ? <details className="source-code"><summary>View source · {lines} lines</summary>{block}</details> : block
}

export function Markdown({ text, compact = false, onOpenLink, onOpenFile }: { text: string; compact?: boolean; onOpenLink?: (url: string) => void; onOpenFile?: (path: string) => void }) {
  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith('workspace:') && onOpenFile) {
        let file: string
        try { file = decodeURIComponent(href.slice('workspace:'.length)) } catch { return <span>{children}</span> }
        return <button type="button" className="linkish" title="Show file in folder" onClick={() => onOpenFile(file)}>{children}</button>
      }
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
    pre: SourceBlock,
    table: ({ children }) => (
      <div className="table-scroll">
        <table>{children}</table>
      </div>
    )
  }
  return (
    <div className={compact ? 'markdown compact' : 'markdown'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={(url, key, node) => key === 'href' && node.tagName === 'a' && url.startsWith('workspace:') ? url : defaultUrlTransform(url)}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
