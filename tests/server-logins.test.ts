import path from 'path'
import { describe, expect, it } from 'vitest'
import { MemoryCredentialStore } from '../src/core/credentials'
import type { ModelCompleteInput } from '../src/core/model'
import { MockProvider } from '../src/core/provider'
import { serverLoginFromMessage } from '../src/core/server-logins'
import { RiotService } from '../src/core/service'
import { OsTerminal } from '../src/core/terminal'
import { FakeTerminal, makeApp, tempDir, waitFor } from './helpers'

// A made-up password for a made-up server.
const PASSWORD = 'not-the-real-password'
const PUTTY = `"C:\\Program Files\\PuTTY\\putty.exe" root@192.168.10.20 -pw ${PASSWORD}`
const BOT = { purpose: 'Second bot', name: 'Other', provider: 'openai' as const, model: 'mock-model', workspaceKind: 'suggested' as const, workspacePath: '', avatarKind: 'builtin' as const, avatarValue: 'spark', avatarBackground: '#2f6f62' }

/** A model that calls each tool in turn, one per step of the current request, then answers. */
function calls(...steps: Array<{ name: string; args?: Record<string, unknown> }>) {
  return (input: ModelCompleteInput) => {
    const turn = input.messages.slice(input.messages.map((message) => message.role).lastIndexOf('user'))
    const step = steps[turn.filter((message) => message.role === 'tool').length]
    return step ? { content: '', toolCalls: [{ id: `call-${step.name}`, name: step.name, arguments: JSON.stringify(step.args ?? {}) }] } : { content: 'Done.', toolCalls: [] }
  }
}

describe('finding a server login in a pasted command', () => {
  it('reads PuTTY, plink, pscp, sshpass and ssh addresses, and masks only the password', () => {
    expect(serverLoginFromMessage(PUTTY)).toEqual({
      host: '192.168.10.20',
      port: 22,
      username: 'root',
      password: PASSWORD,
      masked: '"C:\\Program Files\\PuTTY\\putty.exe" root@192.168.10.20 -pw [saved password]'
    })
    expect(serverLoginFromMessage('save this: plink -ssh -P 2222 -l admin -pw "two words" NAS.local uptime')).toMatchObject({
      host: 'nas.local', port: 2222, username: 'admin', password: 'two words', masked: 'save this: plink -ssh -P 2222 -l admin -pw [saved password] NAS.local uptime'
    })
    expect(serverLoginFromMessage('pscp -P 2200 -pw s3cret C:\\reports\\q3.txt deploy@files.example:/srv/drop')).toMatchObject({ host: 'files.example', port: 2200, username: 'deploy', password: 's3cret' })
    expect(serverLoginFromMessage("sshpass -p 'hunter 2' ssh -p 2201 pi@raspberrypi")).toMatchObject({ host: 'raspberrypi', port: 2201, username: 'pi', password: 'hunter 2' })
    expect(serverLoginFromMessage('sshpass -pabc123 scp -P 2022 notes.txt bob@10.0.0.5:/tmp')).toMatchObject({
      host: '10.0.0.5', port: 2022, username: 'bob', password: 'abc123', masked: 'sshpass -p[saved password] scp -P 2022 notes.txt bob@10.0.0.5:/tmp'
    })
    expect(serverLoginFromMessage('connect with ssh://admin:p%40ss@[fd00::1]:2222 please')).toMatchObject({
      host: 'fd00::1', port: 2222, username: 'admin', password: 'p@ss', masked: 'connect with ssh://admin:[saved password]@[fd00::1]:2222 please'
    })
    expect(serverLoginFromMessage(`Here you go:\n\`\`\`\n${PUTTY}\n\`\`\``)?.masked).toBe('Here you go:\n```\n"C:\\Program Files\\PuTTY\\putty.exe" root@192.168.10.20 -pw [saved password]\n```')
  })

  it('ignores quotes, placeholders, masked lines and anything that would not sign in', () => {
    for (const text of [
      `> ${PUTTY}`,
      'putty root@192.168.10.20',
      'putty -pw <password> root@host',
      'plink -pw $PASSWORD root@host',
      'plink -pw %PW% root@host',
      '"C:\\Program Files\\PuTTY\\putty.exe" root@192.168.10.20 -pw [saved password]',
      'putty -pw secret -- -oProxyCommand=evil',
      'plink -pw secret root@-oProxyCommand',
      'plink -pw secret "root;rm"@host',
      'plink -pw secret -P 99999 root@host',
      'ssh root@host -p 22',
      'I use plink at work sometimes',
      // plink treats everything after the server as the remote command.
      'plink root@host -pw secret',
      'sshpass -p secret rsync -a src root@host:dst'
    ]) expect(serverLoginFromMessage(text), text).toBeNull()
  })
})

