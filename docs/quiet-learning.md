# Quiet memory and skill reviews

Each bot has two independent, persistent switches under **Bot settings → Memory & skills**. Both default to on, including for existing bots whose saved settings do not yet contain these fields.

- **Automatic memory** checks for important durable preferences, ongoing project facts/constraints, and confirmed decisions. A result must include an exact supporting quote from the current user message and a high-importance classification. It saves at most one short memory, labeled **Remembered automatically**, with its source message recorded. Users can edit, pin, or delete it in Memories.
- **Suggest reusable skills** checks for a useful procedure successfully established in the conversation, with at least three steps and a success check. It shows the existing skill preview with Save, Edit, and Dismiss. A review cannot save or enable a skill itself. An existing pending preview is kept rather than replaced.

These are model judgments, not guaranteed understanding. The review is instructed to return nothing for everyday chat, temporary requests, guesses, sensitive personal information, secrets, generic advice, incomplete work, and declined suggestions. Runtime checks reject malformed output, unsupported quotes, low-importance memories, short/invalid skill procedures, and common secret patterns. Secret detection is incomplete. Retrieved text cannot grant tool access or change settings.

Both checks share one short request after a successful user chat turn. They do not run at startup, while idle, after a failed/stopped reply, or after reminders/scheduled work. Simple greetings and thanks are skipped. No files, images, attachments, raw tool results, or full transcript are sent to the review. It uses a bounded excerpt and a small catalog of saved/removed notes and existing/previously offered skills. Identical or near-identical memories/procedures and skill names are suppressed. Recent deleted-memory tombstones and dismissed proposal records survive restart, so checks do not simply restore them or repeat the same offers; semantic paraphrases can still evade this check.

## Cost and lifecycle

Reviews use the bot's selected model and connection. Riot does not choose a different paid model or fall back from native Codex to an API. They appear as **Memory & skill check** in Usage & activity.

API reviews have no tools, no streaming, no continuations, and one attempt. The input excerpt fits within 3,000 conservatively estimated tokens (or the bot's smaller input budget), and output reserves at most 1,000 tokens, also respecting a smaller manual reply cap. Reviews share the originating task's model-call, time, per-task spend, bot daily spend, and app daily spend limits. If a review does not fit, it is skipped. Optional context is removed locally rather than compacted with another call. Incomplete output is discarded, without repair calls.

Native Codex reviews use a fresh ephemeral thread with shell/search/dynamic tools disabled, read-only/network-disabled policy, project instruction-file loading disabled, low reasoning effort, and a JSON output schema. The main native conversation/session mapping is preserved. This consumes one additional native turn and the account's Codex allowance. Codex manages its own tokens; Riot's API dollar/token caps do not apply. The native review has no approved commands, file edits, permission escalation, or API fallback. Protocol fields follow the [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

Reviews have a 20-second timeout and share the parent's cancellation signal. Stop and shutdown prevent late results from being saved. A review failure is recorded when a request was sent, but does not turn an otherwise successful reply into an error. The worker remains occupied briefly while the review finishes, so it cannot race the same bot's next queued task.

## Chat controls

Examples: `Turn off automatic memory`, `Stop suggesting skills`, `Turn on automatic memory and disable skill suggestions`, and `Turn off both background checks`. Common direct commands work even when tools are disabled. With tools on, `set_learning_preferences` / `riot_set_learning_preferences` handles more nuanced requests. The control is scoped to the executing bot, requires a user preference-change request, and is refused during scheduled work. The UI receives a scoped event so its switches reflect chat changes immediately.

Turning a switch off keeps existing notes/skills and explicit memory/skill save requests working. It prevents that automatic review result from being applied, even if a provider returns it anyway. Turning both off eliminates review calls. Foreground memory saves require a user save/remember request, and disabled skill suggestions cannot be bypassed by an unsolicited preview.
