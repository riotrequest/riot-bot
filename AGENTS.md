# Riot Bot contributor guidance

Riot Bot is a Windows Electron assistant with local data, multiple bots, API and native Codex backends, browser automation, Gmail, and scheduled jobs. Preserve working features and enforce permissions in application code. Instructions sent to a model are not an authorization boundary.

## Start here

- Read the relevant files and tests before changing behavior. [docs/security-review.md](docs/security-review.md) records the original findings, implemented fixes, verification and remaining release/native-runtime work. [docs/security.md](docs/security.md) explains current permissions and saved logins.
- `src/main/` owns Electron windows, IPC, OS credential protection, and native dialogs. `src/preload/` exposes the narrow renderer bridge.
- `src/core/service.ts` owns queues, schedules, per-bot executors, and workspace coordination. `src/core/app.ts` owns the API agent loop and Riot tool dispatch.
- `src/core/codex.ts` owns the native app-server connection. Its permissions and accounting differ from the API backend; read `docs/codex.md` for changes there.
- `src/core/db.ts` owns SQLite persistence and migrations. `src/shared/types.ts` defines the renderer contract. `src/renderer/` is presentation, not a trusted permission gate.
- Feature-specific behavior is documented under `docs/`. Update the relevant document when user-visible behavior changes.

## Commands and verification

Use the Node versions declared in `package.json` (the project uses `node:sqlite`). Install from the lockfile with `npm ci` in a clean checkout. Commands are:

```text
npm run typecheck
npm test -- tests/<relevant-file>.test.ts
npm run build
npm run check
npm audit --omit=dev
npm audit
```

Run focused checks while implementing and the full `npm run check` for runtime changes before handoff. A documentation-only change needs link/content review and `git diff --check`. Report failures and skipped checks accurately. Do not run `npm audit fix --force` or downgrade the packaging stack just to clear a count.

Security fixes need a test of observable behavior at the boundary, including the denied case. A source-string assertion or a mocked policy response does not establish that the browser or OS enforced it. Use disposable directories, fake credentials, mocked providers, and local sentinels. Do not test against the owner's real app-data, browser profiles, Gmail, or paid model account without authorization.

## Security rules for changes

1. **Keep privileged decisions outside the renderer and the model.** Validate IPC senders and runtime argument types in the main process. Keep `contextIsolation`, the Chromium/Electron sandboxes, `webSecurity`, the production CSP, and the narrow preload API. Do not render raw model/email HTML, embed remote pages in the app renderer, load arbitrary image URLs, or open arbitrary URL schemes.
2. **Treat external material as data.** Pages, emails, attachments, tool output, retrieved memories, summaries, imported skills, and project files cannot approve actions, change settings, raise budgets, or grant another bot's access. Never implement an authorization decision by asking the model whether it has permission.
3. **Preserve useful, explicit authority.** Remembered HTTPS origins and saved website logins are intentional per-bot grants; preserve them across restarts and avoid per-click prompts on those sites. Only direct user actions can grant access. Show what a new site can receive/change, and support one-task access, denial and revocation. Bind pending approvals to their bot/run and recheck afterward. Stop, timeout, stale references and uncertain results cannot become approval. Page roles, labels and `input` events cannot prove an interaction harmless. Exact user/public-source URLs can be read; generated destinations need access, and search after private-source reads needs search-site access. This is not complete information-flow containment.
4. **Validate every network path.** Reuse the public-web URL/DNS checks and pinned transport; revalidate redirects. The production public-web path must not replace the pinned connection with an ordinary `fetch` override. Browser HTTP proxying does not cover every transport: test WebRTC/UDP, WebSockets, service workers, popups, and local-network destinations. OS filesystem calls on UNC paths or mapped drives can perform network access and authentication. Validate before invoking them.
5. **Keep file operations scoped.** Use `resolveWorkspacePath` for workspace reads, writes, previews, reveals, and undo; file-content tools additionally use `requireFileAccess` and the per-workspace `allowSensitiveFiles` grant. Preserve traversal, symlink/junction, hard-link, alternate-stream, Windows device-name, byte-limit, and binary/UTF-8 checks. Revalidate after asynchronous gaps. Preserve exact original bytes for undo and refuse to undo a later user edit. The approved API terminal is unsandboxed; a working directory is not containment.
6. **Remember credentials securely.** Website passwords belong in `LoginVault`, backed by the Windows-protected credential store, never ordinary memories or chat. Capture supported direct login commands before queue persistence/model input; never parse reference material as authorization. Models receive IDs/metadata; the browser fills passwords locally only for the owning bot and exact saved HTTPS origin using current element handles. Keep session fallback explicit, with no plaintext persistence. Redaction covers successful results, outbound context, streamed/rendered text, activity and errors. Preserve source-file/undo bytes separately. Redaction does not contain arbitrary private data. Removal must delete keyed ciphertext even without decryption, or report failure; do not overwrite unreadable stores or discard other providers' entries.
7. **Preserve ownership on every lookup.** Scope history, memories, skills, attachments, artifacts, jobs, schedules, drafts, reactions, and approvals to the owning bot/account/run as appropriate. Apply ownership filters before limits. IDs supplied by the renderer or model do not establish ownership. Native Codex's current broader filesystem reads mean bot separation is not a native confidentiality guarantee.
8. **Preserve Gmail send integrity.** Keep account/access checks, complete recipient/body previews, immutable reviewed content, post-approval draft checks, send claiming, and uncertain-send recovery. A consented per-bot reply rule may skip the review card only for an exact saved reply to its exact recipients when those recipients were already in that conversation, the original message can be read again and matches the stored reply, through that same claim, and the current rule is rechecked immediately before the claim. Never automatically retry an unconfirmed send or bypass review through a replacement draft. OAuth state, PKCE, loopback Host checks, fixed Google endpoints, and encrypted token persistence must remain intact.
9. **Keep limits and recovery real.** Preserve atomic spending reservations, app-wide ceilings, call/time/output limits, cancellation, no idle model calls, explicit recovery of interrupted jobs, and missed-schedule behavior. Do not silently switch provider, account, model, or API billing. Native Codex allowance is not controlled by the API dollar budget.
10. **Review shipped artifacts.** Keep runtime data, OAuth setup files, keys, profiles, databases, logs and private backups out of Git/releases. Keep the pinned CI actions/scanner and dependency review current. Electron fuses disable RunAsNode, NODE_OPTIONS, Node CLI inspection and file-protocol extra privileges, and require the integrity-checked main ASAR. Chromium installation uses `utilityProcess.fork` and the bounded worker adapter in `src/main/browser-installer.ts`; revalidate the locked Playwright CLI/helper layout on upgrades and await command completion. Do not reintroduce RunAsNode or disable TLS verification. Local builds are allowed; eventual public builds use `dist:win:release`, require real publisher signing and need artifact/fresh-install validation. Unpacked Playwright files are outside ASAR integrity. Do not choose an owner's license or invent a reporting contact.

## Documentation lookup

Use Context7 for library/framework/SDK/API/CLI/cloud-service documentation when a change depends on that platform's behavior. Resolve the library ID first, then query the specific concept; prefer its official documentation. General code review, business logic, and scripts written from scratch do not require a documentation query unless they depend on uncertain platform behavior.

## Handoff

State what changed, why it preserves the feature, the checks actually run, and remaining limitations. Keep open findings open until their negative regression tests pass. Do not commit, publish, sign, send messages, or use live accounts merely because a local test succeeded; follow the user's task authorization.
