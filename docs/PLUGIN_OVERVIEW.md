## Qwen CLI

Use your installed Qwen Code CLI as an ACP agent in BB.

### How it works

The plugin launches `qwen --acp` through BB's shared ACP bridge. Your existing Qwen sign-in, models, and tools are available without extra configuration. The ACP dialect maps Qwen's tools (run_command, read_file, write_file, edit, grep_search, web_fetch, and more) to BB's rich timeline presentation with icons, labels, and progress.

### Features

- Native Qwen Code models and reasoning levels
- Plan mode via composer or `--prompt-mode plan`
- Auto-approve permission requests in Accept edits mode
- Sandbox support (`--sandbox`)
- BB-native delegation (disable Qwen subagents, use `bb thread spawn`)
- Command descriptions (human-readable tool summaries)

### Requirements

- Qwen Code CLI installed: `npm install -g @qwen-code/qwen-code@latest`
- Signed in via `qwen` → `/auth`, or `OPENAI_API_KEY` + `OPENAI_BASE_URL` for CI

### Install

```sh
bb plugin install github:ols-md/bb-plugin-qwen-cli
```