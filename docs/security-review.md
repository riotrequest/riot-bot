# Riot Bot pre-release security review

Reviewed November 3, 2026 (America/New_York), at commit `229c0c405671af6230376d3d6a1efeaaaf1dbf95`.

The original audit below records the behavior at that commit. The owner subsequently authorized implementation, with persistent logins and low-friction access as product requirements. They are not publishing the project yet. The follow-up changes are in the working tree; no commit, push or release was made by this work.

P1 means high-priority security work before release. P2 means a narrower security defect or release-hardening gap. These are review priorities, not CVSS scores. Evidence distinguishes real browser observations, isolated application probes, and conditional platform risks.

## Implementation follow-up

| Item | Current state | Regression/verification |
| --- | --- | --- |
| RB-01 | Fixed for the tested Chromium channels. Both supported WebRTC IP-policy switch spellings are set; the static checker also uses a deny-all proxy. | Real bundled Chromium and installed Chrome/Edge, STUN/TURN UDP/TCP loopback sentinels, and the real static checker. No forbidden traffic observed. |
| RB-02 | Fixed through application-owned per-bot site grants. Clicks and fills on unapproved sites require access, regardless of page role/label. Grants can persist; saved logins grant their exact HTTPS origin. Element references bind to actual nodes. | Real DOM autosave/link handlers remain untouched on denial, then work after site access. Replacing a node cannot reuse its old reference. Login/approval/ownership/revocation fixtures cover the application path. |
| RB-03 | Fixed for registered credentials in ordinary textual tool/model/chat/activity paths, including successful results and chunked replies. Source-file/undo bytes stay intact. | Registered synthetic credentials absent from subsequent model messages, queued jobs, snapshots, activity and ordinary transcripts; split streams and short passwords covered. |
| RB-04 | Fixed for the tested direct paths, mapped drives and remote link targets. Local drive classification precedes `statfs`. | Mocked filesystem denial boundary plus real local capacity checks with editing off. No SMB challenge or real authentication test performed. |
| RB-05 | Fixed. Atomic credential-file updates; deletion does not require available crypto. Unreadable stores and failed deletions are not silently replaced/reported as removed. | API/Gmail crypto-fallback → clear → restart, unavailable crypto at startup, preservation of other entries, and persistent deletion failure. |
| RB-06 | Packaging hardening implemented; actual signed distribution remains deferred. Local builds remain available; the separate release config requires signing. | Rebuilt local Windows app and inspected actual fuses. See artifact validation below; a local unsigned app is not a signed public release. |

The login vault keeps passwords in the existing Windows-protected credential store, scoped by bot and exact HTTPS origin, and passes only metadata/opaque IDs to the model. Supported direct chat login commands are captured before durable queue storage and model input. The settings UI provides a separate form. The model asks the app to fill observed fields locally, without receiving the password. Browser sessions persist. A real Electron UI test saved a fake login through the form, restarted and recovered its metadata/site permission, removed it, restarted again and confirmed absence; the stored credential file contained no plaintext password and no renderer errors occurred.

Generated web destinations now require application-owned site access unless the exact URL came from the user or a public web result. Search after private Riot-source reads also requires its search site's access. This addresses the demonstrated generated-query-string path while preserving public-source research and remembered sites. It is not full information-flow control: approved destinations can receive private material, public-page requests/redirects remain possible, provenance is conservative/incomplete across older history, and native built-in tools have their own behavior. The owner chose broad, remembered website authority to avoid per-click prompts. [Current permission scopes](security.md) explain that this includes consequential website actions.

Common project-secret files are blocked in Riot's content tools by default, with an explicit per-workspace grant for projects that need them. IPC now checks the exact main frame and parsed development origin; packaged builds ignore the development renderer URL. Proxy shutdown closes lingering browser sockets, including CONNECT tunnels, and cancels abandoned outbound connections; this fixed an Edge shutdown hang found during the full suite.

CI is configured to run the existing checks and dependency audits on Windows, with SHA-pinned checkout/setup actions, a checksum-pinned Gitleaks binary, and weekly dependency/action update proposals. Gitleaks 8.30.1 scanned all 19 reachable commits (~1.71 MB) and the current Git-eligible source tree without a finding. CI workflows are prepared locally; no remote workflow run is claimed. `.gitignore` also excludes common credential files, private keys and bot browser data. [SECURITY.md](../SECURITY.md) records the pending private reporting route. A license, contact and publisher identity were not invented.

