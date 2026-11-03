# Riot Bot

Riot Bot is a personal Windows desktop assistant. Each bot has one ongoing conversation, its own memories, skills, workspace, and browser profile. The app does not call a model when it is idle, opened, or restarted.

## Easier setup and everyday use — November 3, 2026

Start in Chat with **Let’s set up**. **Settings → Connection** walks through choosing an AI connection, signing in or adding an API key, and choosing a model. Save settings, then return to Chat. A starter idea fills your draft without sending it. Trying to send before connecting opens setup and keeps your draft.

The sidebar uses **Tasks** for work in progress, **Files** for saved versions, and **Memories** for facts and preferences. **Usage & activity** is below Settings. Empty screens explain how to get started. **New bot** offers a few starting ideas and inherits the selected bot’s provider and model. Its default name avoids a naming request; connection overrides, folders, and appearance are optional disclosures.

Settings has four sections: **Connection**, **Files & tools**, **Limits**, and **Advanced**. Model/context tuning and the optional connection test live in Advanced. Use **Customize bot** in the header for its name, purpose, extra instructions, icon, browser, earlier conversations, and deletion. Choosing a different working folder turns editing off in the form until you explicitly enable it and save. Existing saved permissions are preserved.

## Persistent jobs and saved files — November 2, 2026

Messages now become durable jobs. You can queue a follow-up while a bot works and switch to another bot. Two bots can run independently; each has its own provider, tools, browser, approvals and Stop control. Jobs sharing a workspace take turns. The **Tasks** view shows queued work, approvals and outcomes across one or all bots.

Closing the chat hides it in the Windows system tray while work continues. Double-click the Riot tray icon to reopen; use its menu to stop all work or **Quit Riot Bot**. Quit interrupts active jobs and pauses the queue. Reopening does not make model calls: choose **Resume** for work you want to continue. The computer must remain on and awake. This is a local desktop service; scheduled routines and a cloud/mobile control plane are still future work.

The per-bot **Files** screen keeps versioned copies of files created or changed during a job, including partial results from a stopped job. Copies remain available after the workspace original changes or is deleted. Chat keeps short summaries and workspace file links. **Show in folder** reveals the version in Explorer; HTML does not render automatically. See [job, Library and verification behavior](docs/jobs-and-library.md) for bounds and recovery details.

API and native Codex bots can use **verify_website** for a static HTML file. It loads desktop and mobile viewports in fresh browser contexts, blocks external page requests, and saves screenshots plus a report. It checks initial script errors, missing local assets and horizontal overflow. It does not establish that every interaction, backend or visual detail works. General project commands still require approval.

## Review fixes — November 1, 2026

Tool arguments are checked against their definitions before any action in a batch runs. Missing file contents, malformed JSON, and unknown tools pause without executing the batch. A cut-off tool batch is discarded and retried in smaller complete pieces within the task limits. Turning tools off is enforced in the main process, including while a terminal command waits for approval.

Incomplete provider streams fail instead of reporting success. Partial replies are kept, and a failed request is not automatically retried after text has streamed. Provider checks require observed streaming and an actual cancellation before marking those steps passed. Task deadlines abort in-flight requests; Stop also cancels a model-catalog lookup. Closing waits for replies, provider checks, and bot setup before closing the database.

Private-address checks now cover compressed and expanded IPv6 spellings and IPv4-mapped IPv6. Browser references expire across snapshots, navigation, and takeover, and are checked again after approval. Generic form buttons require confirmation. Closed tabs are removed from the live tab list.

History, memory, and skill search filter by bot before applying the result limit. Another bot's matching records cannot crowd out this bot's recall. File replacement refuses binary or non-UTF-8 files, enforces the write limit in bytes, and rejects Windows alternate data streams. Undo compares the exact bytes. Bot setup does not borrow prices from a different model.

`npm run check` runs TypeScript checks, tests, and a production build. Vitest was updated to 5.0.5. The production dependency audit has no reported advisories; the remaining 15 moderate advisories are in packaging development dependencies. The existing installer in `release` has not been rebuilt for these changes.

