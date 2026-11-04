import type { EmailPreview, GmailRulePreview, GmailRuleView } from '../shared/types'
import { gmailId, mailAddresses } from './gmail-message'

export interface GmailAutonomyRule {
  id: string
  botId: string
  account: string
  enabled: boolean
  revision: number
  title: string
  recipients: string[]
  threadIds: string[]
  templates: string[]
  excludedRecipients: string[]
  excludedPhrases: string[]
  dailySendLimit: number
  updatedAt: number
}

/** Shown on every preview. Keyword checks only force review; they never prove a reply is safe. */
export const REPLY_RULE_LIMITS = 'Riot still asks before new emails, recipients who were not already in that conversation, Cc, Bcc, attachments, refunds and other money wording in the original message or the reply, wording that is not one of the exact saved replies, and anything a saved exclusion covers. A reply whose original message cannot be read completely waits for review. These word checks do not prove a reply is safe. One rule cannot override another rule’s exclusion. This does not allow forwarding, mailbox cleanup, terminal commands, or another bot to send.'

export const GMAIL_RULE_APPLIED = 'Riot already applied this Gmail reply instruction.'

export interface GmailRuleDraft {
  title: string
  account: string
  recipients: string[]
  threadIds: string[]
  templates: string[]
  excludedRecipients: string[]
  excludedPhrases: string[]
  dailySendLimit: number
}

/** Original message checked with the outgoing draft. Unverified means review, never an automatic send. */
export interface GmailReplyContext {
  verified: boolean
  participants: string[]
  subject: string
  body: string
}

export interface GmailSendFacts {
  botId: string
  account: string
  gmailAccess: 'off' | 'drafts' | 'send'
  toolsEnabled: boolean
  preview: EmailPreview
  threadId: string | null
  hasAttachments: boolean
  reply: GmailReplyContext | null
}

export interface GmailSendDecision {
  action: 'allow' | 'ask' | 'deny'
  reason: string
  ruleId: string | null
  revision: number | null
  limit: number | null
}

type Ruled = GmailAutonomyRule & { sendsToday: number }

export function normalizeReplyBody(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim()
}

/** Escalates money language to review. Absence of a match is not approval. */
export function financialCommitment(body: string): boolean {
  return /(?:\b(?:refund(?:s|ed|ing)?|reimburse(?:ment|s|d)?|chargebacks?|invoices?|payments?|payouts?)\b|\bpay\s+(?:you|them|him|her|us|me|the)\b|\$\s?\d|\b\d[\d,]*(?:\.\d{2})?\s?(?:usd|dollars|eur|euros|gbp|pounds)\b)/i.test(body)
}

export function parseGmailRuleInput(value: unknown, fallbackAccount = ''): { draft: GmailRuleDraft; problems: string[] } {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const problems: string[] = []
  const title = String(input.title ?? 'Reply rule').replace(/[\r\n]/g, ' ').trim().slice(0, 80)
  if (title.length < 2) problems.push('Name this reply rule.')
  let account = ''
  const statedAccount = typeof input.account === 'string' && input.account.trim() ? input.account : fallbackAccount
  if (!statedAccount.trim()) problems.push('Name the connected mailbox. Riot will not guess it.')
  else {
    try { account = mailAddresses(statedAccount)[0] ?? '' } catch { problems.push('The mailbox must be one plain email address.') }
    if (!account) problems.push('Name the connected mailbox. Riot will not guess it.')
  }
  const recipients = addressList(input.recipients ?? input.to, 'Recipients', problems)
  const excludedRecipients = addressList(input.excludedRecipients ?? input.excluded_recipients ?? input.exclude, 'Excluded recipients', problems)
  const threadIds = conversationIds(input.threadIds ?? input.threads, problems)
  const templates = replyTemplates(input.templates ?? input.template, problems)
  const excludedPhrases = reviewPhrases(input.excludedPhrases ?? input.excluded_phrases ?? input.phrase, problems)
  const requestedLimit = input.dailySendLimit ?? input.daily_send_limit ?? input.limit
  const dailySendLimit = wholeLimit(requestedLimit)
  if (requestedLimit != null && requestedLimit !== '' && dailySendLimit == null) problems.push('The daily send limit must be a whole number from 1 to 20.')
  if (recipients.some(address => excludedRecipients.includes(address))) problems.push('A recipient cannot also be excluded.')
  for (const template of templates) {
    if (excludedPhrases.some(phrase => template.toLowerCase().includes(phrase.toLowerCase()))) problems.push('An exact reply contains wording this rule also holds for review.')
  }
  return {
    draft: { title: title || 'Reply rule', account, recipients, threadIds, templates, excludedRecipients, excludedPhrases, dailySendLimit: dailySendLimit ?? 5 },
    problems
  }
}

