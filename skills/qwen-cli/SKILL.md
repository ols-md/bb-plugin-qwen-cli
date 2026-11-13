---
name: qwen-cli
description: "Spawn, configure, or troubleshoot Qwen Code CLI (qwen) threads in BB — models, reasoning levels, permissions, and sign-in."
---

# Qwen Code CLI provider

Threads on the `qwen-cli` provider run the locally installed Qwen Code CLI (`qwen --acp`) through BB's shared ACP bridge.

## Requirements

- `qwen` must be installed and on `PATH` on the target host:
  ```sh
  npm install -g @qwen-code/qwen-code@latest
  ```
- Sign in on the target host: run `qwen` interactively, then use `/auth`.
  For CI/headless: set `OPENAI_API_KEY` + `OPENAI_BASE_URL`.
- Plugin settings (`Settings → Installed plugins → Qwen CLI`):
  - `enabled` (default `true`): show or hide in the provider picker.
  - `autoApprove` (default `false`): auto-approve permission requests in Accept edits mode.
  - `sandbox` (default `false`): pass `--sandbox` for new threads.
  - `subagentsDisabled` (default `false`): block native subagent tools; agents use `bb thread spawn --parent-self` instead.
  - `commandDescriptionsEnabled` (default `true`): show tool summaries on command cards.

## Models and reasoning levels

`qwen-cli` discovers models and reasoning levels from the signed-in CLI:

```sh
bb provider models qwen-cli --environment "$BB_ENVIRONMENT_ID" --json
```

Pass reasoning level with `--reasoning-level`:

```sh
bb thread spawn --project "$BB_PROJECT_ID" --provider qwen-cli --model <model-id> --reasoning-level medium --prompt "..."
```

## Plan mode

Use `--prompt-mode plan` or the Plan composer action to research and plan before implementing. Qwen maps this to ACP session mode `plan`.

## Permissions

- `accept-edits`: BB shows permission requests as approvals. Qwen edits files automatically in this mode.
- `full`: auto-approves all ACP permission requests.

## Limits

- Use BB Workflows for workflow orchestration. Qwen's native workflow tools and Workflow mode control are disabled by the plugin, including on resume.
- Session fork/rewind (`fork: "none"`), manual compaction, service tiers, and native thread archive/rename are not supported.
- Native skills are indexed from `~/.qwen/skills` (user) and `.qwen/skills` (project).
