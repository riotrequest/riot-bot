import type { SkillProposal } from '../shared/types'
import { looksLikeSecret } from './redact'

export interface SkillDraft {
  name: string
  description: string
  procedure: string
  pitfalls: string
  verification: string
  updateSkillId?: string | null
}

export function explicitSkillIntent(text: string): 'save' | 'update' | null {
  const trimmed = text.trim()
  if (/\bupdate\b[\s\S]{0,80}\bskill\b/i.test(trimmed)) return 'update'
  if (/\b(save|store|keep)\b[\s\S]{0,80}\b(workflow|procedure|skill)\b/i.test(trimmed)) return 'save'
  return null
}

export function skillRejection(draft: SkillDraft, secrets: string[] = []): string | null {
  const name = draft.name.trim()
  const description = draft.description.trim()
  const procedure = draft.procedure.trim()
  if (name.length < 2 || name.length > 80) return 'A skill needs a short name.'
  if (description.length < 2 || description.length > 300) return 'Describe when to use the skill in a sentence or two.'
  if (procedure.length < 2 || procedure.length > 8000) return 'The procedure needs to stay under 8000 characters.'
  if (draft.pitfalls.trim().length > 4000 || draft.verification.trim().length > 4000) return 'Pitfalls and verification need to stay under 4000 characters.'
  const blob = `${name}\n${description}\n${procedure}\n${draft.pitfalls}\n${draft.verification}`
  if (looksLikeSecret(blob, secrets)) return 'That skill text matches a common secret pattern, so it was not saved. This check does not catch every secret.'
  return null
}

export function skillToMarkdown(skill: SkillDraft): string {
  return [
    '---',
    `name: ${oneLine(skill.name)}`,
    `description: ${oneLine(skill.description)}`,
    '---',
    '',
    '## Procedure',
    skill.procedure.trim(),
    '',
    '## Pitfalls',
    skill.pitfalls.trim() || 'None noted.',
    '',
    '## Verification',
    skill.verification.trim() || 'None noted.',
    ''
  ].join('\n')
}

export function parseSkillMarkdown(source: string): { draft: SkillDraft } | { error: string } {
  const text = source.replace(/^\uFEFF/, '').trim()
  if (!text) return { error: 'Paste a skill first.' }
  if (text.length > 20_000) return { error: 'That skill file is too large.' }
  const fenced = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!fenced) return { error: 'A skill file needs a name and description between --- lines, then Procedure, Pitfalls, and Verification sections.' }
  const fields = parseFields(fenced[1])
  const name = fields.name?.trim() ?? ''
  const description = fields.description?.trim() ?? ''
  const body = fenced[2]
  const procedure = section(body, 'Procedure')
  const pitfalls = section(body, 'Pitfalls')
  const verification = section(body, 'Verification')
  if (!name || !description || !procedure) return { error: 'The skill file needs a name, a description, and a Procedure section.' }
  const draft: SkillDraft = {
    name,
    description,
    procedure,
    pitfalls: pitfalls === 'None noted.' ? '' : pitfalls,
    verification: verification === 'None noted.' ? '' : verification
  }
  const reason = skillRejection(draft)
  if (reason) return { error: reason }
  return { draft }
}

export function proposalFromDraft(id: string, draft: SkillDraft, conversationId: string | null, botId = ''): SkillProposal {
  return {
    id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    procedure: draft.procedure.trim(),
    pitfalls: draft.pitfalls.trim(),
    verification: draft.verification.trim(),
    updateSkillId: draft.updateSkillId ?? null,
    conversationId,
    botId
  }
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseFields(block: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z]+):\s*(.*)$/)
    if (match) fields[match[1].toLowerCase()] = match[2]
  }
  return fields
}

function section(body: string, title: string): string {
  const pattern = new RegExp(`^##\\s+${title}\\s*$`, 'im')
  const match = pattern.exec(body)
  if (!match) return ''
  const start = match.index + match[0].length
  const rest = body.slice(start)
  const next = rest.search(/^##\s+/m)
  return (next >= 0 ? rest.slice(0, next) : rest).trim()
}
