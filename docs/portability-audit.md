# Portability audit: running the core headless on Linux

**Status:** audit only. The owner chose to polish and launch the desktop app before building a server; nothing here is scheduled.

**Baseline:** every file and line reference is to commit `9481cb0` (`feature/gmail-reply-rules`), the code the desktop launch is built from. The branch that holds this document also holds a parked, unreviewed prototype (commits `1ffd6e4` and `2c73d92`). It is mentioned only as evidence of size; do not merge it as it is.

**Method:** code reading plus runs of the unmodified `9481cb0` test suite on WSL Ubuntu 24.04 with Node 22.20, once with a display (WSLg) and once without one, the way a server or CI runner has none. A scratch probe outside the repository checked three behaviors directly: terminal Stop, disk-space checks and native Codex start-up. The real-browser checks were not run on Linux, because no browser was installed and there was no root access to add its system libraries.

## Summary

`src/core` has no static Electron import, and the renderer talks only through `RiotBridge`. Most of the engine already runs in plain Node on Linux: SQLite, the API agent loop, schedules and jobs, memories, the Library, keyless web research, the pinned public-web transport, and the workspace path checks. A headless entry that boots `RiotService` is small (the parked prototype's is about 200 lines).

The blockers fall into two groups:

- **Wrong or unsafe on Linux today:**
  - Terminal Stop does not reach the programs a command starts.
  - Disk-space checks do not classify network filesystems.
  - Native Codex would start without the sandbox check that Windows has.
  - Plain Node can start an Electron binary download when it decodes an image.
- **Missing for a server:**
  - persistent secret storage
  - a transport with owner authentication in place of `src/main`
  - a browser that works without a display
  - a Gmail sign-in that does not depend on a loopback redirect

**Legend:**

- **Linux needs:**
  - *Works as-is*
  - *POSIX equivalent*: the same feature implemented with POSIX mechanisms.
  - *New adapter*: a new component or an owner decision.
  - *Not supported*: refuse it with a clear message for now.
- **Rule:** the numbered security rule in `AGENTS.md` that the change touches.
- **Size:** S is under a day, M is a few days, L is a week or more, or waits on an owner decision.

## 1. Windows and Electron assumptions in the core

### Processes and the terminal

| # | Location (9481cb0) | What the code does | Linux needs | Rule | Size |
| --- | --- | --- | --- | --- | --- |
| C1 | `src/core/terminal.ts:34-39` | Runs an approved API command through `ComSpec`/`cmd.exe` on Windows and `/bin/sh -c` elsewhere. `spawn` is called without `detached`. | Works as-is for running commands. | 5 (the unsandboxed terminal) | — |
| C2 | `src/core/terminal.ts:84-119` | **Stop.** Windows: `taskkill /PID … /T /F` (line 88, found through `PATH`, not System32). POSIX: `process.kill(-pid)` targets a process group that was never created, because `detached` is unset. It falls back to signalling only the shell. Programs the shell started keep running and keep the output pipe open. The run then waits for them, beyond Stop and the time limit. | POSIX equivalent: start the shell as its own process group, send SIGTERM to the group, then SIGKILL after a grace period, and bound the wait for output after Stop. Separately, the Windows build should call `taskkill.exe` by its System32 path. | **9** (Stop, time limits, cancellation) | S–M |
| C3 | `src/core/codex.ts:100`, `:259-262` | Native Codex selects `windows.sandbox="unelevated"` and checks `windowsSandbox/readiness` before a tool-enabled turn, **on Windows only**. On Linux the same turn starts with no sandbox selection or readiness check. `docs/codex.md` records verification of the Windows policy only. | **Not supported** until the Linux Codex sandbox (Landlock or bubblewrap) is verified and has a readiness check. Gate it off and spawn nothing. | 2, 3, 7 (native permissions, bot separation) | S to gate, L to support |
| C4 | `src/core/codex.ts:334-348` | Shutdown uses System32 `taskkill /T /F` on Windows and group SIGTERM on POSIX (`detached` is set at line 100), with no SIGKILL escalation. | POSIX equivalent: add escalation and share the code with C2. | 9 | S |
| C5 | `src/core/codex.ts:34-52` | `findCodexExecutable` already maps Linux and macOS package targets and refuses `#!` scripts on POSIX. | Works as-is. It matters only once C3 is resolved. | — | — |

### Filesystem and network paths

| # | Location (9481cb0) | What the code does | Linux needs | Rule | Size |
| --- | --- | --- | --- | --- | --- |
| C6 | `src/core/disk-space.ts:8-17`, `:19-36`, `:42` | Windows classifies drive roots with a fixed PowerShell `DriveInfo` helper before any lookup. Off Windows there is **no classification**. After rejecting `//` and `\\` spellings, any path goes to `lstat` and `statfs`, including NFS, SMB/CIFS, sshfs, autofs triggers and WSL's 9p Windows drives. | POSIX equivalent: classify each path component from `/proc/self/mountinfo` before touching it, and allow only local filesystem types. macOS needs `getmntinfo`/`statfs` type checks or should be unsupported. | **4** (network paths) | M |
| C7 | `src/core/app.ts:1002-1012`, `:445`; `src/core/workspace.ts:41-56` | A workspace path from the renderer (`updateSettings`, or the new-bot draft) is passed to `fs.statSync`/`realpathSync` with no UNC, device or network-mount check. On the desktop it normally comes from the native folder picker (`src/main/ipc.ts:244-250`). | A server-side folder chooser limited to configured roots, plus the same network classification as C6. **The desktop is also affected:** the renderer is not a trust boundary, and a forged path such as `\\host\share` would reach the OS lookup. This is an inference from the code and was not tested. | **4, 5** | M |
| C8 | `src/core/path-safety.ts:11`, `:44-45`; `src/core/workspace.ts:6`, `:26`, `:45`, `:55` | Windows reserved names, invalid characters, trailing dots and spaces, and a 240-character limit are enforced on every platform. Symlink checks use `lstat`/`realpath`. The error messages say "on Windows". | Works as-is: stricter than Linux needs and keeps workspaces portable. Directory symlinks are the POSIX counterpart of junctions, and the checks catch them (the parked prototype's test passes on Linux). Only the message wording needs to change. | 5 (keep) | S |
| C9 | `src/core/files.ts:93-94`, `:119-120`; `searchFiles` | Reads and writes require `isFile()`, so FIFOs, sockets and device files in a workspace are refused. | Works as-is. | 5 | — |
| C10 | `src/core/workspace.ts:8-10`; `src/core/app.ts:2087` | The default workspace root is `~/RiotBot/workspaces`, and disk-space checks fall back to `os.homedir()`. | A configurable root for a server account or container. | 5 | S |

### Browser and Chromium

| # | Location (9481cb0) | What the code does | Linux needs | Rule | Size |
| --- | --- | --- | --- | --- | --- |
| C11 | `src/core/browser-playwright.ts:19-33`, `:131-144` | The bot browser is a visible (`headless: false`) persistent Chromium. Takeover depends on the user seeing that window, for sign-ins, CAPTCHA and verification. | **Not supported** on a host without `DISPLAY`/`WAYLAND_DISPLAY`. A server needs a new adapter: a virtual display plus an authenticated live view and takeover. | 1, 3, 4 (sandbox, explicit user takeover, proxy containment) | L |
| C12 | `src/core/browser-playwright.ts:24-27`; launch at `:144` | Chromium always runs with its sandbox. On Linux that needs unprivileged user namespaces (restricted by AppArmor on Ubuntu 23.10 and later) or a setuid helper. Containers need a matching seccomp/userns setup. A failure surfaces as a raw Playwright error. | Host configuration plus a clear error. **Never** `--no-sandbox`. | **1** | M |
| C13 | `src/core/browser-playwright.ts:54-67` | Installed Chrome and Edge are detected only in Windows install folders. | POSIX equivalent (for example `/opt/google/chrome/chrome`), or rely on the Playwright Chromium download. | — | S |
| C14 | `src/core/browser-playwright.ts:97-125` (`require('electron')` at `:104`) | The Chromium installer always requires `electron`. In plain Node that returns the binary path string, starts the electron package's binary download, or throws when dev dependencies are omitted. A plain-Node `spawn` branch exists but sits behind that require. Linux Chromium also needs system libraries (`playwright install-deps`, which needs root). | POSIX equivalent: require Electron only under Electron, and keep the `utilityProcess` path there. Document or bundle the system libraries for the host. | 10 (installer adapter, RunAsNode) | S |
| C15 | `src/core/website-check.ts:47-50` | Static website checks launch headless Chromium, so they need no display. | Works as-is once C12–C14 are handled. The WebRTC, UDP and TCP containment tests must be re-run with a Linux Chromium. | 4 | S |

### Images

| # | Location (9481cb0) | What the code does | Linux needs | Rule | Size |
| --- | --- | --- | --- | --- | --- |
| C16 | `src/core/avatar.ts:142-150`, `:61-78`; `src/core/attachments.ts:29-33` | Images are decoded and resized with Electron `nativeImage`. Plain Node keeps only PNG chat images up to 256×256 and avatars up to 128×128, and says "Open the desktop app". The unguarded `require('electron')` can start an Electron binary download from plain Node. | A new adapter: a bounded decoder for untrusted images (WASM or a native dependency, an owner decision). Guard the require now. | 2 (external material is data) | M |
| C17 | `src/core/attachments.ts:21` | Attachment names are stripped of both `\` and `/` separators. | Works as-is. | 5 | — |

### Credentials, Gmail and desktop callbacks

| # | Location (9481cb0) | What the code does | Linux needs | Rule | Size |
| --- | --- | --- | --- | --- | --- |
| C18 | `src/core/credentials.ts:31-74`; `src/core/logins.ts:28-47`; persistence in `src/main/credentials.ts` | Only the Electron `safeStorage` (DPAPI) store persists secrets. `MemoryCredentialStore` loses API keys, Gmail tokens and saved website logins on restart. With a non-persistent store, `LoginVault.remove` throws "Retry when Windows credential protection is available" (line 46) after it has already removed the login in memory. | A new adapter: a server secret store. That is an **owner decision** (OS keyring, file encrypted with an operator key, or an external KMS). Rule 6 requirements carry over: keyed ciphertext removal without decryption, never overwriting an unreadable store, and no plaintext. | **6** | L |
| C19 | `src/core/gmail.ts:61-92` | Gmail sign-in listens on `127.0.0.1:<random>`, checks `Host`, state and PKCE, and opens the Google page with `openLink`. The redirect works only when the browser runs on the same machine as Riot. The client JSON comes from a native file picker (`src/main/ipc.ts:73-81`). | A new adapter: a redirect through the server's authenticated origin, or a pasted code, keeping state, PKCE, fixed Google endpoints and encrypted token persistence. It depends on C18 and the transport. | **8** | M–L |
| C20 | `src/core/app.ts:98-101`, `:173-176`, `:319`, `:331`, `:398`, `:523`; `src/core/service.ts:225` | `openFolder`, `revealFile`, `writeClipboard` and `openLink` are optional desktop callbacks. Without them the engine returns "Open the desktop app…". | Works as-is (refuses cleanly). A server replaces them through the transport: see section 3. | 1, 7 | — |

### Process lifetime and runtime

| # | Location (9481cb0) | What the code does | Linux needs | Rule | Size |
| --- | --- | --- | --- | --- | --- |
| C21 | `src/core/service.ts:59-61`; `src/main/index.ts:22-23`, `:345-355` | The schedule timer is `unref()`ed, so Electron keeps the process alive. Electron's single-instance lock and `before-quit` call `riot.close()`. | A headless entry that holds the process open, closes on SIGINT/SIGTERM, and locks the data directory so two processes never fire schedules or recover jobs twice. | 9 (recovery, missed schedules) | S |
| C22 | `src/main/index.ts:240`, `:245-246` | Model catalogs and Gmail use Electron `net.fetch`, which applies Windows proxy settings and the OS certificate store. | Node `fetch` ignores the system proxy and uses bundled CAs unless configured (`NODE_USE_SYSTEM_CA`, `NODE_EXTRA_CA_CERTS`, a proxy agent). Keep TLS validation. | 8 (fixed Google endpoints) | S |
| C23 | `src/core/sqlite.ts:1-26` | `node:sqlite`. | Works as-is on Node 22.13 and later (Node 22 prints an experimental warning). | — | — |
| C24 | `src/core/web.ts`, `research.ts`, `browser-proxy.ts` | Pinned public-web transport, DNS checks and the browser proxy use Node `net`, `tls` and `dns`. | Works as-is (their tests pass on Linux). Browser-side containment is re-verified under C15. | 4 | — |
| C25 | `src/core/context-policy.ts:109` | The terminal tool group is selected by keywords including "powershell" but not "bash". | Works as-is; adding "bash" is cosmetic. | — | S |
| C26 | `src/core/terminal.ts:99`, `logins.ts:46`, `path-safety.ts:45`, `workspace.ts:26/45/55`, `codex.ts:261`; `src/main/credentials.ts:31-33`; `src/main/ipc.ts:183`; `src/renderer/src/email.tsx:17` | User-visible text names Windows ("Win+Shift+S", "Windows credential protection"). | Wording only. | — | S |

## 2. Tests that assume Windows

From the unmodified `9481cb0` suite on Linux (WSL Ubuntu 24.04, Node 22.20). With a display: 363 passed, 6 failed, 6 skipped. Without one: 362 passed, 7 failed, 6 skipped. Typecheck passed. On Windows the same suite passes.

**Fail on Linux**

| Test (9481cb0) | Why it fails | Fix |
| --- | --- | --- |
| `tests/terminal.test.ts:34` "stops a running process tree" | It uses Windows `ping -n 30` (on Linux, `-n` means numeric output and the command pings forever). It also runs into C2: the run does not return after Stop. It timed out at 20 s in both runs. | Pick the command by platform, and add a POSIX test that a child program really ends (C2). |
| `tests/files.test.ts:22` "rejects traversal and junction escapes" | It creates the junction with `cmd.exe /c mklink /J` (line 35). | Use a directory symlink on POSIX; the escape checks catch it. |
| `tests/browser-tabs.test.ts:12` "uses installed chrome/msedge…" (2 tests) | It stubs Windows install folders, and `installedBrowserChannel` is Windows-only (C13). | Windows-only, or Linux paths once C13 is done. |
| `tests/browser-tabs.test.ts:36` "removes closed tabs…" | Playwright is mocked, but no browser is stubbed, so it passes on Windows only because a real Chrome or Edge is installed. | Stub a bundled Chromium file. On a display-less runner it would also need a stubbed `DISPLAY` once C11 is gated. |
| `tests/history-pages.test.ts:7` "opens a bounded page…" | Not Windows-specific. It makes 2,081 separate SQLite inserts: 7.6 s alone, 27–41 s under the full parallel run, against a 20 s limit. | Raise that test's limit, or batch the inserts. |
| `tests/codex.test.ts:289` "closes a server that ignores interruption…" | Failed in 1 of 2 Linux runs (10 s limit) and passed in the other. It exercises the POSIX shutdown path (C4). | Moot if native Codex is unsupported on Linux (C3); otherwise investigate. |

**Skipped on Linux without an installed browser** (these are also the checks that matter most for C11–C15):

- `tests/search-dom.test.ts`: 4 tests.
- `tests/website-check.test.ts`: 2 real-browser containment tests.
- `tests/browser-network.test.ts:20`: detects channels only by Windows install folder (lines 13-18), so on Linux it can run only with Playwright's own Chromium.

**Pass on Linux but encode Windows:**

- `tests/disk-space.test.ts:12-15` and `tests/search.test.ts:21-25` pass `'win32'` explicitly, so they test Windows logic on any host.
- `tests/codex.test.ts:316` checks the Windows sandbox refusal only inside `if (process.platform === 'win32')`.

**Side effect seen on Linux:** in the first run, `require('electron')` from plain Node (C16) printed "Downloading Electron binary..." during the tests and fetched the Electron binary. The copy had been installed without it, as a server install would be.

**Direct probe of `9481cb0` on Linux:**

- Terminal Stop with an 8 s time limit on `sleep 30 & …; wait`: the run had not returned after 20 s (C2).
- `getDiskSpace('/mnt/c')`, a 9p mount of the Windows drive: queried, not refused (C6).
- `CodexService` with a command present: reports `installed: true` and is ready to start a native turn with no sandbox check (C3).

## 3. Desktop-only features in `src/main` and what a server needs instead

| Desktop feature | Where (9481cb0) | Server replacement |
| --- | --- | --- |
| Window, `app://` protocol, CSP, navigation and permission denial | `src/main/index.ts:15-20`, `:180-231`, `:309-317`; `src/main/security.ts` | An HTTP server that serves the built renderer with the same CSP, behind owner authentication. No remote pages in the UI origin. |
| IPC bridge with sender checks and runtime argument checks | `src/preload/index.ts`; `src/main/ipc.ts:48-255`, `assertSender` at `:256` | `RiotBridge` over an authenticated HTTP/WebSocket transport. Reuse the same runtime argument validators. Origin/CSRF checks and session binding replace `assertSender`. `src/renderer/src/ui.tsx:82` strips an Electron-specific error prefix. |
| Single-instance lock | `src/main/index.ts:22-23` | A data-directory lock file (C21). |
| Tray: status, Stop all work, Quit | `src/main/index.ts:142-159`, `:290-305` | A status indicator and Stop all in the web UI. Quit becomes SIGTERM from a service manager. |
| Notice popup window | `src/main/index.ts:58-140`, `:271-289`; `src/core/notices.ts` | In-app notices pushed over the WebSocket. Optional Web Push later (owner decision). |
| Folder picker for workspaces | `src/main/ipc.ts:244-250` (`workspace:pick`) | A server-side folder chooser limited to configured roots, with path and network validation (C7, C10). |
| File pickers for attachments and the Gmail client file | `src/main/ipc.ts:163-176` (`attachments:pick`), `:73-81` (`gmail:importClient`) | Browser uploads over the transport, with the existing size and type limits (`attachments:stage` already accepts bytes). |
| Clipboard write and pasted screenshots | `src/main/ipc.ts:134`, `:177-187`; `src/main/index.ts:252-254` | The client browser's Clipboard API. The server never touches a clipboard. |
| Reveal in Explorer, open folder | `src/main/index.ts:248-251` (`shell.openPath`, `shell.showItemInFolder`) | Ownership-checked download and preview endpoints for Library artifacts and workspace files (`resolveWorkspacePath`, rule 7). |
| Open links | `src/main/index.ts:255-257` (`shell.openExternal`); used by Gmail and Codex sign-in | Return the vetted HTTPS URL for the client to open. |
| Native bot context menu | `src/main/ipc.ts:100-133` (`Menu.buildFromTemplate`) | A menu drawn by the renderer. |
| Gmail sign-in on `127.0.0.1` | `src/core/gmail.ts:61-92` | See C19. |
| Credential store (`safeStorage`/DPAPI, `credentials.bin.json`) | `src/main/credentials.ts:11-110` | A server secret store (C18, owner decision). |
| Chromium installer in a utility process with a worker adapter | `src/core/browser-playwright.ts:97-125`; `src/main/browser-installer.ts` | Plain Node can run the locked Playwright CLI directly, with no RunAsNode fuse to work around. Host system libraries are still needed. Revalidate on Playwright upgrades (rule 10). |
| Electron `net.fetch` for catalogs and Gmail | `src/main/index.ts:240` | Node `fetch` with proxy and CA configuration (C22). |
| File logger, user-data folder, `PLAYWRIGHT_BROWSERS_PATH` | `src/main/index.ts:165-178`, `:235-238` | The same file logger (or stdout) in a configured data directory. |
| Fuses, ASAR integrity and signing | `electron-builder.yml` | Server packaging: a pinned base image, a non-root user, a read-only application directory, and data on a volume. |

## 4. Recommended order for a future headless step

1. **Desktop-safe groundwork**, which also helps the desktop launch:
   - require Electron only under Electron (C14, C16)
   - call `taskkill.exe` by its System32 path (C2)
   - validate workspace paths against network locations (C7)
   - neutral wording (C26)
2. **Headless entry**:
   - data-directory lock, signal shutdown and a memory-only credential store, stated at startup (C21)
   - native Codex refused off Windows (C3)
   - visible browser refused without a display (C11)
3. **POSIX equivalents**:
   - terminal process groups (C2, C4)
   - mount classification for disk space and workspaces (C6, C7)
   - portable versions of the Windows-only tests
   - a Linux CI job
4. **Transport and owner authentication**, replacing `src/main` (section 3).
5. **Server secret store** after the owner decides (C18), then Gmail server sign-in (C19) and saved website logins.
6. **Browser on a server**: virtual display, live view and takeover, Chromium sandbox requirements, and real-browser boundary tests on Linux (C11–C15).
7. **Image decoder adapter** (C16).
8. **Docker image.** Native Codex on Linux comes only after its sandbox is verified (C3).

The parked prototype covers most of steps 1–3 and is a starting point, not a reviewed implementation.

## 5. Observation outside portability

Workspace confinement uses `realpath` and symlink checks, and a hard link is not a link to those checks. A hard link inside a workspace to a file elsewhere that the user can write (created through the approved terminal or a native tool) would be read as a workspace file, and `sensitivePath` sees only the link's name. This applies to Windows and Linux alike. It was not tested and is noted for a later security review.
