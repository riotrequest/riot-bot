# Codex in Riot Bot

The preview connector uses the official Codex CLI’s app-server and its managed ChatGPT sign-in. Codex owns the native agent loop, context compaction, streaming, tools, and web search. Riot supplies the bot’s identity, memories, chat history, skills, attachments, task timer, approval UI, and activity record. API backends continue using Riot’s existing tools and free Brave browser search.

## Connect

1. Install the official Codex CLI if it is missing, then restart Riot Bot. The connector was checked against Codex CLI **0.154.0** on November 2, 2026.
2. In Settings, select **Codex · ChatGPT sign-in (preview)**.
3. Click **Sign in with ChatGPT** and finish the official browser flow. Riot opens only the supported HTTPS authentication hosts. **Cancel sign-in**, **Refresh Codex status**, and **Disconnect Codex** are available in the same panel.
4. Enter a Codex model ID, using the suggestions from the connected model catalog. The catalog does not guarantee that your account can use a model.
5. Select this bot’s workspace and save Settings. Send a message to start a native turn.

Sign-in and status checks do not start a model turn. Riot neither imports another app’s login nor copies tokens out of your normal Codex profile. The connection is app-wide; each bot still has its own native conversation mapping.

## Usage and tools

Native turns use the signed-in account’s Codex allowance and any additional usage settings enabled for that account. Riot displays reported usage percentages and reset times when supplied. Unknown usage remains unknown. Activity records native turn attempts and reported token counts separately from API dollars. API call counts, output-token limits, context fitting, and dollar ceilings do not control the native agent loop. Task minutes and Stop do apply.

An authentication error, quota failure, failed turn, or disconnected server pauses/fails visibly. Riot never silently switches provider, account, model, or API key. There are no scheduled native turns or automatic retries of interrupted actions.

With tools enabled, Codex retains native web search, shell, and file capabilities. Prefixed `riot_` tools expose this bot’s memories, bounded history/attachments, skills, reactions, and bounded workspace reads. Riot does not add its own search or shell tool alongside the native equivalents. Turning off the native shell/search/Riot-tools checkbox disables those capabilities and forces a read-only policy; other built-in native capabilities are governed by Codex. Unsupported native permission/forms requests are declined. Ask/answer clarifications through ordinary chat.

Codex’s search source is not a verified Google organic position. Exact rank claims still require observed results from the named engine. A native search does not use Riot’s visible browser profile or its CAPTCHA handoff controls.

## Permissions and sessions

The connector selects native `untrusted` approvals and read-only or workspace-write policy, never bypass mode. Safe read commands can run automatically under Codex’s rules. Native command/file requests that need approval appear in Riot; approval applies once. Network and additional filesystem permission requests are declined. Native file edits do not have Riot’s Undo button.

On Windows, Riot selects the unelevated native sandbox and requires its readiness check before a tool-enabled turn. Read-only writes, allowed workspace writes, and denied writes outside that workspace were checked directly against the installed CLI. The installed version’s legacy policy permits filesystem reads outside the workspace. Native sessions are logically separated by bot/conversation, but are not a confidentiality boundary for native filesystem reads. This differs from Riot’s bounded API file tools and its separately approved, unsandboxed API terminal.

A completed native thread is resumed only for the same bot, conversation, connection identity, model, workspace, editing setting, and tool setting. A fresh thread gets a bounded recent-history excerpt and memory/skill context. Riot does not resend the whole transcript into a resumed native thread. Stop, failed work, account changes, relevant configuration changes, and API turns invalidate reuse. Restart does not repeat unfinished work. Stop sends the native interrupt and closes the owned process tree if the server does not acknowledge promptly.

Riot’s separate `CODEX_HOME` is `%APPDATA%\riot-bot\codex`. The official CLI manages its authentication storage there; Riot’s Windows-encrypted API-key store is separate. Include the complete Codex profile in a private app-data backup after signing in. Source archives and Git checkpoints do not contain it.

## Verification

The installed CLI initialized, accepted a thread and dynamic-tool schema, and enforced the tested Windows write policies using a fresh signed-out profile. No model turn was started in that check. Protocol fixtures exercise managed login/cancel/logout, native search events, scoped Riot memory, attachments, session reuse/restart, approval refusal, Stop (including a stuck child process), quota/disconnect errors, and separate usage accounting. A disposable Electron instance exercises the provider controls, authentication status events, chat, and Activity without renderer errors.

The real browser sign-in and an authenticated turn with your selected Codex model remain to be completed after you connect. No real Codex model/search response is claimed by the fixture checks.

Protocol reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server). The alternate registered [Sign in with ChatGPT integration](https://developers.openai.com/siwc/quickstart) is a different authentication route and is not implemented here.