export function enablementProblems(draft: GmailRuleDraft): string[] {
  const problems: string[] = []
  if (!draft.account) problems.push('Name the connected mailbox. Riot will not guess it.')
  if (!draft.recipients.length) problems.push('Add the exact recipient addresses. Riot will not guess names such as RLH.')
  if (!draft.templates.length) problems.push('Add the exact reply text. Free-form replies are not sent on their own.')
  if (draft.templates.some(financialCommitment)) problems.push('A reply that promises a refund or payment cannot be sent on its own.')
  if (draft.recipients.some(address => draft.excludedRecipients.includes(address))) problems.push('A recipient cannot also be excluded.')
  for (const template of draft.templates) {
    if (draft.excludedPhrases.some(phrase => template.toLowerCase().includes(phrase.toLowerCase()))) problems.push('An exact reply contains wording this rule also holds for review.')
  }
  return problems
}

export function sameGmailRule(rule: GmailAutonomyRule, draft: GmailRuleDraft): boolean {
  const fold = (values: string[]): string => values.map(value => value.toLowerCase()).sort().join('\n')
  return rule.account === draft.account
    && rule.title === draft.title
    && fold(rule.recipients) === fold(draft.recipients)
    && rule.threadIds.join('\n') === draft.threadIds.join('\n')
    && rule.templates.map(normalizeReplyBody).join('\n---\n') === draft.templates.map(normalizeReplyBody).join('\n---\n')
    && fold(rule.excludedRecipients) === fold(draft.excludedRecipients)
    && fold(rule.excludedPhrases) === fold(draft.excludedPhrases)
    && rule.dailySendLimit === draft.dailySendLimit
}

export function draftFromRule(rule: GmailAutonomyRule): GmailRuleDraft {
  return { title: rule.title, account: rule.account, recipients: [...rule.recipients], threadIds: [...rule.threadIds], templates: rule.templates.map(normalizeReplyBody), excludedRecipients: [...rule.excludedRecipients], excludedPhrases: [...rule.excludedPhrases], dailySendLimit: rule.dailySendLimit }
}

export function gmailRulePreview(rule: Pick<GmailAutonomyRule, 'id' | 'revision' | 'title' | 'account' | 'recipients' | 'threadIds' | 'templates' | 'excludedRecipients' | 'excludedPhrases' | 'dailySendLimit'>): GmailRulePreview {
  return {
    id: rule.id,
    revision: rule.revision,
    title: rule.title,
    account: rule.account,
    recipients: rule.recipients,
    threadIds: rule.threadIds,
    templates: rule.templates,
    excludedRecipients: rule.excludedRecipients,
    excludedPhrases: rule.excludedPhrases,
    dailySendLimit: rule.dailySendLimit,
    limits: REPLY_RULE_LIMITS
  }
}