The follow-up adds paged history, saved per-turn outcomes, attachment uploads and screenshot paste, and preserves the All bots Activity filter when a task finishes. Provider and model-catalog requests use Electron's networking stack so they honor Windows trust and proxy settings; public web tools keep their separate address checks. Google result parsing preserves observed opaque redirect links and displayed destinations. Real browser and image/text tasks passed with the selected OpenRouter DeepSeek model on November 1, 2026.

The November 2 search follow-up makes Brave the default and upgrades saved DuckDuckGo defaults on startup, preserving custom templates. It reads parent result cards rather than counting grouped links, rereads existing results after human verification, distinguishes reader failures from sign-in requests, and detects closed browser contexts before reopening them.

Codex is now available as a preview backend through the official CLI and its managed ChatGPT sign-in. It runs Codex’s native agent loop, search, and tools alongside Riot’s scoped memory/history/attachment tools. See [Codex setup and behavior](docs/codex.md). The separate API backends keep their existing tool loop and free Brave browser search. The [backend design](docs/subscription-backends.md) records the remaining Claude work.

## Setup

Requires Node.js 22.13 or newer in the 22.x line, 24.x, or 26 and newer for development and tests. The packaged app includes its own runtime.

```powershell
cd riot-bot
npm install
npm run dev
```

The first launch of this version keeps the existing database. Chats, memories, skills, and settings stay with the bot that owns them. A one-time backup from the earlier migration is `riot-bot.sqlite.v2.bak` beside the database and is not overwritten. Workspace files are not moved.

