# Riot Bot user guide

This guide covers everyday use of Riot Bot in detail. For an overview and installation, start with the [README](../README.md). Feature-specific documents cover [Gmail](gmail.md), [web search](web-search.md), [reminders and schedules](scheduling.md), [tasks and saved files](jobs-and-library.md), [saved logins and permissions](security.md), [quiet memory and skill reviews](quiet-learning.md), [local and custom model endpoints](custom-endpoints.md) and the [Codex preview](codex.md).

## Finding your way around

Start in Chat with **Let’s set up**. **Settings** at the bottom of the left sidebar manages shared connections and the default model for new bots. **Bot settings** at the bottom of the right Workspace sidebar controls the selected bot’s model, profile, working folder, tools, and limits. Save the app default, then use **Bot settings → Model → Use app default** to apply it to an existing bot. New bots start with the app default automatically. A starter idea fills your draft without sending it. Trying to send before connecting opens setup and keeps your draft.

The right Workspace sidebar includes **Apps**, where you connect Gmail and choose the selected bot’s access. Account sign-in is shared across Riot Bot, while app access stays separate for each bot. Shared Gmail account management is also available in **Settings → Email**. The right sidebar uses **Tasks** for work in progress, **Files** for saved versions, and **Memories** for facts and preferences. **Usage & activity** is below Settings on the left. Empty screens explain how to get started. **New bot** offers a few starting ideas and starts with the app-wide default provider and model. Its default name avoids a naming request; connection overrides, folders, and appearance are optional disclosures.

**Bot settings** has **Profile & browser**, **Model**, **Files & tools**, **Limits**, and **Advanced**. Model/context tuning and the optional connection test live in Advanced. Profile & browser contains its name, purpose, extra instructions, icon, browser, earlier conversations, and deletion. Shared credentials, display preferences, the app-wide spending ceiling, and defaults live in the left sidebar’s app Settings. Defaults are seeded once from the previously selected bot on upgrade; later changes apply to new bots and do not switch existing bots. Chat shows the current provider and model below the bot’s name. The working status and View tasks stay together above the composer, using the same content width. Choosing a different working folder turns editing off in the form until you explicitly enable it and save. Existing saved permissions are preserved.

## First browser task

This does not call a model until you send a message. Installed Chrome or Edge can be used without downloading Chromium.