export function decideGmailSend(facts: GmailSendFacts, rules: Ruled[]): GmailSendDecision {
  if (!facts.toolsEnabled || facts.gmailAccess !== 'send') return decision('deny', 'Sending is off for this bot.')
  if (!facts.account || facts.preview.from !== facts.account) return decision('deny', 'This draft is not from this bot’s connected mailbox.')
  const body = normalizeReplyBody(facts.preview.body)
  const active = rules.filter(rule => rule.enabled && rule.botId === facts.botId && rule.account === facts.account)
  const structural = structuralReview(facts, body)
  if (structural) return decision('ask', structural)
  const excludes = active.filter(rule => ruleExcludes(rule, facts, body))
  if (excludes.length) {
    const allowed = active.filter(rule => ruleAllows(rule, facts, body))
    const conflict = allowed.some(rule => excludes.every(item => item.id !== rule.id))
    return decision('ask', conflict
      ? 'A saved exclusion conflicts with another reply rule, so this email needs review.'
      : 'A saved reply rule excludes this recipient or wording, so this email needs review.')
  }
  const matches = active.filter(rule => ruleAllows(rule, facts, body))
  if (!matches.length) return decision('ask', 'No saved reply rule covers this email. Review is required.')
  const open = matches.filter(rule => rule.sendsToday < rule.dailySendLimit).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  if (!open.length) return decision('ask', `“${matches[0].title}” reached its limit of ${matches[0].dailySendLimit} automatic sends today. Review is required until tomorrow.`)
  const chosen = open[0]
  return { action: 'allow', reason: `Matched reply rule “${chosen.title}” revision ${chosen.revision}.`, ruleId: chosen.id, revision: chosen.revision, limit: chosen.dailySendLimit }
}