Data lives in `%APPDATA%\riot-bot\`:

- `riot-bot.sqlite` — bots, conversations, messages, attachments (including pending uploads), reactions, memories, skills, tasks, and usage
- `avatars\` — uploaded bot images, stored as PNG thumbnails named by bot id
- `browser-profiles\<bot id>\` — that bot’s Chromium cookies and site storage
- `playwright-browsers\` — the Chromium download, after you choose Install Chromium
- `credentials.bin.json` — API keys encrypted with Windows
- `codex\` — Riot-owned Codex authentication, native sessions, and configuration; managed by the official CLI
- `artifacts\<bot id>\` — immutable saved file versions in that bot’s Library
- `riot-bot.log` — redacted operational log

New workspaces are created under your home folder in `RiotBot\workspaces\`, with file editing enabled for that new folder. Existing folders start with editing off. Writes can create subfolders inside the workspace. Browser profiles are not inside the workspace and are not your Chrome or Edge profile.

To remove the browser without touching chats, quit the app and delete `playwright-browsers` and `browser-profiles`. Deleting a profile removes that bot’s signed-in site storage. Do not delete the database to uninstall Chromium.

For a full backup, preserve the database, encrypted credentials, avatars, complete browser profiles, and the Codex profile when connected. A source ZIP or Git bundle does not contain these. Workspace files are separate and need their own backup. Quit Riot Bot and its browser windows before an ordinary folder copy; for a running database use SQLite's backup API rather than copying its hot WAL files. Restore into a separate folder, check the database and file hashes, and keep the current app-data folder aside before replacing it. Do not mix a restored database with an older WAL/SHM pair. Credentials and browser sign-ins can depend on the same Windows account and machine. Keep app-data archives private.

## Bots and chats

The sidebar is **New Bot** and a vertical list of bots. Each row shows the avatar and display name. The selected bot has a marker. Click a bot to open its ongoing conversation. The selected bot is remembered after a restart.

**New Bot** creates another assistant with exactly one ongoing conversation. The purpose is required. Leave the name blank to let one setup request suggest a name and initial instructions, or type a name and skip that request. The setup request is labeled `bot_setup`, has no tools, and follows the same spending limits. If no model is configured, or the reply is not usable, the bot is still created with a name taken from the purpose.

There is no New Chat button. Compaction, memory, and history search stay automatic. A bot that already had several chats keeps every message. The most recently active chat becomes the ongoing conversation. The others stay in the bot menu under **Earlier conversations**, and search there stays on that bot. Those chats are read-only. New messages go to the ongoing conversation. Nothing is merged or deleted.

The **Customize bot** button in the main header opens the selected bot’s controls in the main panel: rename, purpose, instructions, avatar, **Open Workspace**, earlier conversations, Settings, and browser controls. **Customize bot → Delete this bot → Delete bot…** opens a confirmation requiring the bot’s exact name. Stop its active work first. Deletion discards its queue and removes Riot’s chats, memories, skills, Library copies, avatar and browser profile. The project folder, shared provider sign-ins, anonymous usage totals and Codex’s managed session history remain. Other bots stay intact. You can delete the last bot and create another from the empty app.

Switching bots keeps the unsent draft for each bot during the session. A running task, its approval, and its browser stay with the bot that started them. Memory, skills, workspace, history, and the browser profile stay separate.

The app-wide daily spending ceiling applies to every bot. A bot’s own daily limit can only make that ceiling tighter. Credentials stay in the app-level store.

## Chat

Short replies stay compact. Longer answers use Markdown: paragraphs, headings, lists, quotes, tables, and code. A finished article is the article itself. A word count is added only when you ask for one. An `http` or `https` link opens in your own browser after a public-address check. It is not loaded in the app window. Images in model Markdown are not loaded.

Project work defaults to saved files and a short summary with file links. Clicking a workspace filename reveals it in its folder, without running it. File links are checked in the main process against the selected bot’s workspace, including symlink/junction checks. Full source is requested explicitly; large code blocks are collapsed behind **View source** and remain available to expand or copy. Workspace editing must be enabled to save files; a disabled write pauses with **Open Settings** rather than falling back to a source dump.

An API reply that reaches its per-response cap continues automatically into the same saved message. Incomplete tool batches never execute; the model is asked for smaller complete chunks. `write_file` can append chunks, retaining one Undo record for that file write. Every continuation still passes the same time, call, and spending checks, and Stop remains effective. If a limit prevents finishing, the task is paused with its partial work preserved. Previously cut-off replies that were incorrectly marked completed are relabeled paused on upgrade. None are automatically replayed.

Casual acknowledgements can be a short reply, an emoji reaction on the message, or both. The reaction is chosen in the same model turn. A reaction does not replace an answer to a question. **Copy** copies the assistant’s Markdown, without the avatar, tool log, or status line.

Tool activity is one status line, such as “Checking memory…”, “Searching the web…”, or “Reading a page…”. When the turn is finished, the details say whether that run completed, failed, paused, or was interrupted, and how many actions finished. A finished tool does not by itself mean the request succeeded. Approvals, errors, file undo, and skill previews stay visible. A pause is shown once, in the chat. If the pause says Open Settings, that button is on the same notice. **Show tool details by default** is off until you turn it on in Settings. The full record remains in Activity, for this bot or for all bots.

The transcript follows new text only while you are near the bottom. Otherwise it leaves a **Jump to latest** control.

Opening a long chat loads the newest 80 messages. **Load earlier messages** prepends another page while keeping your reading position. The complete transcript remains searchable. Completed, paused, stopped, interrupted, and failed outcomes come from each saved run, including after restart. Legacy records without an outcome are labeled as unavailable.

Use **Attach files**, drag files onto the composer, or paste a screenshot with Ctrl+V after Win+Shift+S. **Paste screenshot** reads an image only when clicked. PNG/JPEG images (8 MB maximum, within 8192 pixels per side and 32 megapixels) are decoded and resized to at most 2048 pixels per side. UTF-8 text/code files can be up to 1 MB. Up to four files can accompany a message, including a message with no typed text. Pending attachments stay with their bot across switching and restart. Remove discards the pending copy and leaves the original file intact. Attaching, pasting, and removing do not call a model.

Sending shares those attachments with the selected backend. Images require a vision-capable model and are sent as image parts. Text has a short preview and a `read_attachment` tool (`riot_read_attachment` in Codex) for the full saved contents in bounded sections. API images reserve 16,384 estimated input tokens apiece for fitting and budget checks; actual provider usage varies. Codex manages its own context and account usage. Attachments are stored in SQLite and removed with their conversation. PDFs, Office documents, archives, audio/video, GIF, and WebP are not supported in chat yet; convert documents to UTF-8 text or take a PNG screenshot. Earlier images are not replayed after compaction; attach the image again if exact visual details are needed.

The bot’s workspace path is part of its profile. Ask “what is your workspace location” and it can answer from that profile without searching files.

## Avatars

Every bot has an avatar in the bot list, the chat header, and once beside each assistant reply. A new bot gets a built-in icon. You can pick another icon or emoji and a background color, or upload a PNG, JPEG, GIF, or WebP. Uploads are checked, decoded, and stored as a small PNG. SVG, HTML, and remote image addresses are not used. A missing image falls back to a built-in icon. Choosing an avatar does not call a model.

## Credentials

Open **Settings → Connection**.

For **ChatGPT account**, sign in with ChatGPT, choose a model from the account’s picker, and choose **Save settings**. This uses the Codex preview connection and requires the official Codex CLI. Full instructions and permission differences are in [docs/codex.md](docs/codex.md).

For **OpenAI API** or **OpenRouter**:

1. Choose the connection card for your provider.
2. Paste your API key. If a key is already saved, leave the box empty to keep it.
3. Copy the exact model ID from that provider’s catalog into Model ID. Riot does not select or substitute an API model.
4. Choose **Save settings**, then **Back to chat**. This saves the settings and any new key together.

A ChatGPT Plus, Codex, or Cursor subscription does not supply this key. The key is shared by every bot. Keys stay in the main process. The window only learns whether a key is saved. On this machine Windows credential protection is available, so a saved key survives restart. If that protection is unavailable, the key is kept in memory for the session and forgotten on quit.

That statement applies to the API-key backends. Codex has its own authentication, native tools, permissions, and usage limits. A Codex quota or authentication failure never switches to an API key.

OpenAI requests go to `https://api.openai.com/v1/chat/completions`. OpenRouter requests go to `https://openrouter.ai/api/v1/chat/completions`.

