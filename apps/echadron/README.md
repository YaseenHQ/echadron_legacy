# Echadron CLI

> A multi-provider agent harness for your terminal

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Docs](https://img.shields.io/badge/docs-online-blue)](https://github.com/YaseenHQ/echadron/tree/main/docs/en)

## What is Echadron CLI

Echadron CLI is an AI coding agent that runs in your terminal. It can read and edit code, run shell commands, search files, fetch web pages, and choose the next step based on the feedback it receives. It supports compatible providers and models.

## Install

The Echadron native installer/release channel is not published yet. Until it is,
install the fork package or run it from this repository.

After installing the package, run it with a new Terminal session:

```sh
echadron --version
chad --version
maker --version
```

### Alternative: npm

If you prefer npm, use Node.js 22.19.0 or later:

```sh
npm install -g echadron
```

Or with pnpm:

```sh
pnpm add -g echadron
```

The package is versioned independently from upstream Kimi Code. Its executable
entries are `echadron`, `chad`, and `maker`; only Echadron-owned executables are
installed.

## Quick Start

Open a project and start the interactive UI:

```sh
cd your-project
echadron
```

The `kimi` executable is intentionally not published by Echadron, so it can be
installed independently from an upstream Kimi Code installation.

On first launch, run `/login` inside Echadron and choose an available OAuth or API-key provider. After login, try a first task:

```
Take a look at this project and explain the main directories.
```

Refresh the provider/model directory independently of authentication:

```sh
echadron update --models
```

Echadron stores the validator-aware snapshot at
`~/.echadron/cache/models.dev.json` and reuses it for up to four hours during
normal browsing. The regular release updater remains disabled until Echadron
has its own release channel.

## Key Features

- **Isolated npm distribution.** Echadron uses its own commands and data directory, so it can be installed beside upstream Kimi Code. A native distribution is planned separately.
- **Blazing-fast startup.** The TUI is ready in milliseconds, so opening a session never feels heavy.
- **Polished TUI.** A carefully tuned interface designed for long, focused agent sessions.
- **Video input.** Drop a screen recording or demo clip into the chat — let the agent watch instead of typing out what's hard to describe in words.
- **AI-native MCP configuration.** Add, edit, and authenticate Model Context Protocol servers conversationally via `/mcp-config` — no hand-editing JSON.
- **Subagents for focused, parallel work.** Dispatch built-in `coder`, `explore`, and `plan` subagents in isolated context windows; the main conversation stays clean.
- **Lifecycle hooks.** Run local commands at key points — gate risky tool calls, audit decisions, fire desktop notifications, wire into your own automation.

## Documentation

- Full docs: https://github.com/YaseenHQ/echadron/tree/main/docs
- Getting Started: https://github.com/YaseenHQ/echadron/tree/main/docs/en/guides

## Repository & Issues

- Source: https://github.com/YaseenHQ/echadron
- Issues: https://github.com/YaseenHQ/echadron/issues
- Security: see SECURITY.md in the main repository

## License

MIT
