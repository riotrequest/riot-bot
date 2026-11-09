# Changelog

This file records notable changes to Riot Bot. No release has been published yet, so everything below is unreleased development of version 0.1.0, newest first, dated by when it landed.

Entries describe the app as it was on that date, and later entries can supersede earlier ones. For current behavior, see the [README](README.md), the [user guide](docs/user-guide.md) and the feature documents in [docs/](docs/).

## Unreleased

### November 9, 2026 — App icon and preview installer steps

- **App icon:** the app, its taskbar button and the installer now use Riot Bot’s “R” mark instead of the default Electron icon.
- **Preview installer:** the first releases will be an installer that is not code-signed. The README and [app updates](docs/updates.md) now explain the Windows SmartScreen warning, how to check the installer’s SHA-256 checksum, and how to update by running a newer installer.
- **Settings → Updates:** a copy that cannot update itself now says how to get a newer version instead of mentioning official installs.

### November 9, 2026 — Follow-up recall, steady bot voices and a clean quit

- **Follow-ups:** a message such as “use the same setup as last time” or “deploy it like before” is now matched against the bot’s memories using the recent messages, the summary’s objective and the working folder name. When one memory clearly fits, the bot reuses it and says which. When two fit about equally, it asks which you mean instead of guessing. This uses SQLite search only, with no extra model call, and never reads another bot’s memories.
- **Better memory matching:** retrieved memories no longer need to contain every word of your message, so “What is my tea preference?” finds “Prefers tea after lunch.” Pinned memories and instructions are unchanged.
- **Bot voices:** each bot has a voice that fits its role (engineer, editor, operator, chief of staff and others, or a practical teammate), shown under **What it helps with** in its profile. It is sent with every API and Codex request, so it survives restarts and summaries. Your extra instructions still win, and a voice cannot grant permissions or change budgets. New bots named by the setup request also get a short voice in their instructions. Changing a Codex bot’s name, purpose or instructions now starts a fresh native thread.
- **Quit:** quitting no longer logs `database is not open` from `jobs:list` and `app:getSnapshot`. The window now closes before the database, and requests that arrive during shutdown are refused. Queued jobs are still paused, running ones interrupted, and **Restart and install** still starts the installer only after a clean shutdown.

### November 9, 2026 — Built-in Windows updater

- In official Windows builds, Riot Bot checks GitHub Releases at startup. Open **Settings → Updates** to check again, download a signed update, and choose when to restart and install it.

### November 9, 2026 — Faster disk-space check

- The disk-space check now lists local drives with Windows’ built-in `mountvol` instead of starting PowerShell. The first check after a cold start no longer fails with “Windows could not identify local drives,” and **Stop** ends a check at once.
- A substituted drive letter (`subst`) is now refused like a network drive, because it is not a local volume. Check the folder it points to instead.

### November 8, 2026 — Published on GitHub