## What you can ask it to do

Riot’s API file tools stay inside the selected bot’s workspace. File creation and editing stay off until **Allow Riot Bot to create and edit files in this folder** is checked. Each app-made edit can be undone from the chat if the file has not changed since. The API workspace is not an operating-system sandbox. Codex uses its native sandbox and file tools; its edits do not have Riot’s Undo button, and its legacy Windows policy permits broader reads. See the Codex guide.

An API terminal command is shown with its working folder and time limit, and it runs only after you approve that exact command. The workspace folder does not contain the API shell. Codex follows its native approval rules: safe read commands can run automatically, and native requests that need approval appear in Riot Bot.

`fetch_url` is still the lightweight tool for a straightforward public page. The browser is for JavaScript pages, search, and interaction.

Say `remember this: …` to save that wording without a model call. A guess is saved when you explicitly ask to remember it, and you can correct or delete it afterward. Obvious secret patterns are blocked. That check does not catch every secret.

A memory is a fact or preference. A skill is a procedure. Say `Save this workflow as a skill.` or `Update that skill with the correction we just discovered.` to save or update one. After a substantial task, Riot Bot may show a preview with **Save**, **Edit**, and **Dismiss**. Nothing about later chats changes until you save it. Skills cannot grant permissions, raise a budget, or override the app rules. The **Skills** screen lists, edits, disables, deletes, and restores versions. Markdown export and import are text only: import shows a preview first, adds the skill disabled, and does not run code or install anything. The catalog added to a request is at most eight short descriptions, and about 400 estimated tokens.

## Browser

Each bot’s browser data is under `%APPDATA%\riot-bot\browser-profiles\<bot id>`. Bundled Chromium uses that profile directly. Installed Chrome and Edge use separate `chrome` and `msedge` subfolders there; your personal browser profile is not opened. Cookies and site storage persist across restarts. Another process cannot open the same profile at the same time. The window opens only when you choose **Open Browser** or a task you sent needs it. Launch and idle time do not open it and do not call a model. **Close Browser** closes the window and keeps the profile. Stop cancels the browser action in progress. It does not erase the profile or undo a page that already loaded. After a restart, an unfinished browsing task is not resumed.

A signed-in page can keep making ordinary website requests while that window is open. That traffic is not a model call. Zero idle model calls does not mean zero network traffic from a page you left open.

The bot menu shows the available browser. Riot Bot prefers its downloaded Chromium when present, and can otherwise use installed Google Chrome or Microsoft Edge on Windows. No separate download is required when one of those browsers is available. **Install Chromium** remains an optional download from Playwright’s browser distribution into `playwright-browsers`. The progress line includes the download size. It is not a model charge, and it does not start on launch. The app uses a visible browser with its sandbox on. Pages are not embedded in the window.

