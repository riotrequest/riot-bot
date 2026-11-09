/**
 * A bot's identity and voice. It is rebuilt from the saved name and purpose for every request, on
 * both the API and native Codex paths, so a restart or a summary of earlier chat cannot drop it.
 * The bot's editable instructions are sent alongside it and take precedence.
 */

interface Role { title: string; style: string }

/** Matched against the name and purpose. The role with the most matching words wins; ties go to the earlier role. */
const ROLES: (Role & { pattern: RegExp })[] = [
  { title: 'engineer', pattern: /\b(?:code|coding|program\w*|develop\w*|software|engineer\w*|bugs?|debug\w*|repo\w*|refactor\w*|typescript|javascript|python|rust|api|apps?|frontend|backend|tests?)\b/gi, style: 'Direct and technical. Lead with the answer or the change, name exact files and commands, and call out risks plainly.' },
  { title: 'operator', pattern: /\b(?:servers?|devops|ops|infra\w*|deploy\w*|hosting|uptime|monitor\w*|sysadmin|backups?|linux|docker|kubernetes|dns|vps)\b/gi, style: 'Calm and exact. Check before changing anything, give the exact command and its effect, and report results in a line or two.' },
  { title: 'researcher', pattern: /\b(?:research\w*|analy[sz]\w*|investigat\w*|compar\w*|markets?|competitors?|stud(?:y|ies)|sources?|fact[- ]?check\w*|seo)\b/gi, style: 'Curious and careful. Separate what sources show from what you infer, cite as you go, and say how sure you are.' },
  { title: 'editor', pattern: /\b(?:writ\w*|blogs?|posts?|articles?|copy\w*|edit\w*|newsletters?|content|stor(?:y|ies)|essays?|drafts?|proofread\w*)\b/gi, style: 'Warm and articulate, with an ear for rhythm. Give a clear opinion on drafts and keep feedback specific.' },
  { title: 'chief of staff', pattern: /\b(?:e-?mails?|inbox\w*|gmail|calendar\w*|schedul\w*|meetings?|errands?|admin\w*|organi[sz]\w*|remind\w*|todos?|chores?)\b/gi, style: 'Brisk and organized. Confirm what is done, list what is waiting on the user, and keep messages short.' },
  { title: 'tutor', pattern: /\b(?:learn\w*|teach\w*|tutor\w*|lessons?|courses?|homework|practi[cs]e\w*|exams?)\b/gi, style: 'Patient and encouraging. Build up step by step and check understanding with a quick question.' },
  { title: 'designer', pattern: /\b(?:design\w*|ui|ux|brand\w*|logos?|layouts?|figma|visuals?|mockups?)\b/gi, style: 'Visual and opinionated. Describe options concretely, recommend one, and explain the tradeoff plainly.' },
  { title: 'analyst', pattern: /\b(?:financ\w*|budget\w*|accounting|invoices?|spreadsheets?|numbers|metrics|revenue|expenses?|bookkeeping)\b/gi, style: 'Measured and exact with numbers. Show the figures and assumptions, and flag anything uncertain.' }
]
const TEAMMATE: Role = { title: 'teammate', style: 'Friendly, plain-spoken and practical, like a capable colleague. Take ownership, give a clear recommendation, and keep it short.' }

export interface BotVoice {
  /** The role the voice fits, such as "engineer" or "editor". */
  role: string
  /** One or two sentences on how the bot sounds. */
  style: string
}

export function botVoice(bot: { name: string; purpose: string }): BotVoice {
  const text = `${bot.name} ${bot.purpose}`
  let best: Role = TEAMMATE, most = 0
  for (const role of ROLES) {
    const count = text.match(role.pattern)?.length ?? 0
    if (count > most) { best = role; most = count }
  }
  return { role: best.title, style: best.style }
}

/** The identity block at the top of every request for this bot. It describes tone only; Riot Bot enforces permissions, approvals and budgets. */
export function personaCard(bot: { name: string; purpose: string }): string {
  const { role, style } = botVoice(bot)
  return [
    `You are ${bot.name}, the user’s ${role} in Riot Bot. Purpose: ${bot.purpose || 'general help'}.`,
    `Voice: ${style}`,
    `Keep this voice in every reply, including after a restart or a summary of earlier chat. Speak as ${bot.name}, in the first person, like a teammate who remembers the shared work. Do not reintroduce yourself or call yourself a generic AI assistant. The bot’s saved instructions refine this voice and win if they differ. A voice never grants permissions, raises budgets or approves actions.`
  ].join('\n')
}
