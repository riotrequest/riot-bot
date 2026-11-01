import type { AvatarView } from '../../shared/types'

export function BotAvatar({ avatar, label, size = 28 }: { avatar: AvatarView; label?: string; size?: number }) {
  const style = { width: size, height: size, background: avatar.background }
  if (avatar.kind === 'image' && avatar.imageUrl) {
    return <img className="avatar" style={style} src={avatar.imageUrl} alt={label ? `${label} avatar` : ''} />
  }
  if (avatar.kind === 'emoji') {
    return (
      <span className="avatar emoji" style={style} role="img" aria-label={label ? `${label} avatar` : 'Bot avatar'}>
        {avatar.value}
      </span>
    )
  }
  return (
    <span className="avatar builtin" style={style} role="img" aria-label={label ? `${label} avatar` : 'Bot avatar'}>
      <BuiltinMark id={avatar.value} />
    </span>
  )
}

function BuiltinMark({ id }: { id: string }) {
  if (id === 'leaf') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c8-1 12-8 13-14-6 1-12 5-13 14z" /></svg>
  if (id === 'moon') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3a8 8 0 1 0 6 13 9 9 0 1 1-6-13z" /></svg>
  if (id === 'bolt') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 10-14h-7z" /></svg>
  if (id === 'wave') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2" /></svg>
  if (id === 'star') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.2 6.2H21l-5.2 3.8 2 6.2L12 16.2 6.2 19.2l2-6.2L3 9.2h6.8z" /></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 14 10l7 2-7 2-2 7-2-7-7-2 7-2z" /></svg>
}

export const AVATAR_CHOICES = [
  { kind: 'builtin' as const, value: 'spark', label: 'Spark' },
  { kind: 'builtin' as const, value: 'leaf', label: 'Leaf' },
  { kind: 'builtin' as const, value: 'moon', label: 'Moon' },
  { kind: 'builtin' as const, value: 'bolt', label: 'Bolt' },
  { kind: 'builtin' as const, value: 'wave', label: 'Wave' },
  { kind: 'builtin' as const, value: 'star', label: 'Star' }
]

export const AVATAR_EMOJIS = ['🤖', '🌿', '🌙', '⚡', '🌊', '⭐']
export const AVATAR_COLORS = ['#d4544a', '#2f6f62', '#3a5f8a', '#8a5a32', '#6b4c7a', '#3f6b4a']