Browser tools can list tabs, open an `http` or `https` URL, read the page, take a compact snapshot with element references, click or fill an observed element, scroll, go back, close a tab, and search. A reference belongs to one tab and one snapshot. A stale or ambiguous reference is rejected. There is no tool for arbitrary page scripts, a shell inside the page, or the browser’s debugging protocol. Automatic downloads are cancelled. A file upload is not chosen by the bot; take over the window and pick the file yourself.

Search opens a public search page in that browser. The default template is `https://search.brave.com/search?q={query}`. On first startup of this version, saved copies of the old DuckDuckGo default are changed to Brave; custom templates are preserved. You can explicitly request Brave, Google, or DuckDuckGo, or set another public `https` template containing `{query}` under **Settings → Advanced → Web search settings**. There is no separate search API fee. The model still spends tokens from the task budget to read the results. Snippets are only a way to find a page. Open the source before treating a detailed claim as verified, and include the source URL. Brave result numbers count parent web cards, excluding ads and grouped sitelinks. Only the returned numbered cards were observed; eight cards do not establish a top-ten sweep.

An explicit Google search uses Google even when the default is Brave. The tool accepts `engine: "google"`, `"brave"`, `"duckduckgo"`, or `"default"`. A request such as “forget Google” overrides a stale Google tool argument. It keeps the exact query and records the engine, actual results URL, observation time, and observed organic result cards. Ads and grouped sitelinks are excluded from the numbered cards. The explicit Google route requests US English results with personalization off; it is one observation, not a universal SEO rank. Another engine's result numbers do not establish a Google position.

Search remains free and uses no extra search-service key. A CAPTCHA pauses the task without another model call or alternate-URL retries. Its notice has **Take over browser** and **Resume browser** controls. Complete verification, choose Resume browser, and send the request again. A new request to inspect a solved search challenge can also reread that pending search. Riot Bot reuses the existing results instead of starting the search over; a retry with an unspecified engine keeps the pending search's engine. Resume alone does not start a model call. A result-reader failure is reported separately and leaves browser control available; it does not ask you to sign in. A window closed during an action pauses the run, and the next request reopens the bot's saved profile. No free search engine can guarantee unattended access on every network; Brave can also present a challenge.

**Take over** gives you browser control for verification, sign-in, or other page interaction. Manual takeover on ordinary pages stays paused until **Resume**. The chat does not ask for a password, and password fields are not read or filled. Research and ordinary navigation do not ask for approval on every click. Sending a message, paying, publishing, deleting remote content, uploading a file, and similar actions show the control and the page and wait for confirmation. A search does not. A familiar button label is not treated as proof that the click is harmless.

Limits for one task: 12 browser actions, 5 tabs, 20 seconds for navigation, and 8 seconds for other browser actions. Hitting a limit stops with the result so far. Those steps share the task’s model-call budget. Search is always available. The other browser tools are added when the browser is already open or the request is about opening or using a page. File and terminal tools are added when the request is about files or commands. A request can also ask for one of those groups and receive it on the next step. A closed browser does not add browser definitions to an unrelated message.

The browser is not isolated from your local network. Typed addresses must be `http` or `https`, and a local proxy checks the connections it handles, including redirects, and refuses a host that resolves to a private or local address. Checking only the address in `page.goto`, or resolving a name once, would not cover every connection the browser can make. WebRTC is turned off as a best effort. Do not treat this as a guarantee that a page cannot reach your LAN. There is no trusted-host setting in this version.

## Limits

Context fitting is automatic. Riot Bot uses the model’s documented context length when the provider publishes one, or a capacity you enter under **Settings → Advanced → Model limits & context**. For OpenRouter, the public model list also supplies the output cap when available. This metadata is cached and is not a model completion. Without a documented or configured context size, automatic mode uses a labeled conservative limit of 32,768 tokens. Older chat is compacted toward about 12,000 fitted input tokens; a larger window does not send the whole transcript.

Reply allowance is automatic too. It starts at 8,192 tokens, includes model reasoning, and can grow after a truncated tool request or an empty reply that exhausted its allowance. Growth stays within the published output cap, context reserve, and an application ceiling of 32,768. Replies can continue across calls. Every call still checks time and spending limits. A custom manual reply cap remains available in Advanced; saved custom caps are preserved. An incomplete tool batch is rejected before any of its actions run, then retried within the same task limits. The old untouched 2,048-token setting migrates to automatic mode.