/** Direct user text only. Callers must not pass email, tool output, or scheduled instructions. */
export function directGmailAutonomy(text: string): { action: 'stop' } | { action: 'propose'; draft: GmailRuleDraft; problems: string[] } | null {
  if (text.includes(GMAIL_RULE_APPLIED) || /```|^\s*>/m.test(text)) return null
  const trimmed = text.trim()
  if (isStopCommand(trimmed)) return { action: 'stop' }
  if (!/^enable automatic gmail replies\s*:/i.test(trimmed) || trimmed.length > 12_000) return null
  const split = trimmed.search(/^template\s*:/im)
  const header = split >= 0 ? trimmed.slice(0, split) : trimmed
  const template = split >= 0 ? trimmed.slice(split).replace(/^template\s*:\s*/i, '').trim() : ''
  const unquoted = /^["'][\s\S]*["']$/.test(template) ? template.slice(1, -1) : template
  const parsed = parseGmailRuleInput({
    title: lineValue(header, 'title') || 'Reply rule',
    account: lineValue(header, 'mailbox') || lineValue(header, 'account') || '',
    recipients: lineValue(header, 'to') || '',
    threads: lineValue(header, 'threads') || '',
    exclude: lineValue(header, 'exclude') || '',
    phrase: [...header.matchAll(/^phrase\s*:\s*(.+)$/gim)].map(match => match[1].trim()),
    limit: lineValue(header, 'limit') || '',
    template: unquoted
  })
  return { action: 'propose', ...parsed }
}

export function describeGmailRule(rule: GmailRuleView): string {
  const who = rule.recipients.length ? rule.recipients.join(', ') : 'no recipients yet'
  const conversations = rule.threadIds.length ? `only conversations ${rule.threadIds.join(', ')}` : 'an existing conversation'
  const replies = rule.templates.length ? rule.templates.map(template => `“${template.slice(0, 140)}${template.length > 140 ? '…' : ''}”`).join(' or ') : 'no exact reply yet'
  const excluded = [...rule.excludedRecipients, ...rule.excludedPhrases]
  return `${rule.title} can send ${replies} to ${who} in ${conversations}. ${excluded.length ? `Always review: ${excluded.join(', ')}. ` : ''}Up to ${rule.dailySendLimit} sends a day. ${REPLY_RULE_LIMITS}`
}

function decision(action: 'ask' | 'deny', reason: string): GmailSendDecision {
  return { action, reason, ruleId: null, revision: null, limit: null }
}

function reviewedText(facts: GmailSendFacts, body: string): string {
  const source = facts.reply?.verified ? `${facts.reply.subject}\n${facts.reply.body}` : ''
  return `${facts.preview.subject}\n${body}\n${source}`
}

function structuralReview(facts: GmailSendFacts, body: string): string | null {
  if (!facts.threadId) return 'New emails are not covered by reply rules. Review is required.'
  if (facts.preview.cc.length || facts.preview.bcc.length) return 'Cc and Bcc always need review.'
  if (facts.hasAttachments) return 'Attachments always need review.'
  if (!facts.preview.to.length) return 'This email has no recipient. Review is required.'
  const reply = facts.reply
  if (!reply?.verified) return 'The original conversation could not be verified, so this reply needs review.'
  if (facts.preview.to.some(address => !reply.participants.includes(address))) return 'This reply adds or redirects a recipient who was not in the original conversation. Review is required.'
  if (financialCommitment(reviewedText(facts, body))) return 'Refunds and other money commitments need review.'
  return null
}

function ruleExcludes(rule: GmailAutonomyRule, facts: GmailSendFacts, body: string): boolean {
  const addresses = [...facts.preview.to, ...facts.preview.cc, ...facts.preview.bcc, ...(facts.reply?.verified ? facts.reply.participants : [])]
  if (addresses.some(address => rule.excludedRecipients.includes(address))) return true
  const text = reviewedText(facts, body).toLowerCase()
  return rule.excludedPhrases.some(phrase => phrase.length >= 2 && text.includes(phrase.toLowerCase()))
}

function ruleAllows(rule: GmailAutonomyRule, facts: GmailSendFacts, body: string): boolean {
  if (!rule.recipients.length || !rule.templates.length || !facts.preview.to.length) return false
  if (facts.preview.to.some(address => !rule.recipients.includes(address))) return false
  if (rule.threadIds.length && (!facts.threadId || !rule.threadIds.includes(facts.threadId))) return false
  return rule.templates.some(template => normalizeReplyBody(template) === body)
}

function addressList(value: unknown, label: string, problems: string[]): string[] {
  const raw = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join(',') : typeof value === 'string' ? value : ''
  if (!raw.trim()) return []
  try { return mailAddresses(raw) } catch { problems.push(`${label} must be plain email addresses, separated by commas.`); return [] }
}

function conversationIds(value: unknown, problems: string[]): string[] {
  const raw = Array.isArray(value) ? value.map(item => String(item)) : typeof value === 'string' ? value.split(/[,\s]+/) : []
  const ids = raw.map(item => item.trim()).filter(Boolean)
  if (!ids.length) return []
  if (ids.length > 20) { problems.push('Use at most 20 conversations.'); return [] }
  try { return [...new Set(ids.map(gmailId))] } catch { problems.push('Conversation IDs must come from Gmail, without spaces or names.'); return [] }
}

function replyTemplates(value: unknown, problems: string[]): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const texts = [...new Set(list.filter((item): item is string => typeof item === 'string').map(normalizeReplyBody).filter(Boolean))]
  if (texts.length > 5) problems.push('Use at most 5 exact replies.')
  for (const text of texts) {
    if (text.length > 4000) problems.push('Each exact reply must be under 4,000 characters.')
    if (financialCommitment(text)) problems.push('A reply that promises a refund or payment cannot be sent on its own.')
  }
  return texts.slice(0, 5)
}

function reviewPhrases(value: unknown, problems: string[]): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split('|') : []
  const raw = list.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  if (raw.some(item => item.length < 2 || item.length > 200)) {
    problems.push('Review phrases must be 2 to 200 characters. Riot will not drop a phrase and save a broader rule.')
    return []
  }
  const phrases = [...new Set(raw)]
  if (phrases.length > 10) {
    problems.push('Use at most 10 extra review phrases. Riot will not drop the extras and save a broader rule.')
    return []
  }
  return phrases
}

function wholeLimit(value: unknown): number | null {
  if (value == null || value === '') return 5
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number >= 1 && number <= 20 ? number : null
}

function lineValue(header: string, name: string): string {
  return header.match(new RegExp(`^${name}\\s*:\\s*(.*)$`, 'im'))?.[1]?.trim() ?? ''
}

function isStopCommand(text: string): boolean {
  if (text.length > 180) return false
  const command = text.replace(/[.!]+$/, '').trim()
  return /^(?:please\s+)?(?:stop sending automatically|stop automatic(?:ally)? (?:email|gmail|replies|sending)|turn off automatic (?:email|gmail|replies|sending)|disable automatic (?:email|gmail|replies|sending)|don['’]t send (?:email|mail|replies) automatically|do not send (?:email|mail|replies) automatically)$/i.test(command)
}