The full follow-up check passed TypeScript, **44 test files / 281 tests**, and the production build with the downloaded Chromium cache selected, covering all three browser channels. Production dependency audit: **0** advisories. Full dependency audit: **15 moderate** packaging/development affected packages, no high/critical advisories. The installed electron-builder 26.18.0 is already the current published release; forcing a downgrade or unrelated major transitive override was not treated as a fix. The full audit remains visible in CI, with high/critical findings blocking; production advisories block at any level.

## Local artifact validation

An isolated unpacked Windows application was rebuilt using Electron 45.2.1 from the installed runtime. Actual binary inspection confirmed RunAsNode, NODE_OPTIONS, Node CLI inspection and file-protocol extra privileges disabled; cookie encryption, embedded ASAR integrity and ASAR-only main-app loading enabled.

The packaged application started with its own disposable user-data directory, loaded the sandboxed renderer/preload IPC bridge and saved a synthetic login through real Windows credential protection. Its snapshot and credential file did not contain the plaintext password. From that same hardened package, the optional installer actually downloaded Chromium v1248, the headless shell, FFmpeg and Winldd into the disposable profile and returned **Chromium is installed.** The final package also opened and closed the downloaded Chromium through the real app bridge, with an intentionally different browser-cache path in its startup environment. The app and checker choose the app-owned executable explicitly, avoiding Playwright's cached import-time path. No renderer errors were recorded. Playwright's known nested download helper now runs in a worker thread within the utility process; the CLI command is awaited explicitly so the utility exits and clears the Installing state. Tests cover worker message/exit behavior and refusal of unexpected fork targets.

Authenticode inspection still reports **NotSigned**, as expected without the owner's signing identity. A no-signer build using the release config was also tested: it failed with `App is not signed and "forceCodeSigning" is set to true`, as intended. No public installer was produced or installed. Signed-artifact, fresh NSIS install/uninstall and tamper acceptance remain requirements for the eventual release. No paid model call, real website login, email send or normal owner profile was used in the follow-up tests.

## Original findings at the reviewed commit

The following evidence and line numbers describe the original commit, not the subsequently modified files.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| RB-01 | P1 | WebRTC bypasses the browser network restriction and the static checker | Real Chrome and the real website checker sent loopback UDP |
| RB-02 | P1 | Page-controlled roles/labels and text filling bypass browser action review | Actual browser DOM effects; application confirmation count stayed zero |
| RB-03 | P1 | Successful tool output exposes known credentials to the model and transcript | Fake stored credential appeared in the next model request, SQLite tool record, and renderer snapshot |
| RB-04 | P1, conditional | Disk-space tool accepts network filesystem paths without approval | UNC path reached the mocked OS boundary; SMB/NTLM impact depends on Windows/network policy |
| RB-05 | P2 | Removed credentials can return after an encryption failure and restart | Isolated credential-store probe with mocked OS crypto |
| RB-06 | P2 | Release signing and executable hardening are not configured | Existing installer/application are unsigned; fuse inspection confirmed permissive defaults |

### RB-01: WebRTC network isolation is ineffective

Locations: `src/core/browser-playwright.ts:18`, `src/core/website-check.ts:47`, and `src/core/website-check.ts:81`.

Both browser launch paths use `--disable-features=WebRTC`. On installed Chrome **156.0.8078.80**, that flag left `RTCPeerConnection` functional. An isolated page created a data channel and an ICE server pointing to a UDP listener bound only to `127.0.0.1`. It sent four packets despite using the product's browser proxy settings. No external site or server was contacted by the probe.

The actual `verifyWebsite` function was then given an HTML fixture containing the same operation. Both viewports completed, two loopback UDP packets arrived, and its report said `status: passed` and `externalNetwork: blocked`. Its CSP, HTTP routing, service-worker blocking, and WebSocket blocking did not stop this traffic.

An untrusted page therefore has a network path outside the proxy's destination checks. This establishes unauthorized local UDP reachability; it does **not** establish arbitrary private HTTP reads or an OS sandbox escape. Public STUN/peer endpoints can also create a route for address exposure and traffic outside the intended proxy boundary.

