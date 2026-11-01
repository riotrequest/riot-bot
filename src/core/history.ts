import type { MessageRecord } from './db'

export function historyRoleLabel(role: string): string {
  if (role === 'user') return 'user statement'
  if (role === 'assistant') return 'assistant suggestion'
  if (role === 'tool') return 'tool result'
  return 'note'
}

export function formatHistoryMessage(message: MessageRecord): string {
  const when = new Date(message.createdAt).toISOString()
  return [`message ${message.id}`, historyRoleLabel(message.role), when, message.toolName ? `tool ${message.toolName}` : '']
    .filter(Boolean)
    .join(' | ')
    .concat(`\n${message.content}`)
}

export function formatHistoryList(messages: MessageRecord[], focusId: string): string {
  if (messages.length === 0) return 'That message is not in the saved transcript.'
  return [
    'Saved messages around the match. A user statement is not the same as an assistant suggestion. If these records do not establish the answer, say so.',
    ...messages.map((message) => `${message.id === focusId ? 'Match:' : 'Nearby:'}\n${formatHistoryMessage(message)}`)
  ].join('\n\n')
}
