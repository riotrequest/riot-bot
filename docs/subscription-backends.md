**Subscription backend design — checked November 2, 2026**

This is the saved design for a later implementation. The current build offers the OpenAI and OpenRouter API-key backends. Codex and Claude subscription sign-in are not exposed in this pass, as requested.

The requirement is to preserve the provider's agent capabilities. An API model uses Riot Bot's existing tool loop and free browser search. A native agent backend should use its own agent loop, tools, search, sessions, and permission protocol when available. Riot Bot supplies the bot identity, scoped memories, task intent, UI, and consent. Native search results still do not establish an observed Google organic position; an exact ranking request needs the browser evidence for that engine.

| Backend | Owner of agent loop and default tools | Authentication and billing |
| --- | --- | --- |
| OpenAI/OpenRouter API | Riot Bot; existing browser, files, terminal approvals, and memory tools | User's API key; current estimated/reported dollar accounting |
| Codex native agent | Official Codex app-server; keep supported native search, file, execution, and MCP capabilities | Documented ChatGPT/Codex authentication or registered ChatGPT-plan integration, subject to eligibility |
| Claude native agent | Unmodified Claude Code; keep its available native tools and permissions | Each user's own authentication through Anthropic's flow, subject to the embedding conditions |

**Codex route.** The official app-server supports managed ChatGPT login and emits native tool/turn events. A Codex integration should stream those events, preserve thread IDs per Riot bot/conversation, forward approvals, and interrupt the native turn on Stop. Rate-limit information is available through its account protocol; a model catalog is not an entitlement check. [Codex App Server](https://learn.chatgpt.com/docs/app-server)

OpenAI also documents a registered Sign in with ChatGPT route for eligible clients and accounts. Sign-in identity alone does not grant inference permission; the registration, token scope, refresh, and account checks must complete. Do not assume this private project is automatically an approved commercial or private client. [Quickstart and eligibility](https://developers.openai.com/siwc/quickstart), [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

That registered route can drive app-server through a documented Responses provider configuration and app-issued OAuth credentials. Keep it separate from managed Codex login; do not mix the two flows or copy credentials from another application's token store. [Codex app-server with ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

**Claude route.** Anthropic documents conditions for running its unmodified Claude Code binary inside a product: preserve its authentication options, let each user authenticate for their own usage, and meet the applicable terms. Its docs distinguish this from offering a product's own Claude.ai login or routing subscription credentials for users. The latter is restricted. The future connector should use the documented native-binary route and Anthropic's own sign-in flow, without collecting or proxying session tokens. [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)

The Agent SDK carries built-in tools, sessions, hooks, and permissions, including web search. Its overview separately says third-party products cannot offer Claude.ai login or plan limits through the SDK without prior approval. SDK availability is not blanket permission for subscription authentication. Confirm the applicable route before implementing it. [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)

**Changes required in Riot Bot.** The current ModelProvider.complete contract returns one model response to Riot Bot's gateway. It is appropriate for the API path but cannot represent a native agent session faithfully. Add a native agent session runner alongside that path when implementing a connector; do not wrap the native agent as a raw chat-completions call and run a second tool loop around it.

The runner must map native events into persisted chat, activity, and run outcomes. It should advertise actual available capabilities and use native search by default, with Riot Bot tools exposed only when needed through a controlled integration. Avoid duplicate searches, overlapping compaction, and replaying the whole transcript into an already resumed native session. Keep provider/thread mappings and configuration scoped by bot and conversation.

**Required behavior before enabling either connector:**

- The user explicitly selects a backend and completes its supported authentication. Opening Riot Bot and viewing connection status do not start an agent turn.
- Subscription allowance and reset information are shown separately from API dollar estimates. Unknown usage remains unknown. A quota/auth failure pauses; it never silently changes provider, account, API key, or billing mode.
- Native tools retain their value while respecting the selected permissions. Unsupported permission requests are denied. Read-only/workspace settings must be enforced by the native backend, not merely described in a prompt. Do not use bypass-permission launch flags.
- Stop, deadlines, closing, and restart interrupt native work and settle local status correctly. A completed search tool does not imply a completed task. Do not automatically repeat partially executed commands.
- Native browser/tool sessions, attachments, memory access, and approvals preserve bot isolation. Credentials stay out of the renderer, transcript, logs, source, and exported reports.
- Acceptance checks cover supported sign-in and cancellation, native search, memory access, attachment handling, session resume, Stop, permission denial, quota exhaustion, bot switching, and absence of automatic paid fallback.

Implement Codex first when authorized, then the Claude connector under its documented conditions. Keep the working API search implementation for users who select API models.