Fix direction: enforce a tested WebRTC/non-proxied-traffic restriction for interactive browsing and a deny-by-default network boundary for static verification. Do not assume a feature-name flag disables an entire API. Chromium documents a separate [WebRTC IP handling policy](https://chromium.googlesource.com/chromium/src/%2B/376fc41e87a058f7a7b300b0ec3a4982b4ec0960/components/policy/resources/templates/policy_definitions/Miscellaneous/WebRtcIPHandling.yaml). Validate the chosen solution across bundled Chromium and supported installed browser channels. A JavaScript-only API shim is insufficient as the sole security boundary.

Acceptance: real local TCP/UDP sentinels see no forbidden traffic during `open_url` and `verify_website`, including WebRTC/STUN/TURN attempts. The checker must not claim all networking is blocked when an untested transport remains available.

### RB-02: Browser approval depends on untrusted page semantics

Locations: `src/core/browser-policy.ts:149`, `src/core/browser.ts:436`, `src/core/browser.ts:451`, and `src/core/browser-playwright.ts:301`.

`clickNeedsApproval` exempts controls reported as `link`, `textbox`, or `searchbox` unless their English label matches the consequential-action regex. The reported role comes from the page's `role` attribute when present. A real button can claim `role="link"`, and an ordinary anchor can run a state-changing JavaScript handler. A link labeled **View details** was classified as requiring no approval and its click ran a handler that changed the fixture's state to `sent`. A non-English action label also passed the policy probe.

`fill` does not call the confirmation callback. Playwright's `fill` dispatches input events, so the real fixture's input handler immediately changed state to `autosaved`. A signed-in application's autosave or messaging handler can act before the bot ever clicks a Send button. The real `BrowserService` probe performed both a click and fill with **zero** confirmations. DOM effects were verified separately in a real browser; no real message or purchase was made.

Fix direction: do not infer permission from page-supplied labels, roles, or absence of a form submission. Require explicit authority for interactive click/fill operations on untrusted pages, with narrow reviewed exceptions for known search/navigation workflows. Show the destination and the actual proposed input before exposing it to page scripts. Expanding the keyword list does not solve this class of bug.

Acceptance: neutral links with handlers, buttons claiming link/textbox roles, non-English controls, and input-event autosaves cannot cause an unapproved action. Keep ordinary research available through bounded reads and navigation.

### RB-03: Successful tool results bypass credential protection

Locations: `src/core/files.ts:90`, `src/core/app.ts:1893`, `src/core/app.ts:2300`, and `src/core/gateway.ts:64`.

Errors are redacted, but successful `dispatchTool` results go unchanged into `finishTool`, the conversation, and subsequent provider context. `read_file` also accepts `.env` and other credential-bearing text files within the workspace. A fake value registered in the credential store and repeated in a workspace `.env` appeared in the next `ModelProvider.complete` request, the persisted tool record, and `getSnapshot()`.

This requires the credential to appear in readable workspace/reference content; the probe did not extract or decrypt the credential store. It shows that known-secret protection ceases to apply when the value arrives through a successful tool. Error-only redaction tests do not cover this case. Other sensitive contents can follow the same route even when they do not match a credential pattern.

Fix direction: keep raw source/edit/undo data separate from model-visible tool results. Redact known credential values before transcript/tool-result persistence and outbound model requests; protect successful and streamed content as well as errors. Add an explicit policy for reading sensitive files such as `.env`, rather than treating workspace membership as consent to disclose their contents. Do not alter original file bytes or break exact-byte undo in the process.

Acceptance: a fake registered credential returned through file reading, search excerpts, attachments, and successful tool output is absent from provider messages, renderer events/snapshots, and ordinary persisted transcripts/activity. Tests must include the success path and split stream chunks where applicable.

### RB-04: Disk-space queries can become Windows network operations

Locations: `src/core/disk-space.ts:6`, `src/core/app.ts:1941`, and the native `riot_get_disk_space` exposure in `src/core/app.ts`.

The tool resolves any model-supplied path and immediately calls `fs.statfs`. There is no rejection of UNC/device network namespaces, no destination approval, and no connection to the public-web checks. It is available with editing disabled. A probe passed `\\collector.invalid\share\` through the real function and observed it reaching a mocked `fs.statfs` unchanged.

The unsafe input acceptance is confirmed. The potential SMB authentication consequence is a **platform-based inference**, not a captured authentication attempt: no real SMB server, credential challenge, or external share was used. [Node's Windows libuv implementation](https://github.com/nodejs/node/blob/v22.23.4/deps/uv/src/win/fs.c) performs native filesystem operations for the supplied path. Windows supports network shares, and Microsoft documents the risk of outbound NTLM requests to malicious servers and the [policy available to block them](https://learn.microsoft.com/en-us/windows-server/storage/file-server/smb-ntlm-blocking). On affected configurations, a prompt-influenced disk-space call can initiate network authentication outside the normal approval path. Slow network filesystem calls also lack this tool's own abort handling.

Fix direction: validate local filesystem locations before any OS lookup. Reject arbitrary UNC/device network paths by default and account for mapped network drives and remote reparse targets. If network-volume support is required, make it an explicit user-authorized feature. Preserve routine local disk-space checks without terminal commands.

Acceptance: Windows UNC, extended UNC/device spellings, and unapproved remote volumes are rejected before the filesystem function is invoked. Local drive/folder capacity checks still work with editing off. Use mocks or a disposable Windows lab for network-volume tests; never solicit the owner's real credentials.

### RB-05: Credential deletion silently skips persistent storage after fallback

Locations: `src/main/credentials.ts:46` and `src/main/credentials.ts:69`.

Any encryption or persistence exception during `set` changes `encryptionAvailable` to false. `clear` then removes only the session value and returns without removing the old encrypted entry. Once encryption becomes available on a later launch, that previous entry is loaded again.

The probe saved synthetic Gmail tokens, simulated an encryption failure during replacement, cleared Gmail, and created a fresh store with encryption available. The old tokens returned. Gmail disconnect and API-key removal both depend on this method. Windows encryption protects the remaining ciphertext but does not make a reported removal real.

Fix direction: separate the ability to encrypt/decrypt from the ability to delete a persisted entry. Remove the keyed ciphertext without requiring successful decryption; if removal cannot be persisted, surface that failure rather than reporting successful disconnection. Preserve other providers' entries and the safe in-memory fallback.

Acceptance: saved credential -> crypto failure/session fallback -> clear -> restart never restores the cleared credential. Cover both API keys and Gmail, unavailable crypto at startup, and a persistent deletion failure.

### RB-06: Public distribution lacks signing and selected Electron hardening

Locations: `electron-builder.yml:8`, `electron-builder.yml:15`, and `src/core/browser-playwright.ts:96`.

The packaging configuration disables executable signing/editing and contains no fuse policy. `Get-AuthenticodeSignature` reported **NotSigned** for the existing installer and unpacked application. Fuse inspection of that existing application showed `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, and `EnableNodeCliInspectArguments` enabled, with embedded ASAR integrity validation and ASAR-only loading disabled.

This is a release-integrity/hardening gap, not proof of a remote compromise or privilege escalation. The existing installer is dated November 1 and predates the reviewed HEAD; it cannot serve as evidence that the reviewed sources were packaged. Signing helps establish publisher identity, while an appropriate fuse/integrity configuration reduces alternate runtime entry points. See [Electron's fuse documentation](https://www.electronjs.org/docs/latest/tutorial/fuses).

Fix direction: define and verify a signed release process and compatible fuse policy, then rebuild from the reviewed commit. **Do not blindly disable RunAsNode:** Chromium installation intentionally launches the Playwright CLI through Electron with `ELECTRON_RUN_AS_NODE=1`. Replace that dependency or preserve it with a documented tradeoff and a working installer test. ASAR protection also does not automatically protect unpacked dependencies.

Acceptance: the distributed installer/application have the intended valid signatures; inspect the shipped binary's fuses and tamper behavior; test fresh installation and optional Chromium download from that same artifact.

## Architectural risks and remaining limitations

**Private-data egress is broader than the Send approval.** Public-address filtering prevents some SSRF, not disclosure to an attacker's public destination. The isolated RB-03 probe also had its mock provider request `fetch_url` with the read content in a query string. The mock transport received the fake credential with zero approvals. No external request was sent. Mail, history, and attachment contents could use the same permitted combination. This demonstrates the available action chain, not that a live model followed a specific prompt injection. Redaction alone cannot protect arbitrary confidential text. Decide how source-data sharing and new destinations are authorized, and preserve normal research through appropriately scoped access.

The follow-up implements remembered destination authority and registered-secret redaction as described above. It does not promise that arbitrary confidential content can never leave the computer. In particular, granting access to a website authorizes this bot to interact/share with that site. Source images, unknown secrets, historical records and native built-in tools are outside a universal redaction/DLP guarantee. Existing historical plaintext or private backups are not automatically rewritten or erased by this change.

**Native Codex bot separation is not filesystem confidentiality.** `src/core/codex.ts:264` and `:286` use native read-only/workspace-write policy. The existing [Codex guide](codex.md) and UI already disclose that the tested legacy Windows policy permits reads outside the workspace. This is an acknowledged limitation, not a newly verified sandbox escape. Bot A's native reads may reach shared local data containing bot B's cached mail/history even though the Riot connector enforces bot IDs. Do not advertise isolated confidential bots without testing and enforcing read restrictions in the native runtime. No authenticated native model turn was started for this review.

A signed-out disposable-profile check of the installed native CLI's named restricted-read permissions was refused because this Windows sandbox does not support the requested split reads. The connector continues using its working legacy sandbox; it was not switched to bypass mode or broken to claim isolation. Restricting native read confidentiality remains unresolved. The Riot file-secret toggle is not a native filesystem boundary.

## Original audit verification and scope

- `npm run check` passed: TypeScript, **40 test files / 262 tests**, and production build. No runtime source was changed by this review. Passing tests do not cover the adversarial behaviors above.
- Isolated probes exercised real Riot application/tool dispatch, real browser DOM actions, the actual website checker, mocked OS crypto, and a mocked filesystem boundary. Live browser observations used Chrome 156.0.8078.80. The interactive launch probe retained product security/proxy options but ran headless; the website checker used its own normal headless path. Do not assume identical results for every installed browser version.
- `npm audit --omit=dev` reported **0** advisories. Full `npm audit` reported **15 moderate** affected development/packaging packages, tracing to minimatch's [globparts amplification advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249). This is not 15 independent runtime exploits. Evaluate compatible packaging updates; the suggested forced downgrade is not a validated fix. Electron/Chromium ship to users despite Electron being listed as a development dependency, so a clean production npm audit is not a browser-engine security assessment.
- A heuristic pattern scan covered all **19 reachable commits**, **522 reachable Git objects**, and **344 text blobs**. Five candidates were inspected and were synthetic test fixtures. No likely live credential was identified by that scan. This was not an exhaustive entropy scan, full binary scan, or replacement for dedicated secret scanning. Untracked/ignored private data and remote hosts were not audited.
- Positive controls inspected include sandboxed/context-isolated renderer settings, restrictive production CSP, explicit IPC handlers with sender checks, no raw Markdown HTML or remote Markdown images, prepared SQL statements, bot-scoped data lookups, workspace traversal/junction checks, pinned public-web DNS connections, Gmail state/PKCE and reviewed-send recovery, bounded attachments, and exact-command API approvals.
- Source review focused on authorization, filesystem/network boundaries, credentials, browser execution, Gmail, job ownership, and packaging. No actual email was sent, paid model called, production profile opened, public package uploaded, or installer rebuilt.

The original delivered `security-probes.cjs` / results describe the pre-fix defects and are historical reproduction material. Current regression tests live in the repository, especially `browser-network`, `browser-installer`, `website-check`, `logins-and-access`, `credential-storage`, `credentials`, `disk-space`, `files`, `browser`, `bot-menu`, `approval-card` and `custom-endpoint` tests. The custom model endpoint added after this review is a new network path; its address, DNS, redirect and key-destination rules are described in [local and custom model endpoints](custom-endpoints.md). Run `npm run check`; do not treat the old exploit assertions as the current expected behavior.

## Release and maintenance work

1. Preserve these negative regression tests and [AGENTS.md](../AGENTS.md) as features are added. Document each new tool's data sources, destinations, permission checks, ownership, side effects, cancellation and retry behavior.
2. Keep the remaining native-read and private-data-sharing limitations visible; do not market per-bot confidentiality under the current native runtime.
3. Before public distribution, choose a license, enable and test private vulnerability reporting, configure the owner's signing identity, and rebuild from the exact reviewed release commit. Validate signatures, fresh install/uninstall and artifact tampering on that release. Existing installers in `release/` predate this work.
4. Recheck the 15 moderate packaging advisories when a compatible upstream fix is published. Keep dependency/scanner pins and the embedded browser runtime current.
