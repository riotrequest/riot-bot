# Saved logins and permissions

Riot should remember the access you give it. Ordinary workspace work and public-source research do not need a prompt for every action. Each bot keeps its browser sessions, encrypted website logins and remembered site access across restarts.

## Save a login once

In **Bot settings → Files & tools → Saved website logins**, enter the HTTPS website, username/email and password, then choose **Save login**. Ask the bot to sign in. You can also give a directly addressed chat command with labelled fields:

```text
Remember this login and sign in:
site: https://example.com
username: your-username
password: "your password here"
```

Use quotation marks around a password containing spaces. This is a local parsing format, not a promise that arbitrary prose containing a password can be recognized. Quoted emails, blockquotes and code blocks do not save logins or grant access. Use the settings form for unusual passwords or when you want to keep the password out of the chat composer entirely.

The app captures supported login commands before queueing or sending them to the model. The password goes into the existing Windows-protected credential store, separately from SQLite chat/history/memory. The model sees login metadata and an opaque ID, then asks Riot to fill observed fields. Riot checks the bot, saved login, current HTTPS origin and current element references before entering the password locally into the website. The model never needs the saved password as a tool argument. The destination website receives what is entered into its form.

The credential file is updated atomically. If protected storage cannot be updated, Riot reports that the new value is **session only** and never writes a plaintext fallback. It must be entered again after quitting in that failure case. Removing a login deletes its persisted entry even when Windows encryption is unavailable; a deletion failure is reported. Deleting a bot removes its saved logins too. Windows encryption protects stored values; it does not isolate them from software running as your Windows account.

Browser cookies and site storage remain in that bot's separate Chromium profile. Website expiry, logout, MFA and CAPTCHA can still require the website's own verification. Use **Profile & browser → Open browser / Use browser myself** to complete it, then let the bot continue.

## Remember website access

Saving a login also grants that bot access to the exact HTTPS website. For another interactive website or a generated destination, a site card offers **Remember & allow**, **This task only**, and **Deny**. Remembered permission includes sharing information with the site, filling forms and clicking controls that can send, publish, pay or delete. Give it to sites you intend the bot to operate. Page text or button labels cannot grant it. The scheme, host and port must match; a subdomain or different port needs its own access.

Inspect and remove grants under **Bot settings → Files & tools → Remembered website access**, then save settings. Removing a saved login and revoking site access are separate actions. Revoking access does not log out existing website cookies or cancel work already performed. Stop the task before changing access if you need to prevent another in-flight action.

Public URLs directly supplied by you, and exact URLs found in public web results, can be read without another site prompt. A generated URL can carry private text in its path or query, so a new destination requires access. Once private Riot tool sources have been read, search queries need access to their search site too; remember that site to avoid repeated prompts. These checks reduce unintended sharing. They are not a complete data-loss-prevention system: approved sites, public pages and their redirects can receive requests, queries can contain sensitive material, and source provenance can be incomplete after earlier history/compaction. Native Codex's built-in search and commands follow its own rules.

## Project files and powerful actions

Riot file tools stay within the bot's working folder. Common credential files, including `.env`, private keys and cloud credential folders, are blocked by default and omitted from file-content searches. If a project requires them, enable **Allow project secrets** once for that working folder. Their contents may then reach the AI connection. Changing folders resets this grant and editing permission in the settings form. Known stored credentials are still redacted from ordinary model text, streamed replies, tool results, activity and chat; source files and exact-byte undo copies are preserved separately. Filename checks and redaction cannot recognize every secret, image or confidential document.

An API terminal command still requires review of the exact command because it runs with your Windows user's access. A working directory does not contain that shell. Gmail sends retain their complete-message review and uncertain-send protection. Remembering a website does not approve terminal commands or Gmail sends.

Native Codex uses its own Windows sandbox. The installed legacy policy allows broader filesystem reads than Riot's file tools; the **Allow project secrets** switch does not restrict those native reads. Bots are separated in Riot's APIs, but native reads are not a confidentiality boundary between them. See [Codex permissions](codex.md#permissions-and-sessions).

Disk-space checks accept local drives and folders, rejecting network shares, mapped network drives and links into remote locations before the capacity query. Drive classification uses a fixed noninteractive Windows helper; it never executes a model-provided command.

## Development and eventual distribution

`npm run check` runs type checks, tests and the production build. GitHub CI also audits dependencies and uses a pinned, checksum-verified Gitleaks scanner for full history and current files. Dependency updates are proposed weekly. Runtime data, keys and browser profiles are ignored by Git; still inspect what you stage.

`npm run dist:win` creates a local development installer. `npm run dist:win:release` additionally requires configured publisher signing and fails without it. [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) disable RunAsNode, NODE_OPTIONS, Node CLI inspection and extra file-protocol privileges, and require the main app's integrity-checked ASAR. The optional Chromium installer uses a utility process and replaces only Playwright's known download-helper fork with a worker thread; other fork targets are refused. This compatibility adapter is checked against the locked Playwright layout and must be revalidated on upgrades. On Windows it enables [Node's system CA trust](https://nodejs.org/api/cli.html#node_use_system_ca1) while retaining TLS validation. Unpacked Playwright files are outside the ASAR integrity guarantee; signing and trusted installation permissions still matter.

The project is not being published as part of this work. Choosing a license, enabling a private reporting route and configuring a publisher certificate remain owner decisions for the eventual release. Existing installers predate these changes; do not treat them as hardened builds. [The review](security-review.md) records verification and remaining work.