1. From the repository folder, run `npm run dev` (see the [quick start](../README.md#quick-start)).
2. Open **Bot settings → Profile & browser → Browser & website sign-ins** and check the available browser. If none is available, choose **Install Chromium** and wait for the size and progress line.
3. Choose **Open Browser**. A normal browser window opens using that bot’s separate profile.
4. In the ongoing chat, ask it to search for something and open one of the results. Search has no separate API fee. The model calls that read the pages still use your normal task budget.
5. For a site that needs a login, choose **Use browser myself**, sign in yourself in that window, then choose **Let bot continue**. Do not paste the password into chat.
6. If it wants to send, pay, publish, delete, or upload, read the preview and confirm or deny it.
7. Stop cancels the current task and leaves the profile in place. **Close Browser** closes the window and also leaves the profile in place.

## First real-provider check

This uses API credits. Do it only when you want that.

1. From the repository folder, run `npm run dev` (see the [quick start](../README.md#quick-start)).
2. Open **Settings**. Choose OpenAI or OpenRouter, paste the model ID from that provider and your API key, and choose **Save settings**. For a local or custom model, enter its endpoint address, context length, and model name instead; a local server does not use API credits.
3. If a task or daily dollar cap is filled in, also enter the input and output prices per million tokens. Leave the dollar boxes blank to use call and token limits only.
4. Choose **Save settings**.
5. Open **Advanced → Test your saved connection** and choose **Preview provider check**. Read the credit note. It allows at most 4 calls and 64 output tokens each. It does not contact the provider yet.
6. Choose **Start provider check**. It asks for a short reply, a harmless memory-list tool call, a follow-up that uses that result, and then cancels one request.
7. Read the four results. Open **Activity** and confirm the calls are labeled `provider_check`, with estimated or reported cost. A model that does not call the tool is reported as not verified for that step.
8. Quit and reopen. Confirm Activity did not gain a call while the app was idle.

A pass on one model ID does not establish that another model ID works.

## Bots and chats

The sidebar is **New Bot** and a vertical list of bots. Each row shows the avatar and display name. The selected bot has a marker. Click a bot to open its ongoing conversation. The selected bot is remembered after a restart.

**New Bot** creates another assistant with exactly one ongoing conversation. The purpose is required. Leave the name blank to let one setup request suggest a name and initial instructions, or type a name and skip that request. The setup request is labeled `bot_setup`, has no tools, and follows the same spending limits. If no model is configured, or the reply is not usable, the bot is still created with a name taken from the purpose.

There is no New Chat button. Compaction, memory, and history search stay automatic. A bot that already had several chats keeps every message. The most recently active chat becomes the ongoing conversation. The others stay in the bot menu under **Earlier conversations**, and search there stays on that bot. Those chats are read-only. New messages go to the ongoing conversation. Nothing is merged or deleted.

Right-click a bot, use its **…** button, or press **Shift + F10** on its row for **Rename bot**, **Bot settings**, **Open working folder**, and **Delete bot**. Opening the menu keeps the current chat; choosing an action selects the bot you clicked. Rename preserves its conversation and setup. Delete opens a confirmation naming that bot, with Cancel focused by default. Confirming removes it without requiring you to type its name. Delete is disabled while that bot is working, and the service checks again before deleting.

**Bot settings → Profile & browser** also opens the selected bot’s controls in the main panel: rename, purpose, instructions, avatar, **Open Workspace**, earlier conversations, Settings, and browser controls. Its **Delete this bot** option uses the same confirmation. Deletion discards the bot’s queue and removes Riot Bot’s chats, memories, skills, schedules, Library copies, avatar and browser profile. The project folder, shared provider sign-ins, anonymous usage totals and Codex’s managed session history remain. Other bots stay intact. You can delete the last bot and create another from the empty app.

You can also rename a bot from its Chat. A message that opens with a request such as “Call yourself Scout” or “Change your name to Scout” saves that exact name right away. A request without a clear name, such as “pick a better name for yourself” or a lowercase name, lets the bot choose one. Everyday phrases such as “go by the spec”, quoted text, and scheduled tasks do not rename a bot.

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

Open the left sidebar’s **Settings → Connections & default model**.

For **ChatGPT account**, sign in with ChatGPT, choose a model from the account’s picker, and choose **Save app settings**. This uses the Codex preview connection and requires the official Codex CLI. Full instructions and permission differences are in the [Codex guide](codex.md).

For **OpenAI API** or **OpenRouter**:

1. Choose the connection card for your provider.
2. Paste your API key. If a key is already saved, leave the box empty to keep it.
3. Copy the exact model ID from that provider’s catalog into Model ID. Riot Bot does not select or substitute an API model.
4. Choose **Save app settings**. New bots start with this model. For an existing bot, open **Bot settings → Model → Use app default**, then save that bot’s settings.

A ChatGPT Plus, Codex, or Cursor subscription does not supply this key. The key is shared by every bot. Keys stay in the main process. The window only learns whether a key is saved. When Windows credential protection is available, a saved key survives restart. If that protection is unavailable, the key is kept in memory for the session and forgotten on quit.

That statement applies to the API-key backends. Codex has its own authentication, native tools, permissions, and usage limits. A Codex quota or authentication failure never switches to an API key.

OpenAI requests go to `https://api.openai.com/v1/chat/completions`. OpenRouter requests go to `https://openrouter.ai/api/v1/chat/completions`.

For **Local or custom model** (Ollama, LM Studio, vLLM, or another OpenAI-compatible endpoint):

1. Start your model server. Choose the **Local or custom model** card.
2. Enter the endpoint address, for example `http://localhost:11434/v1` for Ollama or `http://localhost:1234/v1` for LM Studio. Plain `http://` is accepted only for `localhost`, `127.0.0.1`, and `[::1]`. Any other server must use `https://` and a public address. Servers elsewhere on your home or office network are refused for now.
3. Enter the context length your server runs the model with, and the model name your server uses.
4. Paste an API key only if the endpoint needs one. It is optional, saved in the same Windows-protected store as other keys, and never written to settings.
5. Choose **Save app settings**.

Custom endpoint requests go to the address you saved plus `/chat/completions`, and nowhere else. The address and its DNS answers are checked before every request, the connection is pinned to the checked address, and redirects are not followed. The key is sent only to that endpoint. Pricing is unknown, so dollar limits stay blocked until you enter both prices for the bot; call, time, and output limits still apply. A failure stops the task; Riot Bot never switches to another connection. Details are in [local and custom model endpoints](custom-endpoints.md).

## What you can ask it to do

Chat hides successful **Completed · … actions** rows by default. Turn on **Settings → Preferences & spending → Show completed actions in Chat** to see expandable action history across all bots. This global preference saves immediately. Errors, interrupted work, approval requests, file links/Undo, and the bot's reply remain available. Full logs stay in **Usage & activity**.

Riot Bot’s API file tools stay inside the selected bot’s workspace. File creation and editing stay off until **Allow Riot Bot to create and edit files in this folder** is checked. Each app-made edit can be undone from the chat if the file has not changed since. The API workspace is not an operating-system sandbox. Codex uses its native sandbox and file tools; its edits do not have Riot Bot’s Undo button, and its legacy Windows policy permits broader reads. See the [Codex guide](codex.md#permissions-and-sessions).

An API terminal command is shown with its working folder and time limit, and it runs only after you approve that exact command. The workspace folder does not contain the API shell.

To give a bot a server, paste the PuTTY, plink or sshpass command you already use, password included, for example `"C:\Program Files\PuTTY\putty.exe" root@192.168.10.20 -pw …`. Riot Bot saves the login encrypted for that bot and replaces the password in your message with `[saved password]` before the message is stored or sent to the model. A short notice in the chat confirms what was saved. Then ask for what you need (“check the disk space on my server”). The bot uses **run on server**: you approve each exact command, and Riot Bot runs it through PuTTY’s `plink.exe` with the saved password. Install PuTTY if it is missing (`winget install PuTTY.PuTTY`). Riot Bot never accepts a new or changed server key on its own, so connect once in PuTTY first to check and accept the key. Pasting the command again with a new password updates the login. See [saved logins and permissions](security.md#save-a-server-login). Codex follows its native approval rules: safe read commands can run automatically, and native requests that need approval appear in Riot Bot.

API and native Codex bots can use **get_disk_space** (`riot_get_disk_space` in Codex) to read capacity from Riot Bot’s runtime. It reports bytes and decimal GB for a local drive or folder, defaulting to the bot’s working folder. It requires tools but not editing. Network shares, mapped drives and remote link targets are refused. A fixed noninteractive Windows helper classifies local drives; no model-provided command is executed and no terminal approval is needed. Unavailable values are errors, with a full disk distinguished from missing counters.

`fetch_url` is still the lightweight tool for a straightforward public page. The browser is for JavaScript pages, search, and interaction.

Say `remember this: …` to save that wording locally right away. The chat reply still uses your model. A guess is saved when you explicitly ask to remember it, and you can correct or delete it afterward. Obvious secret patterns are blocked. That check does not catch every secret.

**Bot settings → Memory & skills** has independent switches for **Automatic memory** and **Suggest reusable skills**, both on by default. One short, quiet review after a successful chat reply checks for important durable preferences, project facts, and confirmed decisions, and for useful repeatable procedures. It can save one evidenced memory; a skill always waits for **Save skill**. Say `Turn off automatic memory`, `Stop suggesting skills`, or `Turn off both background checks` to change these settings for the current bot. Existing notes and skills stay available, and explicit save requests still work. Reviews use the bot's current connection/model and appear as **Memory & skill check** in Usage & activity. They consume extra API usage or native Codex allowance. See [quiet learning](quiet-learning.md) for limits and behavior.

A memory is a fact or preference. A skill is a procedure. Say `Save this workflow as a skill.` or `Update that skill with the correction we just discovered.` to save or update one. After a substantial task, Riot Bot may show a preview with **Save**, **Edit**, and **Dismiss**. Nothing about later chats changes until you save it. Skills cannot grant permissions, raise a budget, or override the app rules. The **Skills** screen lists, edits, disables, deletes, and restores versions. Markdown export and import are text only: import shows a preview first, adds the skill disabled, and does not run code or install anything. The catalog added to a request is at most eight short descriptions, and about 400 estimated tokens.

## Browser

Each bot’s browser data is under `%APPDATA%\riot-bot\browser-profiles\<bot id>`. Bundled Chromium uses that profile directly. Installed Chrome and Edge use separate `chrome` and `msedge` subfolders there; your personal browser profile is not opened. Cookies and site storage persist across restarts. Another process cannot open the same profile at the same time. The window opens only when you choose **Open Browser** or a task you sent needs it. Launch and idle time do not open it and do not call a model. **Close Browser** closes the window and keeps the profile. Stop cancels the browser action in progress. It does not erase the profile or undo a page that already loaded. After a restart, an unfinished browsing task is not resumed.

A signed-in page can keep making ordinary website requests while that window is open. That traffic is not a model call. Zero idle model calls does not mean zero network traffic from a page you left open.

The bot menu shows the available browser. Riot Bot prefers its downloaded Chromium when present, and can otherwise use installed Google Chrome or Microsoft Edge on Windows. No separate download is required when one of those browsers is available. **Install Chromium** remains an optional download from Playwright’s browser distribution into `playwright-browsers`. The progress line includes the download size. It is not a model charge, and it does not start on launch. The app uses a visible browser with its sandbox on. Pages are not embedded in the window.

Browser tools can list and switch tabs, open an `http` or `https` URL, read the page, take a snapshot with element references, click, fill, pick a dropdown option, press a key (Enter, Escape, Tab, arrows or a shortcut), hover, drag one element onto another, wait for text or an address to appear, scroll, go back, close a tab, and search. There is no tool for arbitrary page scripts, a shell inside the page, or the browser’s debugging protocol.

A snapshot covers the whole page, not only what is on screen. It lists on-screen elements first and then the rest, and references to elements further down work without scrolling. It reaches into frames and open shadow DOM, shows each element’s state (checked, selected, disabled, expanded, required, invalid) and current value, and can be narrowed with a search word. Password, payment-card and one-time-code fields never show their value, only whether they are filled. An element inside a frame from another site needs that site’s access. A reference belongs to one tab and one snapshot. A stale or ambiguous reference is rejected.

A confirmation, prompt or leave-page dialog is dismissed unless the bot sets **accept dialog** for an action you asked for. Every dialog is reported back to the bot, and a simple alert is acknowledged.

For a model that accepts images, **page screenshot** sends a picture of the visible page with each element’s reference drawn on it. A screenshot that would push conversation history out of the request is left out. If the model refuses images, Riot Bot retries once without the picture and stops offering screenshots for the rest of the task. Native Codex bots do not get screenshots, because Codex tool results are text only.

A file the bot uploads must come from its workspace and be at most 25 MB, and Riot Bot asks before every upload, even on a website you trust. The card names the file, its size and the website. Riot Bot reads the file first, so the website receives exactly the bytes you approved. Project secret files follow the **Allow project secrets** setting.

A click or key press that starts a download saves the file into the workspace’s `Downloads` folder, up to three files per action and 100 MB each. Riot Bot never overwrites a file: a second `report.csv` becomes `report (2).csv`. Shortcut files such as `.lnk` and `.url` are refused, and each saved file is marked as coming from the internet so Windows warns before running it. Downloads need file editing on for that folder. A download that starts on its own, with no bot action behind it, is cancelled.

Browser search is used when **Settings → Web search** is set to **Use the browser**, or when you ask for a specific engine such as Google. Otherwise ordinary research uses keyless web research; see [Web search](web-search.md).

In browser mode, search opens a public search page in that browser. The default template is `https://search.brave.com/search?q={query}`. You can explicitly request Brave, Google, or DuckDuckGo, or set another public `https` template containing `{query}` under **Bot settings → Advanced → Web search settings**. There is no separate search API fee. The model still spends tokens from the task budget to read the results. Snippets are only a way to find a page. Open the source before treating a detailed claim as verified, and include the source URL. Brave result numbers count parent web cards, excluding ads and grouped sitelinks. Only the returned numbered cards were observed; eight cards do not establish a top-ten sweep.

An explicit Google search uses Google even when the default is Brave. The tool accepts `engine: "google"`, `"brave"`, `"duckduckgo"`, or `"default"`. A request such as “forget Google” overrides a stale Google tool argument. It keeps the exact query and records the engine, actual results URL, observation time, and observed organic result cards. Ads and grouped sitelinks are excluded from the numbered cards. The explicit Google route requests US English results with personalization off; it is one observation, not a universal SEO rank. Another engine's result numbers do not establish a Google position.

Search remains free and uses no extra search-service key. A CAPTCHA pauses the task without another model call or alternate-URL retries. Its notice has **Take over browser** and **Resume browser** controls. Complete verification, choose Resume browser, and send the request again. A new request to inspect a solved search challenge can also reread that pending search. Riot Bot reuses the existing results instead of starting the search over; a retry with an unspecified engine keeps the pending search's engine. Resume alone does not start a model call. A result-reader failure is reported separately and leaves browser control available; it does not ask you to sign in. A window closed during an action pauses the run, and the next request reopens the bot's saved profile. No free search engine can guarantee unattended access on every network; Brave can also present a challenge.

**Take over** gives you browser control for verification, sign-in, or other page interaction. Manual takeover on ordinary pages stays paused until **Resume**. Saved-login tools fill passwords locally on the exact saved HTTPS site; general fill tools cannot fill password fields. New interactive sites need site access, which you can remember to allow later clicks and fills without repeated prompts. This includes actions that send, pay, publish or delete on that site. Button labels never grant authority. Uploads still ask every time. Public research follows exact user/source links; generated destinations and search after private-source reads need their site's access. See [the permission scopes and limits](security.md).

Limits for one task: 50 browser steps by default, 8 tabs, 20 seconds for navigation, 8 seconds for other browser actions, and 20 seconds for one wait. Change the step limit for each bot, from 5 to 200, under **Bot settings → Limits → Browser steps per task**. Hitting a limit stops with the result so far. Those steps share the task’s model-call budget. Search is always available. The other browser tools are added when the browser is already open or the request is about opening or using a page. File and terminal tools are added when the request is about files or commands. A request can also ask for one of those groups and receive it on the next step. A closed browser does not add browser definitions to an unrelated message.

Typed addresses must be public `http` or `https`. A local proxy validates destinations and pins connections to public addresses, including for redirects. Chromium policy prevents non-proxied WebRTC traffic; real Chrome and Edge STUN/TURN tests check this boundary. The static checker additionally uses a deny-all proxy. These are tested transport restrictions, not a formal guarantee for every future browser version or protocol. Remembered site access does not bypass the private-address restrictions.

## Limits

Context fitting is automatic. Riot Bot uses the model’s documented context length when the provider publishes one, or a capacity you enter under **Bot settings → Advanced → Model limits & context**. For a custom endpoint, the context length saved with that connection applies unless the bot has its own capacity. For OpenRouter, the public model list also supplies the output cap when available. This metadata is cached and is not a model completion. Without a documented or configured context size, automatic mode uses a labeled conservative limit of 32,768 tokens. Older chat is compacted toward about 12,000 fitted input tokens; a larger window does not send the whole transcript.

Reply allowance is automatic too. It starts at 8,192 tokens, includes model reasoning, and can grow after a truncated tool request or an empty reply that exhausted its allowance. Growth stays within the published output cap, context reserve, and an application ceiling of 32,768. Replies can continue across calls. Every call still checks time and spending limits. A custom manual reply cap remains available in Advanced; saved custom caps are preserved. An incomplete tool batch is rejected before any of its actions run, then retried within the same task limits. The old untouched 2,048-token setting migrates to automatic mode.

The manual input working budget, default 8000, applies only when context fitting is set to manual. It stays under **Bot settings → Advanced → Model limits & context**, with the per-response allowance and model-call cap. Ordinary use does not require tuning these controls. In manual mode, 8000 tokens holds the instructions with the file and terminal tools, but not with the browser tools as well; a request that needs all three pauses before anything is sent and asks for a larger budget. About 12,000 leaves room for the conversation too.

Other defaults: 24 model calls per task and 10 minutes. Migration raises the old 12-call default only for automatic replies; custom caps remain unchanged. The last four calls include a reminder to finish the deliverable and reserve a final handoff instead of continuing optional polishing. Dollar limits are off until you enter both a spend cap and a price per million input tokens and output tokens. The app daily ceiling applies across bots. If a dollar cap is on and a price is missing, the call is refused. Figures are labeled estimated or reported. They are not a provider invoice. A cancelled or failed call that already left the app keeps a conservative estimate when the provider does not report usage. Compaction, retries, and tool follow-ups share the same budget. Riot Bot does not raise a spending limit to make a request fit.

Failed optional tools, such as a missing research page, return an error to the model so it can continue with successful sources. Stop, permissions, browser takeover, and task limits still pause or stop the task. Public fetches use the operating system's trusted certificates as well as Node's defaults, while retaining certificate validation and connections pinned to verified public addresses. Tool results remain stored up to each tool's size limit; chat details show a preview. Stored-result reads advance through the original source in bounded sections (24,000 characters in automatic mode, 1,600 in manual mode). Those sections stay in subsequent requests until normal history compaction; they are not clipped again on the next call. File search accepts a file or folder and includes a matching-line excerpt. Optional conversation compaction runs at most once per task; empty or truncated summaries cannot replace the previous summary or mark originals summarized.

Stop aborts the current task and blocks later model and tool calls in that task. Work the provider already accepted may still be billed. After a restart, an unfinished task is marked interrupted and is not resumed. Text that had already streamed is kept and marked interrupted.

Automatic mode does not treat the 8,000-token manual budget as a ceiling (see the [November 1 incident](../CHANGELOG.md#context-limit-incident--november-1-2026) that led to this). Long tool results stay stored and the model request gets a short preview, with a way to read another section. If the provider rejects a request for context length, Riot Bot rebuilds a smaller request and retries once. A message that itself does not fit asks for a smaller message or a workspace file. Instructions and tool definitions that cannot fit the selected model are reported as a configuration problem. A dollar limit is reported as a spending limit.

## Context

Open a call in **Activity** and expand **Context**. It shows the usable input, whether that size came from the provider, a capacity you entered, the conservative fallback, or the manual budget, the reply allowance, the estimated input size, provider-reported input tokens when the provider sent them, and the estimated size of instructions, memories, summary, skills, history, and tool definitions. It names the memories and skills that were included, says whether a summary step ran, and says whether older messages were left out. Estimates and provider measurements are labeled separately. The panel does not show API keys or hidden reasoning.

Deleting a memory or disabling a skill removes it from later requests. The original chat can still contain the earlier mention.

## Backups and removing the browser

Riot Bot keeps its data in `%APPDATA%\riot-bot\`; the [README](../README.md#where-your-data-lives) lists what each file and folder holds.

To remove the browser without touching chats, quit the app and delete `playwright-browsers` and `browser-profiles`. Deleting a profile removes that bot’s signed-in site storage. Do not delete the database to uninstall Chromium.

For a full backup, preserve the database, encrypted credentials, avatars, complete browser profiles, and the Codex profile when connected. A source ZIP or Git bundle does not contain these. Workspace files are separate and need their own backup. Quit Riot Bot and its browser windows before an ordinary folder copy; for a running database use SQLite's backup API rather than copying its hot WAL files. Restore into a separate folder, check the database and file hashes, and keep the current app-data folder aside before replacing it. Do not mix a restored database with an older WAL/SHM pair. Credentials and browser sign-ins can depend on the same Windows account and machine. Keep app-data archives private.
