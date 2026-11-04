# Security

Riot Bot is in private development. A public vulnerability-reporting channel and supported-release policy have not been established yet. Before making the repository public, the owner must enable GitHub private vulnerability reporting (or publish a private contact) and verify that the route works. Do not invent an address or route reports into public issues containing secrets.

For a report, include the affected version/commit, operating system, steps using synthetic data, expected versus observed behavior, and any relevant redacted logs. Never include real passwords, provider keys, cookies, OAuth tokens, app-data backups or private messages. Verify fixes with disposable profiles and local sentinels; avoid real accounts and paid model requests.

The current boundaries, implementation follow-up and remaining limitations are documented in [docs/security-review.md](docs/security-review.md). Saved logins and remembered website permissions are explained in [docs/security.md](docs/security.md). Contributor instructions are in [AGENTS.md](AGENTS.md).

CI checks code, dependency advisories and secrets. Passing these checks is not a guarantee against prompt injection or compromise. The app is a local assistant with access the owner grants, and approved terminal commands and native Codex tools have broader access than Riot's scoped file tools.
