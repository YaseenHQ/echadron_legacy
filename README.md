This repo will be archived as Echadron's old version, while Kimi Code as base helped me learn a lot experimenting with a harness and learn a lot about it , I felt its time to do it from scratch (I kept experimenting with different bases over time and thought its time to stop and build something from scratch) and put things ive learned over the years into a better base. Echadron will return to GitHub at a later time with improved from scratch baseline. This repo could still be useful in learning to integrating some stuff , so i decided to archive it and it'll still be accesible. I've also acquired Echadron.com and you'll find a new version linked here once its ready. You'll still be able to use current version of echadron and can build it yourself from this repo. Also look into harnesses like Pi, OpenCode, Deepseek harness - it'll teach you a lot, fork and experiment stuff, eventually you'll reach a point where you'll have better ideas to build stuff from scratch.


# Echadron

Echadron is the multi-provider agent harness built from the Kimi Code CLI
architecture. The `echadron` command (or short `chad` / `maker` alias) is the primary CLI
entry point published by this fork. Only Echadron-owned executables are
installed; upstream Kimi Code and its storage namespace remain independent.

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) <br>
[Documentation](https://github.com/YaseenHQ/echadron/tree/main/docs) · [Issues](https://github.com/YaseenHQ/echadron/issues) · [中文](README.zh-CN.md)

![Demo of using Echadron](./docs/media/intro.gif)

## What is Echadron

Echadron is an AI coding agent that runs in your terminal — it can read and edit code, run shell commands, search files, fetch web pages, and choose the next step based on the feedback it receives. It supports compatible providers and models through the Kimi Code architecture.

The name means roughly *maker*, which is where the `maker` alias comes from. The character in the terminal header is Chad — the middle of "Echadron", and the other alias you can launch him with.

## Install

Install Echadron from npm with Node.js 22.19.0 or later:

```sh
npm install -g echadron
```

Or with pnpm:

```sh
pnpm add -g echadron
```

After installing, open a new shell session and verify the available commands:

```sh
echadron --version
chad --version
maker --version
```

The npm package name is `echadron`; its CLI entries are `echadron`,
`chad`, and `maker`.

To install the current source checkout globally:

```sh
git clone https://github.com/YaseenHQ/echadron.git echadron
cd echadron
pnpm install
pnpm --filter echadron build
npm install -g ./apps/echadron
```

## Quick Start

Open a project and start the interactive UI:

```sh
cd your-project
echadron
```

Echadron never installs a `kimi` executable, so it can coexist with upstream
Kimi Code on the same machine.

On first launch, run `/login` inside Echadron and choose an available OAuth or API-key provider. After login, try your first task:

```
Take a look at this project and explain its main directories.
```

Refresh the shared [models.dev](https://models.dev) provider/model directory
without changing credentials or `config.toml`:

```sh
echadron update --models
```

The snapshot is stored under `~/.echadron/cache/models.dev.json` and reused for
normal provider browsing for up to four hours. Existing installations may still
be read from legacy `.kimi-code` data roots. `echadron update` without
`--models` is intentionally disabled until Echadron has its own signed release
channel; it never contacts or installs the upstream Kimi Code release.

## Key Features

- **Isolated npm distribution.** Echadron installs beside Kimi Code with its own commands and data directory. A standalone native distribution is planned separately.
- **Blazing-fast startup.** The TUI is ready in milliseconds, so starting a session never feels heavy.
- **Purpose-built TUI.** A carefully tuned interface, optimized end to end for long, focused agent sessions.
- **Video input.** Drop a screen recording or demo clip into the chat and let the agent watch what is hard to describe in words — turn a reference clip into a LUT, a long video into a short, a screen recording into working code, and more.
- **AI-native MCP configuration.** Add, edit, and authenticate Model Context Protocol servers conversationally with `/mcp-config`, without hand-editing JSON.
- **Rich plugin ecosystem.** Install skills, MCP servers, and data sources from the marketplace or any GitHub repo, with each install's trust level surfaced up front.
- **Subagents for focused, parallel work.** Dispatch built-in `coder`, `explore`, and `plan` subagents in isolated contexts while keeping the main conversation clean.
- **Lifecycle hooks.** Run local commands at key points to gate risky tool calls, audit decisions, trigger desktop notifications, or connect to your own automation.
- **Editor & IDE integration (ACP).** Drive an Echadron session straight from Zed, JetBrains, or any [Agent Client Protocol](https://agentclientprotocol.com/) client with `echadron acp`.

## Use it in your editor (ACP)

Echadron speaks the [Agent Client Protocol](https://agentclientprotocol.com/), so ACP-compatible editors and IDEs (Zed, JetBrains, …) can drive a session over stdio. Log in once with `/login`, then point your editor at `echadron acp` — no extra login is needed. ACP clients that support terminal authentication can also launch the Echadron OAuth flow when no credential is configured. `echadron acp` reads the client's `initialize` request and transparently selects the compatible ACP v1 or v2 implementation. `echadron acp-v2` remains as a compatibility spelling for clients already configured with it; `ECHADRON_LEGACY_FLAG=1` is a diagnostic override that forces the v1 adapter.

For Zed, add this to `~/.config/zed/settings.json`:

```json
{
  "agent_servers": {
    "Echadron": {
      "type": "custom",
      "command": "echadron",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

Then open a new conversation in Zed's Agent panel.

## Docs

- [Documentation](https://github.com/YaseenHQ/echadron/tree/main/docs)

## Develop

Requirements: Node.js ≥ 24.15.0, pnpm 10.33.0.

```sh
git clone https://github.com/YaseenHQ/echadron.git
cd echadron
pnpm install
```

```sh
pnpm dev:cli    # run the CLI in dev mode
pnpm test       # run tests
pnpm typecheck  # TypeScript check
pnpm lint       # oxlint
pnpm build      # build all packages
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution guide.

## Community

- [Issues](https://github.com/YaseenHQ/echadron/issues)
- For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## Acknowledgements

Our TUI is built on top of [`pi-tui`](https://github.com/earendil-works/pi-mono/tree/main/packages/tui). We thank the authors of `pi-tui` for their valuable work.

## License

Released under the [MIT License](LICENSE).