The manual input working budget, default 8000, applies only when context fitting is set to manual. It stays under **Settings → Advanced → Model limits & context**, with the per-response allowance and model-call cap. Ordinary use does not require tuning these controls.

Other defaults: 24 model calls per task and 10 minutes. Migration raises the old 12-call default only for automatic replies; custom caps remain unchanged. The last four calls include a reminder to finish the deliverable and reserve a final handoff instead of continuing optional polishing. Dollar limits are off until you enter both a spend cap and a price per million input tokens and output tokens. The app daily ceiling applies across bots. If a dollar cap is on and a price is missing, the call is refused. Figures are labeled estimated or reported. They are not a provider invoice. A cancelled or failed call that already left the app keeps a conservative estimate when the provider does not report usage. Compaction, retries, and tool follow-ups share the same budget. Riot Bot does not raise a spending limit to make a request fit.

Failed optional tools, such as a missing research page, return an error to the model so it can continue with successful sources. Stop, permissions, browser takeover, and task limits still pause or stop the task. Public fetches use the operating system's trusted certificates as well as Node's defaults, while retaining certificate validation and connections pinned to verified public addresses. Tool results remain stored up to each tool's size limit; chat details show a preview. Stored-result reads advance through the original source in bounded sections (24,000 characters in automatic mode, 1,600 in manual mode). Those sections stay in subsequent requests until normal history compaction; they are not clipped again on the next call. File search accepts a file or folder and includes a matching-line excerpt. Optional conversation compaction runs at most once per task; empty or truncated summaries cannot replace the previous summary or mark originals summarized.

Stop aborts the current task and blocks later model and tool calls in that task. Work the provider already accepted may still be billed. After a restart, an unfinished task is marked interrupted and is not resumed. Text that had already streamed is kept and marked interrupted.

A Playwright documentation task on November 1, 2026 paused after two successful model calls. The search could not run because Chromium was not installed, so the model fetched a docs page. That stored result was 5,316 characters, about 2,038 estimated tokens. The follow-up was about 6,738 estimated tokens before the fit margin, and about 8,086 after it: instructions near 1,731, tool definitions 2,619, plus the page, the short request, and the tool-call text. The 8,000 figure was the app’s assembly cap. The published OpenRouter context length for the selected model was 1,048,576 tokens. The follow-up was refused before it was sent, and the tool details still said Completed.

Automatic mode no longer treats 8,000 as that ceiling. Long tool results stay stored and the model request gets a short preview, with a way to read another section. If the provider rejects a request for context length, Riot Bot rebuilds a smaller request and retries once. A message that itself does not fit asks for a smaller message or a workspace file. Instructions and tool definitions that cannot fit the selected model are reported as a configuration problem. A dollar limit is reported as a spending limit.

## Context

Open a call in **Activity** and expand **Context**. It shows the usable input, whether that size came from the provider, a capacity you entered, the conservative fallback, or the manual budget, the reply allowance, the estimated input size, provider-reported input tokens when the provider sent them, and the estimated size of instructions, memories, summary, skills, history, and tool definitions. It names the memories and skills that were included, says whether a summary step ran, and says whether older messages were left out. Estimates and provider measurements are labeled separately. The panel does not show API keys or hidden reasoning.

Deleting a memory or disabling a skill removes it from later requests. The original chat can still contain the earlier mention.

## Architecture

The Electron main process is the trusted side. It owns SQLite (`node:sqlite`), credentials, provider calls, files, processes, and the Chromium window. The React window is sandboxed: context isolation on, Node integration off, and a small typed preload bridge. Remote pages stay in Chromium. They are not loaded in the Electron renderer. Markdown is rendered with raw HTML disabled. Code is shown as text. Avatar images are local data URLs, not remote content. Page text is untrusted and cannot change your instructions, permissions, budgets, or which bot is acting.

Every model call goes through one gateway with a run id. A call starts only from a message you send, a bot-setup request you start by creating a bot without a name, or the provider check you start. Status lines, avatar choices, and browser installation do not call a model. The gateway reserves a conservative cost before the call and settles it afterward, including after a crash. Compaction, retries (at most two transient retries), browser follow-ups, and tool follow-ups share the same task budget. The mock provider is used by tests and is never called on launch.

