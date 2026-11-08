# Tasks, saved files and local verification

Riot’s Electron main process owns execution independently of the chat renderer. The desktop window closes to the tray. There is no extra daemon to install. Model work starts only from a user request or a saved scheduled task; bot selection, window opening, status refresh and sign-in do not start it. Due reminders are kept on boot and pop up once Riot is minimized or not the focused window; overdue bot tasks wait for **Run now**. See [scheduling](scheduling.md).

## Execution

Sending a message saves its text and attachment references as a job in SQLite. It enters the conversation only when dispatch starts, so a follow-up cannot change the instructions of a job already running. Each bot has one executor with its own provider, native Codex connection, terminal, browser state, context bookkeeping and approvals. Two bot jobs may run concurrently. Ancestor/descendant and identical workspace paths serialize across bots.

The queue allows 20 pending jobs per bot. The **Tasks** screen displays pending work first and up to 200 recent/pending jobs across the app, or 100 for one bot. Job text previews are limited to 1,000 characters; the complete request remains saved. The app-wide API spending ceiling and in-flight reservations still apply across all bots. Native Codex usage stays separate from API dollars.

Provider, model, workspace, editing, tools and instructions are bound when queued. If that setup changes before dispatch, the job pauses for review. Settings and instructions cannot change beneath an active job. Changing a key or Codex account requires stopping jobs on that connection; queued work using it pauses. Native workers close their old connection before an account change and read the new connection identity before reusing a thread.

Approval cards show a brief action, folder and permission warning. File changes, command text and action details are collapsed by default; expanding them opens a bounded scrolling area with the decision buttons kept outside it. A new request starts collapsed. This presentation change preserves the existing approval requirements and pending request contents.

Skill previews have their own layout, separate from approval cards. Save skill, Edit and Dismiss stay outside the scrolling procedure/editor so long previews cannot hide the controls. Details start collapsed; saving persists the reviewed skill for that bot.

Stop applies to the selected bot and pauses its remaining queue. Stop all is in the tray menu and also pauses active bot-task schedules; reminders remain enabled. A failed or paused job also pauses its follow-ups. A failed, paused or stopped scheduled run pauses its schedule. Cancelling an unstarted job releases its draft attachments. Resume is an explicit request to run with the bot’s current settings. For work that already started, the new attempt receives the earlier task plus instructions to inspect saved results, avoid repeating completed actions and request any outstanding approvals again. This is a review-based continuation, not exactly-once recovery for external actions.

Quit stops executors, waits for them to settle and closes the databases. On restart, active jobs are marked interrupted and queued jobs are restored paused. An abrupt crash has the same recovery policy. Previous approvals are denied during recovery. The browser’s cookies remain in its bot profile. Reopening the app never silently repeats a command or switches to another model or a paid API backend.

The desktop service requires this Windows session and an awake computer. It does not run after explicit Quit or across a PC shutdown. Routines, boot-start installation, remote controls and delegated bot tasks are later milestones.

## Files

The service inventories the workspace before and after a job and includes files changed through Riot’s recorded file tools. It saves immutable copies and hashes in app data, with versions scoped by bot, workspace and relative path. An externally edited file that changes during a job can also be captured; this is a file snapshot, not proof of authorship or task success. Job status remains visible separately.

Capture is bounded to 1,000 inventoried files, 2,000 folders, 12 folder levels, 100 saved files and 100 MB per job, with at most 20 MB per file. It excludes hidden names, dependency/vendor folders, recognized credential/key files, symlinks and content containing known API-key values. These exclusions are best effort, not a general secret scanner. Oversized or inaccessible files stay in the workspace. The **Files** screen displays the latest 200 versions for the selected bot. Individual HTML copies may depend on companion files in the workspace; Library does not create a self-contained site bundle.

**Show in folder** uses Explorer to reveal the stored version without executing it. Deleting a conversation does not remove its saved Library files. There is no automatic retention deletion in this version. Include `artifacts` in private app-data backups, and separately back up your workspaces.

## Deleting a bot

Right-click the bot or use its **…** button, then choose **Delete bot…**. The same action remains under **Bot settings → Profile & browser → Delete this bot**. Review the named bot and confirm with **Delete bot**; Cancel is focused initially, and typing the name is unnecessary. Active work must stop first; the menu disables Delete for a running bot and the service checks again at confirmation. Queued work is discarded. The request still binds the exact bot ID and its name, and a stale selection is rejected. Deletion removes the bot and its Riot conversations, messages, reactions, attachments, memories, skills/versions, proposals, job records, schedules, file-edit backups, Library files, avatar and browser profile. It keeps the project workspace, other bots, shared credentials, existing backups and the shared Codex profile (including native session history). Usage requests and reservations are detached and stripped of conversation/context/error data so the app-wide spend ceiling and usage totals remain correct.

The per-bot executor closes before data is removed. Database deletion runs in one transaction, and Quit waits for deletion to settle. File cleanup is limited to validated per-bot paths under Riot’s app-data directory, refuses parent junctions, and protects overlapping workspace paths. If a cache cannot be removed, the UI reports the remaining paths. Deletion is logical removal from Riot, not forensic erasure of SQLite pages, backups or provider-managed history. Deleting the last bot leaves a persistent empty state with no automatic model calls.

## Static website checks

`verify_website` (`riot_verify_website` in Codex) accepts a workspace HTML entry, requires editing for its output and uses an available Chromium, Chrome or Edge installation. It runs no shell command, package install, build script or development server. If a browser cannot launch, it reports that the check did not run.

The checker serves allowed static workspace assets through Playwright request interception at a private synthetic HTTPS origin. It uses fresh contexts with downloads, service workers, external HTTP requests and WebSockets disabled. It does not use existing browser profiles, cookies or credentials. This is a controlled browser check, not an operating-system sandbox for arbitrary project commands.

Desktop (1440 × 900) and mobile (390 × 844) views record the title, first heading, initial script errors, missing local assets and horizontal overflow. Screenshots and a JSON report go under `riot-checks/<check id>/`. The report explicitly limits its conclusions to those checks. External fonts, services and images are blocked; pages depending on them can look different. User interactions, accessibility, backend behavior and complete visual design require additional review. A job that finishes the check saves its files to Library within the normal capture bounds.
