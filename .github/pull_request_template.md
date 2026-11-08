<!--
Thanks for contributing! CONTRIBUTING.md covers setup and test expectations, and the
"Security rules for changes" in AGENTS.md apply to every change.

Never include real passwords, API keys, tokens, cookies, private emails or app-data in
this description, in screenshots, or in test fixtures.
-->

## Summary

<!-- What does this change do, and why? Link the issue it addresses, if there is one. -->

## Checks run

<!-- Tick only what you actually ran. Report failures and skipped checks plainly. -->

- [ ] `npm run check` (typecheck, full test suite, production build)
- [ ] Focused tests: `npm test -- tests/<file>.test.ts` (list the files)
- [ ] `npm audit --omit=dev`
- [ ] `git diff --check`
- [ ] Manual check in the running app with disposable data (describe what you checked)
- [ ] Documentation-only change: links and content reviewed

Failures or skipped checks, and why:

## Tests

- [ ] New or changed behavior has tests that use disposable data, mocked providers and fake credentials, and touch no real account.
- [ ] A security fix includes a test of observable behavior at the boundary, including the denied case.
- [ ] Not applicable (explain):

## Documentation

- [ ] Updated the relevant docs (`docs/`, the user guide, or the README feature tour) for user-visible changes
- [ ] Added an entry under **Unreleased** in `CHANGELOG.md`
- [ ] No documentation change needed

## Security-rule impact

<!-- Which of the "Security rules for changes" in AGENTS.md does this change touch?
     Tick each one that applies and explain below how the rule still holds. -->

- [ ] None: no security-relevant area is touched
- [ ] 1. Privileged decisions, IPC or the renderer bridge
- [ ] 2. External material: pages, emails, attachments, tool output, memories, skills
- [ ] 3. Site access, approvals or remembered permissions
- [ ] 4. Network paths, URL/DNS checks or browser transport
- [ ] 5. File operations, workspace paths or undo
- [ ] 6. Credentials, the login vault or redaction
- [ ] 7. Ownership filters for bots, accounts or runs
- [ ] 8. Gmail sending or OAuth
- [ ] 9. Spending limits, cancellation or recovery
- [ ] 10. Packaging, CI, dependencies or shipped artifacts

How the affected rules still hold:

## Data hygiene

- [ ] This pull request adds no runtime data, keys, OAuth setup files, browser profiles, databases, logs or backups.