Each request is built from the bot profile, pinned instructions, pinned memories, the rolling summary, the current task, a few retrieved memories, a short skill catalog, and recent messages that fit the input budget. The full skill text is loaded only when a tool asks for it. Older text stays in SQLite and can be searched, including the messages around a match. There is no embeddings index.

Web fetches resolve the host, refuse the request if any address is local or private, and connect to a resolved address while keeping the original Host header and the normal HTTPS certificate check. Each redirect is checked again. TLS verification is not turned off. The browser’s local proxy does the same kind of check for connections it handles. That does not make the browser isolated from the local network.

## Packaging

```powershell
npm run dist:win
```

This writes an unsigned installer:

`release\Riot-Bot-Setup-0.1.0.exe`

`playwright-core` is unpacked from the app archive so the packaged app can run the Chromium installer. An unpacked Windows build was checked on November 1, 2026: `release\win-unpacked\resources\app.asar.unpacked\node_modules\playwright-core\cli.js` is present. Chromium itself is downloaded into `%APPDATA%\riot-bot\playwright-browsers` when you choose Install Chromium, including after a restart. The NSIS installer was not rebuilt for this version. It is not code-signed and uses the default Electron icon. Windows SmartScreen and antivirus software can warn about it.

## Tests

```powershell
npm run check
```

The November 1–2, 2026 review and follow-ups expanded the suite from 69 to 169 tests. `npm run check` passes TypeScript checks, all 169 tests, and the production build. The latest regressions cover reasoning-only responses, invalid tool JSON, recoverable page failures, persistent bounded reads, matching a specific file, unfinished summaries, remaining-step warnings, and saved-default migration. Node 22 prints `ExperimentalWarning: SQLite is an experimental feature` while the tests run. Model calls in the automated suite use mocks. Four offline DOM tests use an installed browser and skip explicitly if none is available; they passed on this machine. Passing the checks does not mean every provider model accepts tools, streaming, images, or the same context size.

Additional desktop checks used isolated app data and exercised 80-message pages, scroll preservation, saved failed outcomes, actual PNG/JPEG decoding and resizing, screenshot paste, the file-picker handler, bot separation, pending-upload persistence across restart, message previews, and app-wide Activity after task completion. The history test visits 2,081 messages with identical timestamps without skips or duplicates. No renderer errors were recorded.

Live checks used a verified restoration of app data, the saved Windows-encrypted key, and the selected `deepseek/deepseek-v4.1-flash-1017` model through OpenRouter. The exact Google query `angelicpedia.com` returned Angelicpedia at organic position 1 in the observed US/English page on November 1, 2026; that completed three-call run reported $0.00083484324. A separate one-call image/text check correctly named the synthetic red square, blue circle, and attached code word; it reported $0.000635877. Search used the free browser route. These are observations of those runs, not a permanent ranking or a provider invoice. No normal app-data chats or settings were used as test fixtures.

The Brave follow-up also passed an actual search through the browser tool: the homepage was first and Azrael second, while the nested Christianity sitelink was excluded. Closing the real browser context was detected and the next search reopened it. A separate selected-model run included a synthetic old Google/Chromium error, then successfully used Brave and reported the homepage first without appending an unrelated answer. It used two model calls and reported $0.0002832786. Human-check recovery, reader failures, explicit engine changes, saved-default migration, and a window closing mid-action have regression tests.

An isolated Electron smoke check also verified startup, the renderer sandbox and preload bridge, the New Bot form, saved settings, named-bot creation, bot switching, and separate unsent drafts. Its database and workspaces were temporary, it reported no renderer errors, and Activity stayed at zero model calls. It did not use the normal app-data directory.

Covered: one ongoing conversation after restart, with an earlier chat left intact; a short workspace question with the current tool set and a saved summary; a long conversation that drops older history before refusing; overhead that names Settings instead of the message; automatic fitting that sends a request whose estimate exceeds the old 8,000-token cap; a mock search, open, and stored-section read; one context-length retry that does not repeat the tool; compaction that does not fold the same messages twice; a spending block that stays distinct from context; catalog lookup only for OpenRouter and not on idle; same-bot recall and no cross-bot leakage; migration and a second startup; renaming without moving the workspace; setup calls through the gateway and absent on idle; a bot switch during a run; the app-wide daily ceiling; reactions; avatars; Markdown; scroll stickiness; idle launch and restart; compaction; retries; dollar limits; stop; path checks; command approval; credential redaction; private-network web fetches; browser profiles, stale element references, takeover, cancellation, consequential-click confirmation, and blocked destinations; streamed tool calls; and the provider-check preview making no call.

