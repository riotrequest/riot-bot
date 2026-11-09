# Riot Bot

**A local-first AI assistant for Windows. Run several bots, each with its own memory, workspace and browser, and let the app itself, not a prompt, decide what they are allowed to do.**

> [!NOTE]
> Riot Bot is an early preview (version 0.1.0). Today it is a Windows desktop app, built from source, with no signed installer yet. Other platforms and an always-on server are on the [roadmap](#roadmap). Read the [known limitations](#known-limitations) before giving a bot access to anything important.

<!-- TODO(owner): replace this placeholder with a short GIF or screenshot. Suggested file: docs/images/hero.gif, referenced from here as an image. -->
> **Screenshot placeholder (hero GIF):** the main window, showing the bot list on the left, a bot working through a request in Chat, and the Workspace sidebar (Tasks, Files, Memories, Schedule, Apps) on the right.

## Why Riot

Riot is for people who want an assistant that does real work on their own computer: research, files, websites, email and recurring checks. Your data stays local and every permission is explicit. You bring your own model connection: an OpenAI or OpenRouter API key, a ChatGPT account through the Codex preview, or a model server you run yourself, such as Ollama or LM Studio.

Each bot has one ongoing conversation, its own memories, skills, workspace, and browser profile. The app does not call a model when it is idle, opened, or restarted.

What makes it different:

- **Local-first.** Chats, memories, skills, schedules and saved files live in a SQLite database and folders on your PC. Riot has no account, server, sync or telemetry. What leaves your computer goes to services you choose to use, such as your model provider, the sites a bot visits, Google for Gmail, and the research service for web search.
- **Multiple bots, kept apart.** Each bot has its own memory, skills, working folder, browser profile, schedules, saved logins and permissions. Two bots can work at the same time, and a running task stays with the bot that started it. (Native Codex bots can read more of the filesystem; see [known limitations](#known-limitations).)
- **Permissions enforced in application code.** File, terminal, browser, Gmail and spending rules are checked in Electron's main process. Web pages, emails, tool output and the model's own replies cannot approve an action, raise a budget or grant another bot's access.
- **Saved logins in the Windows credential store.** Website and server passwords are encrypted with Windows protection and kept out of chat, memory and the model's context. Riot fills them locally, only for the bot that owns the login and only on the exact saved HTTPS site or server.
- **Gmail with reviewed sending.** Connect your own mailbox through your own Google app. Every send shows each recipient and the full message for you to approve, unless you turn on a narrow per-bot reply rule for an exact saved reply.
- **Schedules.** Reminders pop up without an AI call. Scheduled bot tasks run with that bot's usual tools, approvals and budget.
- **Browser automation.** A visible Chromium, Chrome or Edge window with a separate profile for each bot. You grant site access once or for a single task, revoke it at any time, and can take over the window for sign-in or verification.
- **Keyless web research.** Search and page reading work out of the box, with no API key or sign-up, under a per-bot daily cap.

## Quick start

### Requirements

- Windows.
- Node.js 22.13 or newer in the 22.x line, 24.x, or 26 and newer, for development and tests. The packaged app includes its own runtime.
- A model connection: an [OpenAI](https://platform.openai.com/) or [OpenRouter](https://openrouter.ai/) API key, a ChatGPT account together with the official Codex CLI, or a model server such as Ollama, LM Studio or vLLM running on this computer. Any other OpenAI-compatible endpoint at a public `https://` address also works; see [local and custom model endpoints](docs/custom-endpoints.md).
- Optional: Google Chrome or Microsoft Edge. Bots can use either one, so you don't need to download Chromium.

### Install and run

```powershell
git clone https://github.com/riotrequest/riot-bot.git
cd riot-bot
npm ci
npm run dev
```

Riot makes no model call until you send a message.

### Connect a model

1. In Chat, choose **Let’s set up**, or open **Settings → Connections & default model** at the bottom of the left sidebar.
2. Pick a connection:
   - **OpenAI API** or **OpenRouter:** paste your API key, then copy the exact model ID from that provider’s catalog. Riot never picks or substitutes a model for you.
   - **ChatGPT account (preview):** install the official Codex CLI, restart Riot, choose **Sign in with ChatGPT**, then pick a model. See [Codex in Riot Bot](docs/codex.md).
   - **Local or custom model:** start your model server, then enter its address (for example `http://localhost:11434/v1` for Ollama or `http://localhost:1234/v1` for LM Studio), the context length it runs the model with, and the model name it uses. A key is optional. See [local and custom model endpoints](docs/custom-endpoints.md).
3. Choose **Save app settings**, then send your bot a message.

API-key connections are billed by your provider. Call and time limits are on by default. Dollar limits apply once you enter a cap and the model's prices. See [Model connections and limits](#model-connections-and-limits).

### Next steps

- [Run a first browser task](docs/user-guide.md#first-browser-task) or [check a paid provider safely](docs/user-guide.md#first-real-provider-check).
- [Save a website login](docs/security.md#save-a-login-once) for a bot.
- [Connect Gmail](docs/gmail.md) and choose what each bot may do.
- [Schedule a reminder or a recurring bot task](docs/scheduling.md).

## Feature tour

### Bots and chat

The left sidebar lists your bots. **New Bot** creates another assistant with its own purpose, instructions, avatar, model and working folder. Each bot keeps one ongoing conversation. Riot compacts older history automatically and searches it for recall, so there is no New Chat button. You can rename a bot from its menu, or by asking in its Chat (“Call yourself Scout”).

Replies use Markdown. Links open in your own browser after a public-address check, and images in model replies are never loaded. You can attach files or paste a screenshot. Each reply shows whether its run completed, failed, paused or was interrupted, and **Usage & activity** keeps the full record of every model call, including what went into its context.

<!-- TODO(owner): replace with a screenshot. Suggested file: docs/images/chat.png -->
> **Screenshot placeholder (chat):** a bot answering a request with a one-line tool status, file links with Undo, and an emoji reaction.

Details: [user guide: bots and chats](docs/user-guide.md#bots-and-chats) and [chat](docs/user-guide.md#chat).

### Files, commands and saved versions

Each bot works in its own folder. Riot’s file tools stay inside that folder, check symlinks and junctions, refuse hard-linked files, and block common secret files like `.env` and private keys unless you grant access for that folder. Editing is off for existing folders until you turn it on, and each edit Riot makes has an Undo control. A terminal command runs only after you approve that exact command.

Every message becomes a durable job. You can queue follow-ups, switch bots while one works, and close the window to the tray while work continues. The **Files** screen keeps versioned copies of everything a job created or changed. **verify_website** checks a static HTML page at desktop and mobile sizes and saves screenshots and a report.

Details: [tasks, saved files and local verification](docs/jobs-and-library.md).

### Browser automation

Each bot gets a visible browser window with its own profile, separate from your personal Chrome or Edge profile. Sign-ins and cookies persist across restarts. Bots read the whole page through snapshots, including frames and shadow DOM, with each element’s state and value, and models that accept images can also take a labelled screenshot. They can click, type, choose dropdown options, press keys, hover, drag, wait for a page to change and switch tabs, but have no tool for running arbitrary page scripts. Uploads come from the bot’s workspace and ask you every time. Files a bot downloads are saved into its workspace `Downloads` folder. The number of browser steps per task is a setting for each bot.

The first time a bot needs to interact with a site, a card offers **Remember & allow**, **This task only**, or **Deny**. Remembered access lets that bot click and fill forms on that site without asking each time, including actions that send, pay, publish or delete there. You can revoke it in **Bot settings**. **Take over** hands you the window for sign-in, MFA or a CAPTCHA. For the connections it handles, a local proxy refuses private and local-network destinations, including after redirects.

<!-- TODO(owner): replace with a screenshot. Suggested file: docs/images/site-access.png -->
> **Screenshot placeholder (site access):** the site-access card with Remember & allow, This task only and Deny, beside the bot's browser window.

Details: [user guide: browser](docs/user-guide.md#browser) and [saved logins and permissions](docs/security.md#remember-website-access).

### Saved website logins

Save a login once in **Bot settings → Files & tools → Saved website logins**, or with a labelled chat command. The password goes into the Windows-protected credential store, apart from chat history and memory. The model only sees an ID and metadata. Riot checks the bot, the exact HTTPS origin and the current page elements, then fills the password locally. Removing a login deletes its stored entry.

Paste a PuTTY, plink or sshpass command with its password into the chat and Riot saves it as a server login in the same protected store, removing the password from your message before it is stored or sent anywhere. The bot can then run commands on that server, each one after your approval, through PuTTY’s plink.

Details: [saved logins and permissions](docs/security.md).

### Keyless web research

By default, research uses **Automatic — free, limited**. Searches go to Tavily without a key, with one Firecrawl fallback. Riot reads public pages directly and uses a reading service only when a page can’t be read. Each bot can make 40 research requests a day. You can switch to your own Tavily or Firecrawl key, or to browser search with Google, Brave, DuckDuckGo or a custom search address. After a bot has read private sources, sending a search to a research service needs your approval.

Details: [web search](docs/web-search.md).

### Gmail with reviewed sending

Connect an existing Gmail or Google Workspace mailbox with your own Google Desktop OAuth app. There is no Riot mail server or shared OAuth app. You choose access separately for each bot: none, read and draft, or read, draft and send. Before every send, Riot shows the sender, every recipient and the full message. An unconfirmed send is never retried automatically.

A **reply rule** that you turn on for one bot can send an exact saved reply to people who were already in the conversation, within a daily limit. Anything else waits for review, including money words, exclusions, new recipients, attachments and changed originals.

<!-- TODO(owner): replace with a screenshot. Suggested file: docs/images/gmail-review.png -->
> **Screenshot placeholder (Gmail review):** the send review card showing the sender, every recipient and the full message, with Send email and Don’t send.

Details: [connect Gmail](docs/gmail.md).

### Reminders and scheduled work

The **Schedule** screen holds reminders and bot tasks that run once, daily, on weekdays or weekly. You can also ask in Chat (“Remind me to check email at 9 PM”). A reminder shows a Riot popup without any AI call. A bot task runs with that bot’s current setup, approvals and budget, and its results appear in Chat and Tasks. Missed AI work waits for **Run now** and is never replayed automatically. Schedules run while Riot is open or in the tray and the computer is awake.

<!-- TODO(owner): replace with a screenshot. Suggested file: docs/images/schedule.png -->
> **Screenshot placeholder (schedule):** the Schedule screen with a daily bot task and a reminder, plus a Riot reminder popup in the corner of the screen.

Details: [reminders and scheduled bot work](docs/scheduling.md).

### Memory and skills

Say `remember this: …` to save a fact or preference. A short, optional review after a successful reply can save one well-supported memory and suggest a reusable skill, but a skill is never saved until you choose **Save skill**. Skills are procedures written as text. They cannot grant permissions, raise a budget or override the app’s rules.

Details: [user guide: what you can ask it to do](docs/user-guide.md#what-you-can-ask-it-to-do) and [quiet memory and skill reviews](docs/quiet-learning.md).

### Model connections and limits

Riot works with OpenAI and OpenRouter API keys, with a ChatGPT account through the official Codex CLI (preview), and with a local or custom OpenAI-compatible model server. Riot never silently switches provider, account, model or billing. Each API task has call and time limits (24 model calls and 10 minutes by default). Optional dollar caps work per bot and app-wide, using prices you enter. Context fitting and reply length adjust automatically to the model’s published limits. Codex usage comes from your ChatGPT account’s allowance, not from Riot’s dollar budget. A custom endpoint has no known prices, so its dollar limits stay blocked until you enter both prices for the bot; call, time and output limits still apply.

Details: [user guide: credentials](docs/user-guide.md#credentials), [limits](docs/user-guide.md#limits), [Codex in Riot Bot](docs/codex.md) and [local and custom model endpoints](docs/custom-endpoints.md).

## Where your data lives

Data lives in `%APPDATA%\riot-bot\`:

- `riot-bot.sqlite` — bots, conversations, messages, attachments (including pending uploads), reactions, memories, skills, tasks, schedules, and usage
- `avatars\` — uploaded bot images, stored as PNG thumbnails named by bot id
- `browser-profiles\<bot id>\` — that bot’s Chromium cookies and site storage
- `playwright-browsers\` — the Chromium download, after you choose Install Chromium
- `credentials.bin.json` — Windows-encrypted API keys (including an optional custom-endpoint key), Gmail credentials and per-bot website logins
- `codex\` — Riot-owned Codex authentication, native sessions, and configuration; managed by the official CLI
- `artifacts\<bot id>\` — immutable saved file versions in that bot’s Library
- `riot-bot.log` — redacted operational log

New workspaces are created under your home folder in `RiotBot\workspaces\`, with file editing enabled for that new folder. Existing folders start with editing off. Writes can create subfolders inside the workspace. Browser profiles are not inside the workspace and are not your Chrome or Edge profile.

See [backups and removing the browser](docs/user-guide.md#backups-and-removing-the-browser) before copying, restoring or deleting any of these.

## Architecture

The Electron main process is the trusted side. It owns SQLite (`node:sqlite`), credentials, provider calls, files, processes, and the Chromium window. The React window is sandboxed: context isolation on, Node integration off, and a small typed preload bridge. Remote pages stay in Chromium. They are not loaded in the Electron renderer. Markdown is rendered with raw HTML disabled. Code is shown as text. Avatar images are local data URLs, not remote content. Page text is untrusted and cannot change your instructions, permissions, budgets, or which bot is acting.

Every model call goes through one gateway with a run id. A call starts only from a message you send, a bot-setup request you start by creating a bot without a name, or the provider check you start. Status lines, avatar choices, and browser installation do not call a model. The gateway reserves a conservative cost before the call and settles it afterward, including after a crash. Compaction, retries (at most two transient retries), browser follow-ups, and tool follow-ups share the same task budget. The mock provider is used by tests and is never called on launch.

Each request is built from the bot profile, pinned instructions, pinned memories, the rolling summary, the current task, a few retrieved memories, a short skill catalog, and recent messages that fit the input budget. The full skill text is loaded only when a tool asks for it. Older text stays in SQLite and can be searched, including the messages around a match. There is no embeddings index.

Web fetches resolve the host, refuse the request if any address is local or private, and connect to a resolved address while keeping the original Host header and the normal HTTPS certificate check. A custom model endpoint uses the same checks before every request, except that plain `http://` is allowed for exactly `localhost`, `127.0.0.1`, and `[::1]`; it accepts only its saved origin and path and never follows redirects. Each redirect is checked again. TLS verification is not turned off. The browser’s local proxy does the same kind of check for connections it handles. That does not make the browser isolated from the local network.

For a map of the source tree, see [CONTRIBUTING.md](CONTRIBUTING.md#project-layout).

## Building an installer

```powershell
npm run dist:win
```

Without a configured signing identity, this writes a local unsigned development installer:

`release\Riot-Bot-Setup-0.1.0.exe`

For an eventual public release, use `npm run dist:win:release`; its separate config requires a real publisher signature. No signing certificate is configured yet. See [the security report](docs/security-review.md) for artifact verification and remaining release work.

`playwright-core` remains unpacked for optional Chromium setup, so those files are outside the main ASAR's integrity check. The installer runs in an Electron utility process with its download helper in a worker thread, preserving installation with RunAsNode disabled. Chromium downloads into `%APPDATA%\riot-bot\playwright-browsers` only when requested. The app still uses the default Electron icon.

## Known limitations

- Riot Bot currently runs only on Windows, as a desktop app on your own computer. macOS, Linux and an always-on server are planned, not shipped; see the [roadmap](#roadmap).
- Recall is summary plus search, not a full replay of every past message. If the saved messages do not establish an answer, the assistant is instructed to say so.
- A deleted memory or disabled skill leaves later requests, but older messages that mention it remain in the transcript.
- Dollar figures can differ from the provider bill. A missing price blocks dollar-budget mode; it does not invent a price.
- An API terminal command is not sandboxed. Approval is per exact command. Codex uses its own sandbox and approval rules; its legacy Windows policy permits broader filesystem reads.
- Bots are separated in Riot’s own storage and tools, but native Codex filesystem reads are not a confidentiality boundary between bots. See [Codex permissions](docs/codex.md#permissions-and-sessions).
- Permission checks reduce unintended sharing. They are not a complete data-loss-prevention system: approved sites, public pages and research services receive what a task sends them. See [saved logins and permissions](docs/security.md#remember-website-access).
- Stop ends the command tree through `taskkill /T /F` on Windows. A process that already detached can survive, and that case is reported when the stop call fails.
- Web fetch uses the first public address after refusing any host that also resolves to a private address. TLS verification stays on.
- The browser is not isolated from the local network. The proxy covers connections it handles. It does not prove that every browser subrequest is blocked.
- The secret check only catches common patterns.
- File undo is refused if the file changed after the edit.
- File tools refuse any file with more than one name (a hard link), so projects whose package manager hard-links dependencies, such as pnpm’s `node_modules`, will have those files refused. Approved terminal commands and native Codex tools are not covered by this check.
- Images in model Markdown are not loaded. `http` and `https` links open externally. Avatar uploads are stored locally.
- One task per bot runs at a time, with up to two bots working independently; overlapping workspaces take turns. Only saved schedules start work on a timer. Optional memory/skill reviews follow successful user turns; skills still require explicit approval to save.
- Typed drafts survive a bot switch in the same session and are not written to disk. Pending file and screenshot attachments are persisted.
- No accounts, sync, telemetry, plugin marketplace, or extra agents.
- Automatic mode uses a documented context length, a capacity entered in Advanced, or the labeled 32,768-token fallback. It does not discover a window for every provider. OpenAI’s model list does not supply one, and a custom endpoint uses the context length you enter.
- A custom model endpoint must be on this computer or at a public `https://` address. Servers elsewhere on a home or office network are refused until the owner decides how to grant them. Custom endpoint requests do not use Windows proxy settings, and Riot does not list the models on that server. The custom endpoint has not yet been checked against a real Ollama, LM Studio, or vLLM server.
- The earlier provider check’s cancellation step did not pass. These mock tests do not rerun that live check.
- The installer is unsigned and does not yet include this version.

The [security review](docs/security-review.md) records the remaining architectural risks in more detail.

## Roadmap

Riot Bot is a Windows desktop app today. The long-term goal is a UI and a backend that people can run on an always-on server, on more than just Windows. These items are **planned and not shipped**. Nothing in this section works yet:

- **Self-hostable, always-on backend with a web UI** *(planned, not shipped)*: run Riot on a machine that stays on, so schedules and bot work no longer depend on a desktop session, and use it from a browser.
- **macOS and Linux support** *(planned, not shipped)*: run Riot on platforms other than Windows.

Features that depend on Windows today, such as the Windows-protected credential store, will need a platform-appropriate replacement that keeps the same guarantees before these items can ship.

## Documentation

| Document | What it covers |
| --- | --- |
| [User guide](docs/user-guide.md) | Everyday use: layout, bots, chat, credentials, tools, browser, limits, context, backups |
| [Saved logins and permissions](docs/security.md) | Saved website logins, remembered site access, project secrets, powerful actions |
| [Web search](docs/web-search.md) | Keyless research, your own connection, browser search, research permissions |
| [Gmail](docs/gmail.md) | Google setup, per-bot access, send review, reply rules |
| [Reminders and scheduled work](docs/scheduling.md) | Schedules, popups, context capture, recovery |
| [Tasks and saved files](docs/jobs-and-library.md) | Durable jobs, the tray, the Files library, static website checks |
| [Quiet memory and skill reviews](docs/quiet-learning.md) | Automatic memory and skill suggestions |
| [Codex in Riot Bot](docs/codex.md) | The ChatGPT-account preview backend and how its permissions differ |
| [Local and custom model endpoints](docs/custom-endpoints.md) | Ollama, LM Studio, vLLM and other OpenAI-compatible servers: setup, address checks, limits |
| [Backend design](docs/subscription-backends.md) | API and native agent backends, including the saved Claude design |
| [Security review](docs/security-review.md) | Findings, fixes, verification and remaining release work |
| [Changelog](CHANGELOG.md) | Dated development updates and verification records |

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, checks and test expectations. The security rules every change must follow are in [AGENTS.md](AGENTS.md#security-rules-for-changes).

## Security

Please don't report vulnerabilities in public issues. [Report them privately on GitHub](https://github.com/riotrequest/riot-bot/security/advisories/new) or email [security@riotrequest.com](mailto:security@riotrequest.com); [SECURITY.md](SECURITY.md) explains what to include.

## License

Riot Bot is released under the [MIT License](LICENSE). You can use, change and share it, including commercially, as long as you keep the copyright and license notice.