describe('saving a server login from chat', () => {
  it('keeps the password out of the transcript, the model and the snapshot', async () => {
    const credentials = new MemoryCredentialStore({ encryptionAvailable: true })
    const { app, provider } = makeApp({ credentials })
    const botId = app.getSnapshot().bot!.id
    const conversationId = app.getSnapshot().current!.conversation.id
    provider.handler = () => ({ content: 'Saved. What should I run there?', toolCalls: [] })
    expect((await app.sendMessage(conversationId, PUTTY)).status).toBe('completed')

    const messages = app.openConversation(conversationId).messages
    const user = messages.find((message) => message.role === 'user')!
    // The chat shows what the user wrote and a short notice. The login ID and instructions go to the model only.
    expect(user.content).toBe('"C:\\Program Files\\PuTTY\\putty.exe" root@192.168.10.20 -pw [saved password]')
    expect(messages.find((message) => message.role === 'notice')?.content).toBe('Saved your server login for root@192.168.10.20, port 22, encrypted on this computer. Manage it in Bot settings → Files & tools.')
    expect(provider.calls[0].messages.at(-1)!.content).toMatch(/\[saved password\]\n\nRiot saved server login [0-9a-f-]{36} for root@192\.168\.10\.20, port 22, encrypted on this computer/)
    expect(JSON.stringify(provider.calls)).not.toContain(PASSWORD)
    expect(JSON.stringify(app.getSnapshot())).not.toContain(PASSWORD)
    const [login] = app.getSnapshot().savedServerLogins!
    expect(login).toEqual({ id: expect.any(String), host: '192.168.10.20', port: 22, username: 'root' })
    expect(credentials.get(`server-logins:${botId}`)).toContain(PASSWORD)

    await app.sendMessage(conversationId, PUTTY.replace(PASSWORD, 'n3w-password'))
    expect(app.getSnapshot().savedServerLogins).toEqual([login])
    expect(credentials.get(`server-logins:${botId}`)).toContain('n3w-password')
    expect(credentials.get(`server-logins:${botId}`)).not.toContain(PASSWORD)

    app.removeServerLogin(login.id)
    expect(app.getSnapshot().savedServerLogins).toEqual([])
    expect(credentials.get(`server-logins:${botId}`)).toBeNull()
    await app.close()
  })

  it('removes the password before a queued job is stored, and forgets the login with its bot', async () => {
    const dir = tempDir()
    const provider = new MockProvider()
    const credentials = new MemoryCredentialStore({ encryptionAvailable: true })
    const app = new RiotService({ dbPath: path.join(dir, 'riot.sqlite'), workspaceRoot: path.join(dir, 'projects'), provider, credentials })
    app.boot()
    try {
      const { bot, conversation } = await app.createBot({ ...BOT, name: 'Server bot' })
      app.updateSettings({ autoMemory: false, autoSkillSuggestions: false })
      provider.handler = () => ({ content: 'Saved.', toolCalls: [] })
      const job = app.queueMessage(conversation.id, PUTTY)
      expect(job.text).toBe('"C:\\Program Files\\PuTTY\\putty.exe" root@192.168.10.20 -pw [saved password]')
      expect(JSON.stringify(app.listJobs())).not.toContain(PASSWORD)
      expect(JSON.stringify(app.listJobs())).not.toContain('Riot saved server login')
      await waitFor(() => app.listJobs().every((item) => item.status !== 'queued' && item.status !== 'running'))
      // The note prepared at queue time still reaches the model when the job runs, and the notice is in the chat.
      expect(provider.calls.find((call) => call.tools?.length)!.messages.at(-1)!.content).toMatch(/Riot saved server login [0-9a-f-]{36} for root@/)
      const messages = app.openConversation(conversation.id).messages
      expect(messages.find((message) => message.role === 'user')?.content).not.toContain('Riot saved')
      expect(messages.some((message) => message.role === 'notice' && message.content.startsWith('Saved your server login for root@192.168.10.20'))).toBe(true)
      expect(credentials.get(`server-logins:${bot.id}`)).toContain(PASSWORD)
      await app.deleteBot(bot.id, bot.name)
      expect(credentials.get(`server-logins:${bot.id}`)).toBeNull()
    } finally { await app.close() }
  })
})

