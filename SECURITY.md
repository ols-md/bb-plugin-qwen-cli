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

## Credential handling

Qwen Code CLI manages sign-in and authentication. For Token Plan model discovery,
this plugin also reads credentials from Qwen settings and the process environment.
It sends the selected key as an HTTPS Bearer header only to the `/models` endpoint
under these exact base URLs (redirects are disabled):

- `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1`
- `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1`

The plugin forwards settings environment variables and provider keys to the local
Qwen CLI through the child environment. It also copies these values into the plugin
worker environment to support SDK launch paths. Inline provider keys are replaced
with environment-variable references in generated settings. Generated overlay files
do not contain these keys. Credentials are not intentionally logged; do not publish
raw settings, environment dumps, or diagnostic logs without reviewing them.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| <0.2.0  | No        |

## Public repository workflow

See [CONTRIBUTING.md](CONTRIBUTING.md) for local secret checks and the publication
checklist. CI scans Git history with Gitleaks. If a credential is published, revoke
or rotate it immediately before attempting history cleanup.

## Dependencies

Dependencies are kept minimal:

- `@get-bb/plugin-sdk` — BB Plugin SDK (runtime)
- `zod` — schema validation (transitive)

Dependabot is configured to keep dependencies up to date. All updates are reviewed before merging.