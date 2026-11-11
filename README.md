# Qwen CLI for BB

Use your installed [Qwen Code CLI](https://qwenlm.github.io/qwen-code-docs/) as an ACP agent in BB — no extra sign-in, no separate configuration.

## Features

- **Native Qwen Code** — runs `qwen --acp` through BB's ACP bridge, same models and tools as the CLI
- **Plan mode** — research and plan before implementing (`--prompt-mode plan` or composer action)
- **Auto-approve** — automatically approve permission requests in Accept edits mode
- **Sandbox support** — run commands in Qwen's sandbox (`--sandbox`)
- **BB-native delegation** — disable Qwen subagents and use `bb thread spawn` instead
- **Command descriptions** — human-readable tool summaries instead of raw commands
- **Native skills** — Qwen skills from `~/.qwen/skills` and project `.qwen/skills`

## Requirements

- **[Qwen Code CLI](https://qwenlm.github.io/qwen-code-docs/en/docs/getting-started/)** installed and on PATH
- **Node.js** ≥ 22
- **BB** ≥ 0.48

## Install

### 1. Install Qwen Code CLI

```sh
npm install -g @qwen-code/qwen-code@latest
```

### 2. Sign in

Run Qwen interactively once and use `/auth` to configure your credentials:

```sh
qwen
# Then type /auth and follow the prompts
```

For CI/headless use, set environment variables instead:

```sh
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
```

### 3. Install the plugin

```sh
bb plugin install github:ols-md/bb-plugin-qwen-cli
```

Or for local development:

```sh
git clone https://github.com/ols-md/bb-plugin-qwen-cli.git
cd bb-plugin-qwen-cli
npm install
bb plugin install .
```

### 4. Verify

```sh
bb provider models qwen-cli --json
```

## Use

```sh
# Spawn a thread with a specific model
bb thread spawn --provider qwen-cli --model qwencloud-token-plan/qwen4-max-preview --prompt "Refactor the auth module"

# Plan mode (research only, no edits)
bb thread spawn --provider qwen-cli --prompt-mode plan --prompt "Design a caching layer"

# With reasoning level
bb thread spawn --provider qwen-cli --model qwencloud-token-plan/qwen4-max-preview --reasoning-level high --prompt "..."
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Show Qwen CLI in the provider picker |
| `autoApprove` | `false` | Auto-approve permission requests in Accept edits mode |
| `sandbox` | `false` | Run commands in Qwen's sandbox |
| `subagentsDisabled` | `false` | Block native subagent tools; use BB threads for delegation |
| `commandDescriptionsEnabled` | `true` | Show tool summaries instead of raw commands |

Configure from the BB UI (`Settings → Plugins → Qwen CLI`) or CLI:

```sh
bb plugin config qwen-cli set autoApprove true
bb plugin config qwen-cli set subagentsDisabled true
```

## Permissions

- **Accept edits** — edits files automatically; asks before shell commands, web fetches, and paths outside the workspace
- **Full access** — allows all operations without prompting

## Architecture

```
bb-plugin-qwen-cli/
├── server.ts            Plugin registration, settings, provider declaration
├── host.ts              ACP bridge (launches qwen --acp, handles approvals)
├── dialect.ts           Qwen tool detection, classification, and presentation
├── prompt-mode.ts       Maps BB plan mode to Qwen ACP session options
├── skills/qwen-cli/     Agent-facing skill doc for thread context
└── assets/              SVG icons (Qwen logo)
```

## Troubleshooting

**"Authentication required"**: Run `qwen` interactively and use `/auth` to sign in.

**"missing_executable"**: Install Qwen Code CLI: `npm install -g @qwen-code/qwen-code@latest`

**Models not loading**: Check your auth status with `qwen` → `/doctor`

## License

MIT — see [LICENSE](LICENSE)