<p align="center">
  <img src="assets/icon.svg" width="72" height="72" alt="Qwen plugin icon">
</p>

<h1 align="center">Qwen CLI for BB</h1>

<p align="center">
  Use your Qwen Code CLI account to code in BB — same models, same tools, no extra configuration.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> &middot;
  <a href="#settings">Settings</a> &middot;
  <a href="#usage">Usage</a> &middot;
  <a href="#modes--permissions">Modes &amp; permissions</a> &middot;
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/BB-%E2%89%A5%200.48-blue" alt="BB version">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022-green" alt="Node version">
  <img src="https://img.shields.io/badge/license-MIT-brightgreen" alt="License">
  <img src="https://img.shields.io/badge/Qwen%20Code-v0.27-purple" alt="Qwen Code version">
</p>

---

A community provider that connects [BB](https://getbb.app) to the [Qwen Code CLI](https://qwenlm.github.io/qwen-code-docs/). Keep your existing CLI sign-in, choose your models, and work with streamed responses and tool approvals inside BB.

**Status:** available in the BB Community marketplace. Tested on Windows.

## What you get

- **One provider in BB** — select Qwen CLI when creating a thread
- **Live model discovery** — models and reasoning options come from your CLI and account
- **Plan and Build** — plan a task, then switch to implementation
- **Permission controls** — Accept edits or Full access
- **Usage tracking** — real token usage per model from Qwen's local logs
- **Auto-approve** — automatically approve permission requests in Accept edits mode
- **BB-native delegation** — optionally disable Qwen subagents so agents use `bb thread spawn`
- **Rich tool cards** — command summaries, file reads, web fetches, and search results with clean output
- **Native skills** — workspace `.qwen/skills` and personal `~/.qwen/skills` discovered in BB
- **Togglable settings** — enable/disable the provider, toggle features without editing files

## Quick start

### 1. Install Qwen Code CLI

```sh
npm install -g @qwen-code/qwen-code@latest
```

### 2. Sign in

Run Qwen interactively once and use `/auth`:

```sh
qwen
# Type /auth and follow the prompts
```

For CI or headless use, set environment variables:

```sh
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
```

### 3. Install the plugin

```sh
bb plugin install qwen-cli
```

Or from the repo directly:

```sh
bb plugin install github:ols-md/bb-plugin-qwen-cli
```

### 4. Start a thread

Select **Qwen CLI** in BB's provider picker, choose a model, and send a prompt.

```sh
bb thread spawn --provider qwen-cli --model qwen3.8-max --prompt "Add rate limiting to the API"
```

## How it works

```
Your BB thread → Plugin → BB's shared ACP bridge → qwen --acp → Qwen Code service
```

The plugin launches `qwen --acp` on your machine. BB's shared [Agent Client Protocol](https://agentclientprotocol.com) bridge handles streaming, tool updates, approvals, and session communication. Authentication stays with the CLI — you never enter an API key into the plugin.

## Modes & permissions

Workflow orchestration uses **BB Workflows**. The plugin disables Qwen's native
workflow tools and hides its Workflow mode control, including for resumed threads.
Qwen workflow settings or environment opt-ins do not override this policy.

| Control | Choice | Behavior |
|---|---|---|
| Work mode | Plan | Research and outline a task. No files modified, no commands run. |
| Work mode | Build | Implement the task under the selected permission policy. |
| Permissions | Accept edits | Edits files automatically. Shell commands, web fetches, and external paths prompt for approval. |
| Permissions | Full access | All operations allowed without prompting. |

## Settings

Open **Settings → Installed plugins → Qwen CLI** or use the CLI:

```sh
bb plugin config qwen-cli set <key> <value>
```

| Setting | Default | What it does |
|---|---|---|
| `enabled` | `true` | Show Qwen CLI in the provider picker |
| `autoApprove` | `false` | Auto-approve permission requests in Accept edits mode |
| `sandbox` | `false` | Run commands in Qwen's sandbox (`--sandbox`) |
| `subagentsDisabled` | `false` | Block native subagent tools; agents delegate via `bb thread spawn` |
| `commandDescriptionsEnabled` | `true` | Show tool summaries instead of raw commands |

## Usage

Spawn threads with any Qwen model:

```sh
# Standard
bb thread spawn --provider qwen-cli --model qwen3.8-max --prompt "Refactor auth"

# Plan mode
bb thread spawn --provider qwen-cli --prompt-mode plan --prompt "Design caching layer"

# With reasoning
bb thread spawn --provider qwen-cli --model deepseek-v4-pro-0813 --reasoning-level high --prompt "..."
```

Token usage per model is shown in BB's usage panel and `bb settings usage --refresh`.

## Architecture

```
bb-plugin-qwen-cli/
├── server.ts              Plugin registration, settings, provider declaration
├── host.ts                ACP bridge — launches qwen --acp, auto-approve filter
├── dialect.ts             Tool detection, classification, and presentation
├── prompt-mode.ts         Maps BB plan mode to Qwen ACP session options
├── usage.ts               Token usage tracking from Qwen's local logs
├── skills/qwen-cli/       Agent-facing skill documentation
└── assets/                Qwen icon (currentColor SVG)
```

## Troubleshooting

| Problem | What to check |
|---|---|
| Qwen CLI missing from picker | Enable the plugin in Settings → Plugins → Qwen CLI |
| `qwen` not found | `npm install -g @qwen-code/qwen-code@latest` |
| Auth required | Run `qwen` and use `/auth` to sign in |
| Models not loading | Run `qwen` → `/doctor` to check auth status |
| Commands run without asking | Check permission mode; Full access auto-approves |

## License

[MIT](LICENSE). This project is independent of Alibaba, Qwen, and BB.

## Token Plan catalog refresh

Before model discovery and new/resumed threads, the host queries the configured
QwenCloud Token Plan `/models` endpoint. New chat model IDs appear on the next
refresh after a five minute cache expires; image, audio, video and `auto` entries
are excluded. Existing model metadata and custom endpoint routes are retained.
Unknown models use the CLI's defaults rather than guessed reasoning tiers.

Only the dedicated global and China HTTPS Token Plan endpoints receive credentials.
Credentials resolve from Qwen user/system settings `env` and the child environment;
they are never logged or written into the generated settings file. Fetches have a
five second deadline, a 512 KB response limit, and no redirects. Failures retain
configured models and the last successful in-memory catalog (retry after a minute).

The host injects a temporary system settings overlay into ACP children, retaining
system policy and the original system-defaults path. It leaves home/auth paths
unchanged and removes temporary files when the child or host exits. Workspace configurations
with `modelProviders`, system `env`, malformed settings, or unrecognized secret-bearing
system fields conservatively keep the original CLI configuration without discovery.
Selection uses Qwen's session config API; the legacy model selection fallback is
also marked session-only. Selecting models does not save user/workspace defaults.

Run `npm test`, `npm run check`, and `npm run build` to validate the implementation.
