# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this plugin, please **do not** open a public issue.

Instead, report it privately:

- GitHub: [Report a vulnerability](https://github.com/ols-md/bb-plugin-qwen-cli/security/advisories/new)
- Email: security@ols.dev

You should receive a response within 48 hours.

## Scope

This policy covers the `bb-plugin-qwen-cli` codebase:

- `server.ts` — plugin registration and settings
- `host.ts` — ACP bridge that launches Qwen CLI
- `dialect.ts` — tool classification and presentation
- `prompt-mode.ts` — plan mode mapping

The plugin delegates all authentication and credential management to the locally installed Qwen Code CLI. It never stores, transmits, or logs API keys, tokens, or credentials.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |

## No Credential Handling

This plugin does not handle credentials. Authentication is entirely managed by Qwen Code CLI (`qwen --acp`). No API keys, OAuth tokens, or secrets are read, stored, or forwarded by this plugin. The only data persisted are boolean settings (enabled, autoApprove, sandbox, subagentsDisabled, commandDescriptionsEnabled).

## Dependencies

Dependencies are kept minimal:

- `@get-bb/plugin-sdk` — BB Plugin SDK (runtime)
- `zod` — schema validation (transitive)

Dependabot is configured to keep dependencies up to date. All updates are reviewed before merging.