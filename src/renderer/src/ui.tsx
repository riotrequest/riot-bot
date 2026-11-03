import type { ReactNode } from 'react'
import type { CodexStatus, ProviderId } from '../../shared/types'

export type IconName = 'chat' | 'tasks' | 'files' | 'memory' | 'spark' | 'settings' | 'activity' | 'plus' | 'arrow' | 'check' | 'attach' | 'image' | 'chevron' | 'back' | 'calendar' | 'more'

const paths: Record<IconName, string> = {
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  calendar: 'M4 5h16v16H4ZM4 10h16M8 3v4M16 3v4M8 14h3M8 17h6',
  chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2V11.5a10 10 0 0 1 20 0ZM7 9h8M7 13h5',
  tasks: 'M9 6h12M9 12h12M9 18h12M2 6l1 1 2-3M2 12l1 1 2-3M2 18l1 1 2-3',
  files: 'M3 6h6l2 2h10v12H3ZM3 6V4h7l2 2h7v2',
  memory: 'M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 4 4 0 0 0 6 5V4ZM15 4a3 3 0 0 1 5 3 4 4 0 0 1 1 7 4 4 0 0 1-6 5V4ZM5 10h4M15 10h4M6 16h3M15 16h3',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'm5 12 4 4L19 6',
  attach: 'm8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9',
  image: 'M3 3h18v18H3ZM3 16l5-5 5 5 3-3 5 5M15 7h.01',
  chevron: 'm9 5 7 7-7 7',
  back: 'M19 12H5M11 6l-6 6 6 6'
}

export function Icon({ name }: { name: IconName }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}

export const providerName = (provider: ProviderId): string => provider === 'codex' ? 'ChatGPT / Codex' : provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'

export function ModelBadge({ provider, model, models, onClick }: { provider: ProviderId; model: string; models?: CodexStatus['models']; onClick: () => void }) {
  const name = provider === 'codex' ? models?.find(item => item.id === model)?.name ?? model : model
  return <button type="button" className="model-badge" onClick={onClick} title={model ? `${providerName(provider)} · ${model} — change in Bot settings` : 'Choose this bot’s model'} aria-label={model ? `Current model: ${providerName(provider)} · ${name}. Open Bot settings` : 'No model selected. Open Bot settings'}><Icon name="spark" /><span>{model ? `${providerName(provider)} · ${name}` : 'Choose a model'}</span><Icon name="chevron" /></button>
}

export function ProviderPicker({ value, onChange }: { value: ProviderId; onChange: (provider: ProviderId) => void }) {
  return <fieldset className="provider-picker">
    <legend>How would you like to connect?</legend>
    {([
      ['codex', 'ChatGPT account', 'Sign in with ChatGPT. Uses Codex (preview).'],
      ['openrouter', 'OpenRouter', 'Use an API key. Billed by OpenRouter.'],
      ['openai', 'OpenAI API', 'Use an API key. Billed separately from ChatGPT.']
    ] as const).map(([id, title, description]) => <label className={`provider-option ${value === id ? 'selected' : ''}`} key={id}>
      <input type="radio" name="provider" value={id} checked={value === id} onChange={() => onChange(id)} />
      <span><strong>{title}</strong><small>{description}</small></span>
    </label>)}
  </fieldset>
}

const starters = [
  { icon: 'chat', title: 'Make a plan', description: 'Turn a big task into small steps', prompt: 'Help me make a practical plan. Ask me what I want to achieve, then break it into small, manageable steps.' },
  { icon: 'files', title: 'Write something', description: 'Find the right words, faster', prompt: 'Help me write something. Ask me who it is for and what I want it to say.' },
  { icon: 'spark', title: 'Explore an idea', description: 'Think it through together', prompt: 'I have an idea I want to explore. Ask me about it and help me think through the possibilities.' }
] as const

export function ChatWelcome({ name, purpose, configured, onConnect, onPrompt }: { name: string; purpose: string; configured: boolean; onConnect?: () => void; onPrompt: (prompt: string) => void }) {
  return <section className="chat-welcome" aria-labelledby="welcome-title">
    <div className="welcome-mark"><Icon name="spark" /></div>
    <p className="eyebrow">YOUR EVERYDAY SIDEKICK</p>
    <h2 id="welcome-title">What can we take off your plate?</h2>
    <p className="welcome-description">{purpose || `A question, a rough idea, a task you’ve been putting off. ${name} is here to help.`}</p>
    {!configured && <div className="setup-card">
      <span className="step-number">1</span>
      <div><strong>First, connect your AI</strong><p>Use your ChatGPT account or an API key. We’ll walk you through it.</p></div>
      <button type="button" className="send" onClick={onConnect}>Let’s set up <Icon name="arrow" /></button>
    </div>}
    <div className="starter-grid">{starters.map((starter) => <button className="starter-card" type="button" key={starter.title} onClick={() => onPrompt(starter.prompt)}>
      <Icon name={starter.icon} /><strong>{starter.title}</strong><span>{starter.description}</span><Icon name="arrow" />
    </button>)}</div>
    <p className="welcome-footnote">{configured ? 'Choose an idea above, or type your own message below.' : 'You can draft a message now. Nothing is sent until you’re connected and press Send.'}</p>
  </section>
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} /></span><h3>{title}</h3><p>{children}</p></div>
}

export function messageOf(reason: unknown, fallback = 'Something went wrong.'): string {
  if (!(reason instanceof Error)) return fallback
  return reason.message.replace(/^Error invoking remote method (?:'[^']+'|"[^"]+"):\s*(?:Error:\s*)?/, '').trim() || fallback
}
