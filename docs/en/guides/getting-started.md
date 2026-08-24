# Getting started

## What is Echadron

Echadron is a multi-provider AI agent that runs in the terminal, helping you carry out software development tasks and day-to-day terminal operations — reading and modifying code, running shell commands, searching files, fetching web pages, and autonomously planning and adjusting its next steps based on feedback as it works.

It fits scenarios such as:

- **Writing and modifying code**: implementing new features, fixing bugs, completing refactors
- **Understanding a project**: exploring an unfamiliar codebase and answering questions about architecture and implementation
- **Automating tasks**: batch-processing files, running builds and tests, chaining multiple scripts together

The CLI is written in TypeScript, distributed via npm, and runs on Node.js.

## Installation

Install Echadron as a global npm package, or build it from the repository when
you need the latest source checkout. The standalone native release channel is
not enabled yet.

::: tip Before you install
Echadron is a fully interactive TUI application. For the best visual experience, run it in a terminal with true-color and ligature support, such as [Kitty](https://sw.kovidgoyal.net/kitty/) or [Ghostty](https://ghostty.org/).
:::

### Install from source

Echadron's independent release installer is not enabled yet. To run the fork
from source, install Node.js 24.15.0 or later and pnpm 10.33.0, then build the CLI:

```sh
git clone https://github.com/YaseenHQ/echadron.git echadron
cd echadron
pnpm install
pnpm --filter echadron build
npm install -g ./apps/echadron
```

On Windows, install [Git for Windows](https://gitforwindows.org/) before
launching the CLI. The inherited shell path behavior remains available through
the compatibility `KIMI_SHELL_PATH` variable.

### npm installation

Requires Node.js 22.19.0 or later:

```sh
node --version
npm install -g echadron
```

Or with pnpm:

```sh
pnpm add -g echadron
```

## Upgrade and uninstall

After installation, verify that the executable is ready:

```sh
echadron --version
```

**Upgrade**: the standalone Echadron release channel is not enabled yet, so
`echadron upgrade` does not install an upstream Kimi release. Update the npm
package directly:

```sh
npm install -g echadron@latest
```

**Uninstall**: if you installed from source, remove the checkout. If you installed via npm:

```sh
npm uninstall -g echadron
```

## First launch

Move into your project directory and run `echadron` to start the interactive UI:

```sh
cd your-project
echadron
```

To run a single instruction without entering the interactive UI, use `-p`:

```sh
echadron -p "Take a look at this project's directory structure"
```

To resume the previous session, add `-c`:

```sh
echadron -c
```

On first launch you need to configure an API source. In the interactive UI, enter `/login` to begin the login flow:

```
/login
```

`/login` first asks how you want to connect:

- **Sign in with an account (OAuth)** — choose Kimi Code, ChatGPT (OpenAI Codex), or xAI
- **Connect with an API key** — choose Kimi Platform, a provider from the models.dev catalog, or a custom `api.json` registry

To sign out, enter `/logout`; it lists the credentials that are actually present and lets you clear one provider or a displayed bundle without deleting its provider/model configuration.

::: tip Using other AI providers
To connect Anthropic, OpenAI API, Google, or another provider, use the API-key route in `/login` or edit `$ECHADRON_HOME/config.toml` directly. Interactive subscription OAuth currently covers Kimi, xAI, and OpenAI Codex (ChatGPT). See [Providers and models](../configuration/providers.md) for details.
:::

## Your first conversation

Once logged in, describe a task in natural language. A good starting point is to let Echadron familiarize itself with the project:

```
Take a look at this project's directory structure and briefly describe what each directory is for.
```

Echadron automatically calls file-reading, search, and other tools to browse the relevant content before responding. Read-only operations are executed automatically by default without requiring confirmation. For operations that modify files or run shell commands, it asks for your confirmation before proceeding.

You can also describe a more concrete task directly:

```
Add a function in src/utils that converts any string to kebab-case, and add a unit test for it.
```

Echadron plans the steps, modifies the code, runs the tests, and tells you what it did at each step.

::: tip Not sure what to do? Type `/help`
Type `/help` at any time to open the built-in command and keyboard shortcut panel. Use `↑`/`↓` to browse and `Esc` to close. To exit, type `/exit`, press `Ctrl-C` twice, or press `Ctrl-D` with the input box empty.
:::

## Common commands and keyboard shortcuts

For a first-time user, the following is all you need to know:

**Session commands**

| Command | Description |
| --- | --- |
| `/new` | Start a new session, clearing the current context |
| `/sessions` | Browse session history and choose one to resume |
| `/model` | Switch the current model |
| `/compact` | Manually compress the context to free up tokens |
| `/fork` | Fork the current session, keeping history but continuing independently |

**Most-used keyboard shortcuts**

| Shortcut | Description |
| --- | --- |
| `Esc` | Interrupt streaming output / close a popup |
| `Ctrl-C` | Interrupt output; press twice while idle to exit |
| `Shift-Tab` | Toggle Plan mode |
| `Ctrl-S` | Inject a message mid-stream without waiting for the current response to finish |
| `Ctrl-O` | Collapse / expand tool output and compaction summaries |

For the full list, type `/help` or visit [Slash commands reference](../reference/slash-commands.md) and [Keyboard shortcuts](../reference/keyboard.md).

## Where data is stored

Echadron stores its local data under `~/.echadron/` by default — config files, session records, logs, and the model catalog cache. To move it elsewhere, point to a new path via `ECHADRON_HOME`. For the full directory layout, see [Data locations](../configuration/data-locations.md) and [Environment variables](../configuration/env-vars.md).

## Next steps

- [Interaction and input](./interaction.md) — input box operations, approval flow, Plan mode, and YOLO mode explained
- [Sessions and context](./sessions.md) — resuming sessions, compressing context, exporting sessions
- [Common use cases](./use-cases.md) — prompt examples for typical tasks