The earlier browser-only smoke check downloaded Chromium and read a public page without a model call. The later selected-model checks described above exercised the assistant through the provider and browser tools.

The running window was also checked at 1180 and 880 pixels wide. The sidebar stayed a vertical bot list with New Bot, avatars, a selected-bot marker, and the bot menu. Earlier conversations still listed a saved chat. Switching bots kept each unsent draft with that bot. No model call was made.

## Known limitations

- Recall is summary plus search, not a full replay of every past message. If the saved messages do not establish an answer, the assistant is instructed to say so.
- A deleted memory or disabled skill leaves later requests, but older messages that mention it remain in the transcript.
- Dollar figures can differ from the provider bill. A missing price blocks dollar-budget mode; it does not invent a price.
- An API terminal command is not sandboxed. Approval is per exact command. Codex uses its own sandbox and approval rules; its legacy Windows policy permits broader filesystem reads.
- Stop ends the command tree through `taskkill /T /F` on Windows. A process that already detached can survive, and that case is reported when the stop call fails.
- Web fetch uses the first public address after refusing any host that also resolves to a private address. TLS verification stays on.
- The browser is not isolated from the local network. The proxy covers connections it handles. It does not prove that every browser subrequest is blocked.
- The secret check only catches common patterns.
- File undo is refused if the file changed after the edit.
- Images in model Markdown are not loaded. `http` and `https` links open externally. Avatar uploads are stored locally.
- One task runs at a time. Nothing runs on a timer, and skills are not learned in the background.
- Typed drafts survive a bot switch in the same session and are not written to disk. Pending file and screenshot attachments are persisted.
- No accounts, sync, telemetry, plugin marketplace, or extra agents.
- Automatic mode uses a documented context length, a capacity entered in Advanced, or the labeled 32,768-token fallback. It does not discover a window for every provider. OpenAI’s model list does not supply one.
- The earlier provider check’s cancellation step did not pass. These mock tests do not rerun that live check.
- The installer is unsigned and does not yet include this version.

## First browser task

This does not call a model until you send a message. Installed Chrome or Edge can be used without downloading Chromium.

1. `cd riot-bot` then `npm run dev`.
2. Open **Customize bot → Browser & website sign-ins** and check the available browser. If none is available, choose **Install Chromium** and wait for the size and progress line.
3. Choose **Open Browser**. A normal browser window opens using that bot’s separate profile.
4. In the ongoing chat, ask it to search for something and open one of the results. Search has no separate API fee. The model calls that read the pages still use your normal task budget.
5. For a site that needs a login, choose **Use browser myself**, sign in yourself in that window, then choose **Let bot continue**. Do not paste the password into chat.
6. If it wants to send, pay, publish, delete, or upload, read the preview and confirm or deny it.
7. Stop cancels the current task and leaves the profile in place. **Close Browser** closes the window and also leaves the profile in place.

## First real-provider check

This uses API credits. Do it only when you want that.

1. `cd riot-bot` then `npm run dev`.
2. Open **Settings**. Choose OpenAI or OpenRouter, paste the model ID from that provider and your API key, and choose **Save settings**.
3. If a task or daily dollar cap is filled in, also enter the input and output prices per million tokens. Leave the dollar boxes blank to use call and token limits only.
4. Choose **Save settings**.
5. Open **Advanced → Test your saved connection** and choose **Preview provider check**. Read the credit note. It allows at most 4 calls and 64 output tokens each. It does not contact the provider yet.
6. Choose **Start provider check**. It asks for a short reply, a harmless memory-list tool call, a follow-up that uses that result, and then cancels one request.
7. Read the four results. Open **Activity** and confirm the calls are labeled `provider_check`, with estimated or reported cost. A model that does not call the tool is reported as not verified for that step.
8. Quit and reopen. Confirm Activity did not gain a call while the app was idle.

A pass on one model ID does not establish that another model ID works.

## Next command

```powershell
cd riot-bot
npm run dev
```