describe('running a command on a saved server', () => {
  it('asks first, then gives the saved password only to plink for the saved server', async () => {
    const terminal = new FakeTerminal({ stdout: `Filesystem  Size\n/dev/sda1  20G\nlast login used ${PASSWORD}` })
    const { app, provider } = makeApp({ terminal, findSshClient: () => 'C:\\PuTTY\\plink.exe' })
    const conversationId = app.getSnapshot().current!.conversation.id
    provider.handler = () => ({ content: 'Saved.', toolCalls: [] })
    await app.sendMessage(conversationId, PUTTY)
    const loginId = app.getSnapshot().savedServerLogins![0].id
    provider.handler = calls({ name: 'list_saved_logins' }, { name: 'run_on_server', args: { login_id: loginId, command: 'df -h' } })
    const tool = (name: string) => app.openConversation(conversationId).messages.filter((message) => message.toolName === name).at(-1)?.content ?? ''

    const denied = app.sendMessage(conversationId, 'Check the disk space on my server')
    await waitFor(() => app.pendingApproval()?.title === 'Run this on your server?')
    expect(app.pendingApproval()).toMatchObject({ kind: 'terminal', command: 'df -h', cwd: 'ssh://root@192.168.10.20:22', confirmLabel: 'Run on server' })
    expect(JSON.stringify(app.pendingApproval())).not.toContain(PASSWORD)
    app.resolveApproval(app.pendingApproval()!.id, false)
    expect((await denied).status).toBe('completed')
    expect(terminal.inputs).toHaveLength(0)
    expect(tool('run_on_server')).toMatch(/not approved/)
    expect(JSON.parse(tool('list_saved_logins'))).toEqual({ websites: [], servers: [{ id: loginId, host: '192.168.10.20', port: 22, username: 'root' }] })

    const approved = app.sendMessage(conversationId, 'Check the disk space on my server again')
    await waitFor(() => app.pendingApproval()?.title === 'Run this on your server?')
    app.resolveApproval(app.pendingApproval()!.id, true)
    expect((await approved).status).toBe('completed')
    expect(terminal.inputs).toHaveLength(1)
    expect(terminal.inputs[0].direct).toEqual({ program: 'C:\\PuTTY\\plink.exe', args: ['-ssh', '-batch', '-P', '22', '-l', 'root', '-pw', PASSWORD, '192.168.10.20', 'df -h'] })
    expect(terminal.inputs[0].command).not.toContain(PASSWORD)
    expect(tool('run_on_server')).toContain('Server: ssh://root@192.168.10.20:22\nCommand: df -h\nExit code: 0')
    expect(tool('run_on_server')).toContain('last login used [redacted]')
    expect(JSON.stringify(provider.calls)).not.toContain(PASSWORD)
    await app.close()
  })

  it('refuses another bot’s login, explains a missing plink, and never uses a login removed while waiting', async () => {
    let client: string | null = null
    const terminal = new FakeTerminal()
    const { app, provider } = makeApp({ terminal, findSshClient: () => client })
    const botA = app.getSnapshot().bot!.id
    const conversationA = app.getSnapshot().current!.conversation.id
    provider.handler = () => ({ content: 'Saved.', toolCalls: [] })
    await app.sendMessage(conversationA, PUTTY)
    const loginId = app.getSnapshot().savedServerLogins![0].id
    const run = calls({ name: 'run_on_server', args: { login_id: loginId, command: 'uptime' } })
    const tool = (conversationId: string) => app.openConversation(conversationId).messages.filter((message) => message.toolName === 'run_on_server').at(-1)?.content ?? ''

    const other = await app.createBot(BOT)
    provider.handler = run
    await app.sendMessage(other.conversation.id, 'Run uptime on my server')
    expect(tool(other.conversation.id)).toMatch(/not saved for this bot/)

    app.selectBot(botA)
    await app.sendMessage(conversationA, 'Run uptime on my server')
    expect(tool(conversationA)).toMatch(/plink\.exe, which was not found.*winget install PuTTY\.PuTTY/)

    client = 'C:\\PuTTY\\plink.exe'
    const pending = app.sendMessage(conversationA, 'Run uptime on my server now')
    await waitFor(() => app.pendingApproval()?.title === 'Run this on your server?')
    app.removeServerLogin(loginId)
    app.resolveApproval(app.pendingApproval()!.id, true)
    expect((await pending).status).toBe('completed')
    expect(tool(conversationA)).toMatch(/removed or changed while waiting/)
    expect(terminal.inputs).toHaveLength(0)
    await app.close()
  })

  it('passes arguments to a program exactly, without a shell', async () => {
    const tricky = 'p"a&s s%PATH%^|<x>'
    const result = await new OsTerminal().run({
      command: 'echo argument',
      direct: { program: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1])', tricky] },
      cwd: tempDir(),
      timeoutMs: 20_000,
      maxOutputChars: 1000,
      signal: new AbortController().signal
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(tricky)
  })
})
