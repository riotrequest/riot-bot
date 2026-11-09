# Contributing to Riot Bot

Thanks for your interest in Riot Bot. This guide covers what you need to work on the code, the checks a change has to pass, and how we test things without touching anyone's real accounts.

Riot Bot can read your files, drive a browser that may be signed in to your accounts, and send email. Contributions are held to the security rules in [AGENTS.md](AGENTS.md#security-rules-for-changes). Please read them before changing behavior, even if you're writing the code by hand. (AGENTS.md is written for AI coding agents and people alike.)

Riot Bot is released under the [MIT License](LICENSE). By contributing, you agree that your contribution is licensed under the same terms. No contributor agreement or sign-off is required. For larger changes, please open an issue to discuss the idea before you start.

## Ways to help

- **Report a bug** with the bug report template. Use synthetic data only and never paste secrets. See [reporting bugs](#reporting-bugs).
- **Suggest a feature** with the feature request template.
- **Improve the documentation.** Many user-visible details live under [docs/](docs/).
- **Fix a bug or build a feature.** For anything beyond a small fix, please open an issue first so we can agree on the approach.

Please don't report security vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md) instead.

## Development setup

You need:

- **Windows.** Riot Bot is a Windows desktop app, and CI runs on `windows-latest`.
- **Node.js** in one of the versions declared in [package.json](package.json): 22.13 or newer in the 22.x line, 24.x, or 26 and newer. The project uses the built-in `node:sqlite` module, so older versions will not work. CI uses Node 24.
- **Git.**

Install from the lockfile and start the app in development mode:

```powershell
npm ci
npm run dev
```

Use `npm ci` rather than `npm install` in a clean checkout, so you get exactly the locked dependency versions. Starting the app makes no model call. Nothing calls a model until you send a message.

Development runs use your normal app-data folder (`%APPDATA%\riot-bot\`). If you have a personal Riot Bot setup with real chats, logins or connections, keep it out of your experiments. Never use it as a test fixture.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/main/` | Electron windows, IPC, OS credential protection and native dialogs |
| `src/preload/` | The narrow bridge exposed to the renderer |
| `src/core/service.ts` | Queues, schedules, per-bot executors and workspace coordination |
| `src/core/app.ts` | The API agent loop and Riot Bot tool dispatch |
| `src/core/codex.ts` | The native Codex app-server connection (read [docs/codex.md](docs/codex.md) first) |
| `src/core/custom-endpoint.ts` | The local and custom model endpoint provider, with its address checks and pinned transport ([docs/custom-endpoints.md](docs/custom-endpoints.md)) |
| `src/core/db.ts` | SQLite persistence and migrations |
| `src/shared/types.ts` | The contract between the main process and the renderer |
| `src/renderer/` | The React interface. It is presentation only, never a permission gate. |
| `tests/` | Vitest tests, shared helpers and protocol fixtures |
| `docs/` | Feature and security documentation |
| `build/icon.ico`, `scripts/make-icon.mjs` | The app and installer icon, and the script that draws it |

## Commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript checks |
| `npm test -- tests/<relevant-file>.test.ts` | Run one test file while you work |
| `npm run build` | Production build |
| `npm run check` | Typecheck, the full test suite and the production build |
| `npm audit --omit=dev` | Advisories in runtime dependencies |
| `npm audit` | All advisories, including packaging tools |

Run focused tests while you work. Run the full `npm run check` before you hand off any runtime change. CI runs it too, along with the dependency audits and a secret scan of the full history.

A documentation-only change needs a review of its links and content, plus `git diff --check`.

Some moderate advisories in the packaging toolchain are known and tracked in [docs/security-review.md](docs/security-review.md). Please don't run `npm audit fix --force` or downgrade the packaging stack just to clear the count.

Node may print an experimental SQLite warning while tests run. That's expected.

## Writing tests

Tests must never touch real accounts or real data. That means:

- **Disposable data.** Create databases, workspaces and browser profiles in temporary directories. `tempDir()` and `makeApp()` in [tests/helpers.ts](tests/helpers.ts) set up an isolated app with a fresh SQLite file and workspace root.
- **Mocked providers.** Model calls go through `MockProvider`. Network services like Gmail, research providers and the Codex app-server use fakes or protocol fixtures (see [tests/fixtures/](tests/fixtures/)).
- **Fake credentials.** Use `MemoryCredentialStore` and obviously fake keys, passwords and tokens.
- **Local sentinels.** To prove that something was *not* reached, point it at a local sentinel you control and assert that nothing arrived.
- **Never real accounts.** Don't test against your own app-data folder, browser profiles, Gmail or a paid model account. Live checks against a real provider need the account owner's explicit authorization, and they don't replace automated tests.

Offline browser tests use disposable profiles. If no supported browser (Chromium, Chrome or Edge) is installed, they are reported as skipped, not passed.

### Security fixes need a boundary test

A security fix needs a test of observable behavior at the boundary, and that includes the denied case. Show that the browser, filesystem or OS actually refused the action. Asserting on a source string, or mocking the policy's answer, doesn't prove that the boundary held. Keep a finding open until its negative regression test passes.

## Security rules

[AGENTS.md](AGENTS.md#security-rules-for-changes) has the full rules. In short:

- Privileged decisions stay in the main process. The renderer and the model never make them.
- Pages, emails, attachments, tool output, memories and skills are data. They can't approve actions, change settings, raise budgets or grant access.
- Every network path reuses the public-web URL and DNS checks and the pinned transport, and revalidates redirects.
- File operations stay inside the workspace, with the existing traversal, symlink, device-name and byte-limit checks.
- Website passwords live only in the login vault. They never go into memories, chat or model input.
- Every lookup keeps its ownership filter (bot, account or run), and applies it before any limit.
- Gmail sending keeps its review, claim and uncertain-send protections.
- Spending limits, cancellation and recovery stay real. Riot Bot never silently switches provider, account, model or billing.
- Runtime data, keys, profiles, databases and logs stay out of Git.

If your change touches any of these areas, say so in your pull request and explain how the rule still holds.

## Documentation

When user-visible behavior changes, update the relevant document under [docs/](docs/) or the [user guide](docs/user-guide.md). Add an entry to [CHANGELOG.md](CHANGELOG.md) under **Unreleased**, and keep the README's feature tour accurate.

## Pull requests

- Keep each pull request focused on one change.
- Fill in the pull request template: what changed, the checks you actually ran (with any failures or skipped checks), the docs you updated, and any security-rule impact.
- Don't commit runtime data, OAuth setup files, keys, browser profiles, databases, logs or backups. `.gitignore` covers the usual ones, but check what you stage.
- A passing local test isn't permission to publish, sign a build or use a live account.

## Reporting bugs

Use the bug report template. Please include:

- the commit or version, your Windows version, and the backend (OpenAI API, OpenRouter or ChatGPT/Codex) and model
- steps to reproduce using **synthetic data**: made-up names, addresses, messages and sites
- what you expected and what happened
- relevant lines from `%APPDATA%\riot-bot\riot-bot.log`, after you have checked them

The log is redacted, but redaction catches only known patterns. **Never include** real passwords, API keys, OAuth tokens, cookies, Google setup files, app-data backups, private emails or chat transcripts. If a bug only reproduces with private data, describe its shape rather than pasting it.
