# Security

## Reporting a vulnerability

Please report vulnerabilities privately. Don't post them in public issues, pull requests or discussions.

- **GitHub:** [Report a vulnerability](https://github.com/riotrequest/riot-bot/security/advisories/new) (the repository's **Security** tab → **Report a vulnerability**). Only you and the maintainers can see the report, and the discussion stays private until a fix is published.
- **Email:** [security@riotrequest.com](mailto:security@riotrequest.com), if you'd rather not use GitHub.

For a report, include the affected version/commit, operating system, steps using synthetic data, expected versus observed behavior, and any relevant redacted logs. Never include real passwords, provider keys, cookies, OAuth tokens, app-data backups or private messages. Verify fixes with disposable profiles and local sentinels; avoid real accounts and paid model requests.

## Supported versions

Riot Bot is an early preview (version 0.1.0) with no published releases yet. Security fixes land on the `main` branch.

## Scope and limitations

The current boundaries, implementation follow-up and remaining limitations are documented in [docs/security-review.md](docs/security-review.md). Saved logins and remembered website permissions are explained in [docs/security.md](docs/security.md). Contributor instructions are in [AGENTS.md](AGENTS.md).

CI checks code, dependency advisories and secrets. Passing these checks is not a guarantee against prompt injection or compromise. The app is a local assistant with access the owner grants, and approved terminal commands and native Codex tools have broader access than Riot Bot's scoped file tools.
