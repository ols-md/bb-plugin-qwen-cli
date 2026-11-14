# Contributing safely

## Before your first commit

1. Install [Gitleaks](https://github.com/gitleaks/gitleaks#installing) v8.30.1.
2. Enable the staged-secret check: `git config --local core.hooksPath .githooks`.
3. If you want email privacy, copy your exact GitHub noreply address from
   Settings > Emails, then run `git config --local user.email "YOUR_NOREPLY_ADDRESS"`.
   Enable "Keep my email addresses private" and "Block command line pushes that
   expose my email" in GitHub too. Existing commits retain their original identity.

The hook checks staged changes and redacts findings. CI independently scans Git
history, including contributors who do not install the hook. Never bypass a finding
without investigating it. Use obvious dummy values in examples and tests.

## Before publishing a PR or release

- Review `git diff --cached` and check `git var GIT_AUTHOR_IDENT`.
- Keep real credentials outside the repository. Ignore rules do not remove files
  already tracked by Git.
- Review screenshots, logs, attachments, and release notes for names, private
  email addresses, machine paths, customer data, and credentials.
- Run `gitleaks git --redact --log-opts="--all" .`, `npm test`, and `npm run check`.
- Submit a PR and wait for `check` and `Secret scan` to pass before merging.
- If a secret was published, revoke or rotate it immediately, then arrange cleanup.

## GitHub repository settings (maintainers)

- Enable secret scanning and push protection under Settings > Security.
- Protect `master`: require PRs and passing `check` and `Secret scan` checks,
  require branches to be up to date, and disallow force pushes and deletion.
- Keep Actions tokens read-only by default. Do not give untrusted PR code secrets.
- Review Dependabot updates and keep workflow Actions pinned to full commit SHAs.