- The source is public at [github.com/riotrequest/riot-bot](https://github.com/riotrequest/riot-bot), with a project site at [bot.riotrequest.com](https://bot.riotrequest.com).
- Report vulnerabilities privately through GitHub or to security@riotrequest.com. [SECURITY.md](SECURITY.md) explains how.

### November 8, 2026 — MIT License

- Riot Bot is now released under the [MIT License](LICENSE). Contributions are accepted under the same terms.

### November 8, 2026 — Fuller browser control and saved server logins

- **Page snapshots:** a snapshot now covers the whole page instead of the first 40 elements, lists on-screen elements first, reaches into frames and open shadow DOM, shows element states and current values, and accepts a search word. Secret fields show only whether they are filled. An element in a frame from another site needs that site’s access.
- **New browser actions:** choose a dropdown option, press a key, hover, drag, wait for text or an address, and switch tabs. Fill can press Enter to submit. Confirmation dialogs are reported and dismissed unless the bot accepts one for an action you asked for.
- **Screenshots:** models that accept images can take a screenshot of the page with element references drawn on it. A model that refuses images falls back to snapshots. Native Codex bots do not get screenshots.
- **Uploads and downloads:** a bot can upload a workspace file after you approve that upload, on every website. A download started by the bot’s click or key press is saved into the workspace `Downloads` folder without overwriting anything; other downloads are cancelled.
- **Browser step limit:** the old fixed limit of 12 browser actions per task is now a per-bot setting, 50 by default, from 5 to 200.
- **Server logins:** paste a PuTTY, plink or sshpass command with its password and Riot Bot saves the login encrypted for that bot and removes the password from the message before it is stored or sent. The new **run on server** tool runs one approved command at a time through PuTTY’s plink, which alone receives the password. See [saved logins and permissions](docs/security.md#save-a-server-login).
- **Cleaner chat after saving a login or reply rule:** your message now shows only what you wrote, followed by a short notice such as “Saved your server login for …”. The login ID and instructions for the model no longer appear in your message bubble or the Tasks list; they go to the model only.
- **Screenshots in longer chats:** a screenshot is no longer left out just because the chat has earlier messages. It is left out only when it would push earlier messages out of the request.

### November 8, 2026 — Hard-linked files refused

- **File tools:** reading, searching, editing, Undo, the website checker and Library capture now refuse a file with more than one name (a hard link). Before this, a hard link inside a workspace could expose or overwrite a file outside it, including a `.env` under an innocent name. **Allow project secrets** does not lift the refusal. See [saved logins and permissions](docs/security.md#project-files-and-powerful-actions).

### November 8, 2026 — Local and custom model endpoints

- **Local models:** a **Local or custom model** connection works with Ollama, LM Studio, vLLM or another OpenAI-compatible server. Plain `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`; other servers must be public `https://` addresses. The address is checked and pinned before every request, redirects are not followed, and an optional key stays in the Windows-protected store. Dollar limits stay blocked until you enter prices. Not yet checked against a real Ollama, LM Studio or vLLM server. See [local and custom model endpoints](docs/custom-endpoints.md).

### November 8, 2026 — Keyless web research, Riot Bot notice popups and chat renaming

- **Web search:** **Settings → Web search** now defaults to **Automatic — free, limited**: keyless Tavily search with one Firecrawl fallback, over pinned endpoints. Each bot can make 40 research requests per day, saved keys have a separate account cap, and research after private sources needs approval for the service that will receive it. **Use the browser** and **Use my own connection** remain available. Bots with a custom search template move to browser mode (schema 15). See [Web search](docs/web-search.md).
- **Browser links:** a link seen only on a page in the bot's browser can still be opened there, but needs approval before it is sent to a reading service.
- **Notices:** reminders and job alerts use a Riot Bot popup instead of a Windows notification, shown only while Riot Bot is not the focused window. Job results from before a restart do not come back as cards. See [scheduling](docs/scheduling.md).
- **Renaming from chat:** a clear request with a capitalized or quoted name saves that name; a vague one lets the bot choose. Everyday phrases, quoted text and scheduled tasks do not rename a bot.
- **Gmail reply rules:** rules read exact mailboxes (display names and comments do not count, and encoded names are parsed before decoding), check every plain-text and HTML version of the original, and recheck the rule after the final source read, before claiming the send.

### November 4, 2026 — Gmail reply rules

A per-bot reply rule that you turn on can send only its exact saved text, and only to people already in the conversation. Refunds, exclusions, redirected recipients and unverified originals still wait for review. See [what a bot can do on its own](docs/gmail.md#what-this-bot-can-do-on-its-own).

### November 3, 2026 — Saved logins and security

Save website logins once in **Bot settings → Files & tools → Saved website logins**, or use the labelled chat format in [saved logins and permissions](docs/security.md). Passwords use Windows-protected storage and are filled locally on the matching HTTPS site. Browser sessions and per-bot site access persist. A new site can be allowed for one task or remembered, so normal work on an approved site does not ask for every click. Remembered access includes sharing information and changing content on that site; remove it in the same settings panel.

This follow-up fixes browser WebRTC bypasses, page-controlled approval bypasses, known-credential exposure in successful text results/streams, network paths in disk-space checks and credential deletion after encryption failure. Common project secret files need an explicit per-workspace grant. Electron packaging now has a fuse/integrity policy and a separate signing-required release command; CI checks code, dependencies and secrets. See the [security review and remaining limits](docs/security-review.md) and [contributor/AI guidance](AGENTS.md). Native Codex still has broader filesystem reads under its tested legacy Windows policy. This work does not publish a release.

### November 3, 2026 — Gmail

Connect an existing **Gmail / Google Workspace** mailbox in **Workspace → Apps → Gmail** using your own Google Desktop OAuth app setup file. Riot Bot connects directly from your computer; it does not host your mailbox or require a Riot Bot email account. [Set up Gmail](docs/gmail.md).

Enable access separately for each bot: no access, reading and drafts, or reading and drafts with a review before every send. Bots can search mail, read messages and conversations, and save plain-text replies in Gmail. Chat and scheduled bot work use the same connection and permissions. Sending shows every recipient and the full message, and records Gmail's confirmation. An uncertain send pauses rather than retrying automatically. Attachments, mailbox cleanup, multiple connected accounts, and unattended sending are not included in this first version.

### November 3, 2026 — Easier setup and everyday use

Start in Chat with **Let’s set up**. **Settings** at the bottom of the left sidebar manages shared connections and the default model for new bots. **Bot settings** at the bottom of the right Workspace sidebar controls the selected bot’s model, profile, working folder, tools, and limits. Save the app default, then use **Bot settings → Model → Use app default** to apply it to an existing bot. New bots start with the app default automatically. A starter idea fills your draft without sending it. Trying to send before connecting opens setup and keeps your draft.

The right Workspace sidebar includes **Apps**, where you connect Gmail and choose the selected bot’s access. Account sign-in is shared across Riot Bot, while app access stays separate for each bot. Shared Gmail account management is also available in **Settings → Email**. The right sidebar uses **Tasks** for work in progress, **Files** for saved versions, and **Memories** for facts and preferences. **Usage & activity** is below Settings on the left. Empty screens explain how to get started. **New bot** offers a few starting ideas and starts with the app-wide default provider and model. Its default name avoids a naming request; connection overrides, folders, and appearance are optional disclosures.

**Bot settings** has **Profile & browser**, **Model**, **Files & tools**, **Limits**, and **Advanced**. Model/context tuning and the optional connection test live in Advanced. Profile & browser contains its name, purpose, extra instructions, icon, browser, earlier conversations, and deletion. Shared credentials, display preferences, the app-wide spending ceiling, and defaults live in the left sidebar’s app Settings. Defaults are seeded once from the previously selected bot on upgrade; later changes apply to new bots and do not switch existing bots. Chat shows the current provider and model below the bot’s name. The working status and View tasks stay together above the composer, using the same content width. Choosing a different working folder turns editing off in the form until you explicitly enable it and save. Existing saved permissions are preserved.

### November 3, 2026 — Disk-space checks

API and native Codex bots can use **get_disk_space** (`riot_get_disk_space` in Codex) to read capacity from Riot Bot’s runtime. It reports bytes and decimal GB for a local drive or folder, defaulting to the bot’s working folder. It requires tools but not editing. Network shares, mapped drives and remote link targets are refused. A fixed noninteractive Windows helper classifies local drives; no model-provided command is executed and no terminal approval is needed. Unavailable values are errors, with a full disk distinguished from missing counters.

This avoids restricted native PowerShell/WMI queries for routine disk-space questions. Native instructions prefer this tool and discourage cycling through command variants after permission failures. Completed turns containing failed actions now show **Finished · … · … failed**, with streamed tool errors and timing matched to their recorded result.

### November 3, 2026 — Reminders and scheduled work

**Schedule** in the right Workspace supports reminders and bot tasks: once, daily, weekdays, or weekly. Ask in Chat (“Remind me to check email at 9 PM” or “Check the RLH email system every weekday at 8 AM”), or add one directly. Reminders show a Riot Bot popup without an AI call. The popup stays at the corner of the screen while Riot Bot is minimized, in the tray, or behind another window, and stays hidden while Riot Bot is the focused window. It is not a Windows alert. A job that needs attention while Riot Bot is not focused uses the same popup. Bot tasks save conversation context, use that bot’s current setup and usual approvals, and put their results in Chat and Tasks. Both API and native Codex bots expose the built-in scheduling tools; scripts and Windows scheduled tasks are unnecessary.

Schedules run while Riot Bot is open or in the tray and this computer is awake. Missed reminders catch up when Riot Bot resumes. Missed AI work waits for **Run now** rather than automatically repeating overdue work. Failed or stopped tasks pause their schedule. Edit, pause, resume, cancel, and the next run/result are available in Schedule. See [scheduling and recovery](docs/scheduling.md) for details.

Chat and the main panels scroll without a visible scrollbar; mouse wheels, touchpads, and keyboard scrolling still work. File changes stay in a collapsed **View files & undo** section, with each edit’s Undo control available inside.

### November 2, 2026 — Persistent jobs and saved files

Messages now become durable jobs. You can queue a follow-up while a bot works and switch to another bot. Two bots can run independently; each has its own provider, tools, browser, approvals and Stop control. Jobs sharing a workspace take turns. The **Tasks** view shows queued work, approvals and outcomes across one or all bots.

Closing the chat hides it in the Windows system tray while work continues. Double-click the Riot Bot tray icon to reopen; use its menu to stop all work or **Quit Riot Bot**. Quit interrupts active jobs and pauses the queue. Reopening does not replay interrupted work: choose **Resume** for work you want to continue. Future scheduled tasks run at their saved time. The computer must remain on and awake. This is a local desktop service; cloud/mobile control is not available.

The per-bot **Files** screen keeps versioned copies of files created or changed during a job, including partial results from a stopped job. Copies remain available after the workspace original changes or is deleted. Chat keeps short summaries and workspace file links. **Show in folder** reveals the version in Explorer; HTML does not render automatically. See [job, Library and verification behavior](docs/jobs-and-library.md) for bounds and recovery details.

API and native Codex bots can use **verify_website** for a static HTML file. It loads desktop and mobile viewports in fresh browser contexts, blocks external page requests, and saves screenshots plus a report. It checks initial script errors, missing local assets and horizontal overflow. It does not establish that every interaction, backend or visual detail works. General project commands still require approval.

### November 1, 2026 — Review fixes

Tool arguments are checked against their definitions before any action in a batch runs. Missing file contents, malformed JSON, and unknown tools pause without executing the batch. A cut-off tool batch is discarded and retried in smaller complete pieces within the task limits. Turning tools off is enforced in the main process, including while a terminal command waits for approval.

Incomplete provider streams fail instead of reporting success. Partial replies are kept, and a failed request is not automatically retried after text has streamed. Provider checks require observed streaming and an actual cancellation before marking those steps passed. Task deadlines abort in-flight requests; Stop also cancels a model-catalog lookup. Closing waits for replies, provider checks, and bot setup before closing the database.

Private-address checks now cover compressed and expanded IPv6 spellings and IPv4-mapped IPv6. Browser references expire across snapshots, navigation, and takeover, and are checked again after approval. Generic form buttons require confirmation. Closed tabs are removed from the live tab list.

History, memory, and skill search filter by bot before applying the result limit. Another bot's matching records cannot crowd out this bot's recall. File replacement refuses binary or non-UTF-8 files, enforces the write limit in bytes, and rejects Windows alternate data streams. Undo compares the exact bytes. Bot setup does not borrow prices from a different model.

`npm run check` runs TypeScript checks, tests, and a production build. Vitest was updated to 5.0.5. The production dependency audit has no reported advisories; the remaining 15 moderate advisories are in packaging development dependencies. The existing installer in `release` has not been rebuilt for these changes.

The follow-up adds paged history, saved per-turn outcomes, attachment uploads and screenshot paste, and preserves the All bots Activity filter when a task finishes. Provider and model-catalog requests use Electron's networking stack so they honor Windows trust and proxy settings; public web tools keep their separate address checks. Google result parsing preserves observed opaque redirect links and displayed destinations. Real browser and image/text tasks passed with the selected OpenRouter DeepSeek model on November 1, 2026.

The November 2 search follow-up makes Brave the default and upgrades saved DuckDuckGo defaults on startup, preserving custom templates. It reads parent result cards rather than counting grouped links, rereads existing results after human verification, distinguishes reader failures from sign-in requests, and detects closed browser contexts before reopening them.

Codex is now available as a preview backend through the official CLI and its managed ChatGPT sign-in. It runs Codex’s native agent loop, search, and tools alongside Riot Bot’s scoped memory/history/attachment tools. See [Codex setup and behavior](docs/codex.md). The separate API backends keep their existing tool loop and free Brave browser search. The [backend design](docs/subscription-backends.md) records the remaining Claude work.

## Upgrade notes

These notes apply to people who ran earlier development builds.

The first launch of this version keeps the existing database. Chats, memories, skills, and settings stay with the bot that owns them. A one-time backup from the earlier migration is `riot-bot.sqlite.v2.bak` beside the database and is not overwritten. Workspace files are not moved.

On first startup of the November 2 search update, saved copies of the old DuckDuckGo default search template were changed to Brave, and custom templates were preserved. Since November 8, bots with a custom search template use browser search mode.

## Verification records

These are observations from specific development runs. They are not a permanent ranking, a provider invoice, or a guarantee about later versions.

### Context-limit incident — November 1, 2026

A Playwright documentation task on November 1, 2026 paused after two successful model calls. The search could not run because Chromium was not installed, so the model fetched a docs page. That stored result was 5,316 characters, about 2,038 estimated tokens. The follow-up was about 6,738 estimated tokens before the fit margin, and about 8,086 after it: instructions near 1,731, tool definitions 2,619, plus the page, the short request, and the tool-call text. The 8,000 figure was the app’s assembly cap. The published OpenRouter context length for the selected model was 1,048,576 tokens. The follow-up was refused before it was sent, and the tool details still said Completed.

Automatic mode no longer treats 8,000 as that ceiling. Long tool results stay stored and the model request gets a short preview, with a way to read another section. If the provider rejects a request for context length, Riot Bot rebuilds a smaller request and retries once. A message that itself does not fit asks for a smaller message or a workspace file. Instructions and tool definitions that cannot fit the selected model are reported as a configuration problem. A dollar limit is reported as a spending limit.

### Packaging — November 3, 2026

No certificate is configured by this work. The existing NSIS installer in `release/` was not replaced and predates these fixes. The November 3 hardening check rebuilt an isolated unpacked Windows app, checked its actual fuses and exercised packaged startup. See [the security report](docs/security-review.md) for artifact verification and remaining release work.

### Tests and live checks — November 1–3, 2026

The November 3 follow-up passes `npm run check`: TypeScript, **44 test files / 281 tests**, and a production build. Regressions cover saved-logins/site authority, successful-result and streaming redaction, WebRTC transports, real DOM authorization and stale references, credential removal, local-only disk checks, project-secret grants and the isolated installer worker, alongside the existing job/Gmail/native/provider checks. Node can print an experimental SQLite warning. Model calls use mocks; offline browser cases use disposable profiles and skip explicitly if no supported browser is installed. Bundled Chromium and installed Chrome/Edge passed on this machine. Passing these checks does not establish that every provider model accepts all capabilities.

Additional desktop checks used isolated app data and exercised 80-message pages, scroll preservation, saved failed outcomes, actual PNG/JPEG decoding and resizing, screenshot paste, the file-picker handler, bot separation, pending-upload persistence across restart, message previews, and app-wide Activity after task completion. The history test visits 2,081 messages with identical timestamps without skips or duplicates. No renderer errors were recorded.

Live checks used a verified restoration of app data, the saved Windows-encrypted key, and the selected `deepseek/deepseek-v4.1-flash-1017` model through OpenRouter. The exact Google query `angelicpedia.com` returned Angelicpedia at organic position 1 in the observed US/English page on November 1, 2026; that completed three-call run reported $0.00083484324. A separate one-call image/text check correctly named the synthetic red square, blue circle, and attached code word; it reported $0.000635877. Search used the free browser route. These are observations of those runs, not a permanent ranking or a provider invoice. No normal app-data chats or settings were used as test fixtures.

The Brave follow-up also passed an actual search through the browser tool: the homepage was first and Azrael second, while the nested Christianity sitelink was excluded. Closing the real browser context was detected and the next search reopened it. A separate selected-model run included a synthetic old Google/Chromium error, then successfully used Brave and reported the homepage first without appending an unrelated answer. It used two model calls and reported $0.0002832786. Human-check recovery, reader failures, explicit engine changes, saved-default migration, and a window closing mid-action have regression tests.

An isolated Electron smoke check also verified startup, the renderer sandbox and preload bridge, the New Bot form, saved settings, named-bot creation, bot switching, and separate unsent drafts. Its database and workspaces were temporary, it reported no renderer errors, and Activity stayed at zero model calls. It did not use the normal app-data directory.

Covered: one ongoing conversation after restart, with an earlier chat left intact; a short workspace question with the current tool set and a saved summary; a long conversation that drops older history before refusing; overhead that names Settings instead of the message; automatic fitting that sends a request whose estimate exceeds the old 8,000-token cap; a mock search, open, and stored-section read; one context-length retry that does not repeat the tool; compaction that does not fold the same messages twice; a spending block that stays distinct from context; catalog lookup only for OpenRouter and not on idle; same-bot recall and no cross-bot leakage; migration and a second startup; renaming without moving the workspace; setup calls through the gateway and absent on idle; a bot switch during a run; the app-wide daily ceiling; reactions; avatars; Markdown; scroll stickiness; idle launch and restart; compaction; retries; dollar limits; stop; path checks; command approval; credential redaction; private-network web fetches; browser profiles, stale element references, takeover, cancellation, consequential-click confirmation, and blocked destinations; streamed tool calls; and the provider-check preview making no call.

The earlier browser-only smoke check downloaded Chromium and read a public page without a model call. The later selected-model checks described above exercised the assistant through the provider and browser tools.

The running window was also checked at 1180 and 880 pixels wide. The sidebar stayed a vertical bot list with New Bot, avatars, a selected-bot marker, and the bot menu. Earlier conversations still listed a saved chat. Switching bots kept each unsent draft with that bot. No model call was made.
