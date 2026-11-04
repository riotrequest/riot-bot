/** Present-tense status from the tool that is actually running. No model call. */
export function progressLabel(name: string): string {
  switch (name) {
    case 'gmail_search': return 'Checking email…'
    case 'gmail_read_email':
    case 'gmail_read_thread': return 'Reading email…'
    case 'gmail_save_draft': return 'Saving your email draft…'
    case 'gmail_read_draft': return 'Reviewing your email draft…'
    case 'gmail_send_draft': return 'Checking this email…'
    case 'gmail_list_rules': return 'Checking reply rules…'
    case 'gmail_propose_rule': return 'Preparing a reply rule…'
    case 'set_learning_preferences': return 'Updating memory and skill preferences…'
    case 'get_disk_space': return 'Checking available disk space…'
    case 'create_schedule': return 'Saving your schedule…'
    case 'list_schedules': return 'Checking your schedules…'
    case 'manage_schedule': return 'Updating your schedule…'
    case 'list_memories':
    case 'save_memory':
    case 'update_memory':
    case 'delete_memory':
      return 'Checking memory…'
    case 'search_history':
    case 'read_history':
      return 'Searching earlier conversations…'
    case 'list_skills':
    case 'read_skill':
    case 'save_skill':
    case 'update_skill':
    case 'propose_skill':
      return 'Checking skills…'
    case 'list_files':
    case 'search_files':
    case 'read_file':
      return 'Reading project files…'
    case 'read_attachment':
      return 'Reading an attachment…'
    case 'write_file':
    case 'edit_file':
      return 'Updating project files…'
    case 'run_terminal':
      return 'Running the approved command…'
    case 'verify_website':
      return 'Checking desktop and mobile pages…'
    case 'fetch_url':
      return 'Fetching a page…'
    case 'read_tool_result':
      return 'Reading a stored result…'
    case 'describe_tools':
      return 'Checking available tools…'
    case 'web_search':
      return 'Searching the web…'
    case 'open_url':
    case 'go_back':
      return 'Opening a page…'
    case 'read_page':
      return 'Reading a page…'
    case 'page_snapshot':
    case 'list_tabs':
      return 'Looking at the page…'
    case 'click_element':
    case 'fill_element':
    case 'scroll_page':
    case 'close_tab':
      return 'Using the browser…'
    case 'react':
      return 'Adding a reaction…'
    default:
      return 'Working…'
  }
}

export function completedStatus(actionCount: number): string {
  return actionStatus(actionCount, 'completed')
}

export function actionStatus(actionCount: number, outcome: 'completed' | 'failed' | 'paused' | 'stopped' | 'interrupted' | 'running', failedCount = 0): string {
  if (actionCount <= 0) return ''
  const noun = actionCount === 1 ? 'action' : 'actions'
  if (failedCount > 0) {
    const label = outcome === 'completed' ? 'Finished' : outcome === 'paused' ? 'Paused' : outcome === 'failed' ? 'Failed' : 'Interrupted'
    return `${label} · ${actionCount} ${noun} · ${failedCount} failed · View details`
  }
  if (outcome === 'completed') return `Completed · ${actionCount} ${noun} · View details`
  if (outcome === 'paused') return `Paused · ${actionCount} ${noun} finished · View details`
  if (outcome === 'failed') return `Failed · ${actionCount} ${noun} finished · View details`
  return `Interrupted · ${actionCount} ${noun} finished · View details`
}

export function fileChange(toolName: string | undefined, content: string): { editId: string; path?: string } | null {
  if (toolName !== 'write_file' && toolName !== 'edit_file') return null
  const editId = /edit-id:([0-9a-f-]{8,80})\s*$/i.exec(content)?.[1]
  const path = /^(?:Created|Updated) ([^\r\n]+)/.exec(content)?.[1]
  return editId ? { editId, ...(path ? { path } : {}) } : null
}

export function isLongForm(text: string): boolean {
  if (/^#{1,6}\s/m.test(text)) return true
  const paragraphs = text.split(/\n\s*\n/).filter((part) => part.trim()).length
  return paragraphs >= 3 || text.length > 700
}

export function copyMarkdown(parts: string[]): string {
  return parts.map((part) => part.replace(/\s+$/g, '')).filter((part) => part.trim()).join('\n\n')
}

export function stickToBottom(metrics: { scrollHeight: number; scrollTop: number; clientHeight: number }, threshold = 80): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
}
