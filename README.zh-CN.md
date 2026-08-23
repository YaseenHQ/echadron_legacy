# Echadron

Echadron 是一个支持多模型的 Agent Harness，基于 Kimi Code CLI 架构构建。
推荐使用 `echadron`、`chad` 或 `maker` 命令；只安装 Echadron 自己的命令。
它可以与上游 Kimi Code 并存，但不会安装或覆盖 `kimi` 命令。

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Docs](https://img.shields.io/badge/docs-online-blue)](https://github.com/YaseenHQ/echadron/tree/main/docs/zh)

[Documentation](https://github.com/YaseenHQ/echadron/tree/main/docs/zh) · [Issues](https://github.com/YaseenHQ/echadron/issues) · [English](README.md)


![Echadron 的使用演示](./docs/media/intro.gif)


## 什么是 Echadron

Echadron 是一个运行在终端里的多模型 AI 编程 agent，可以帮你读写代码、执行 shell 命令、检索文件、抓取网页，并根据反馈自主决定下一步动作。它支持兼容的 Provider 和模型，并保留 Kimi Code 的兼容架构。

## 安装

使用 Node.js 22.19.0 或更高版本从 npm 安装 Echadron：

```sh
npm install -g echadron
```

也可以使用 pnpm：

```sh
pnpm add -g echadron
```

如需从源码构建，请使用 Node.js 24.15.0 或更高版本和 pnpm 10.33.0：

```sh
git clone https://github.com/YaseenHQ/echadron.git echadron
cd echadron
pnpm install
pnpm --filter echadron build
npm install -g ./apps/echadron
```

> Windows 用户首次启动前还需要安装 [Git for Windows](https://gitforwindows.org/)。如果 Git Bash 安装在非标准路径，请把 `ECHADRON_SHELL_PATH` 设为 `bash.exe` 的绝对路径。

随后在新的终端会话中运行：

```sh
echadron --version
```

详细安装方式，见[快速上手](https://github.com/YaseenHQ/echadron/tree/main/docs/zh/guides/getting-started)。

## 快速开始

进入项目目录并启动交互界面：

```sh
cd your-project
echadron
```

首次启动时，在 Echadron 里输入 `/login`，选择可用的 OAuth 或 API 密钥 Provider 登录。登录完成后，可以先让它熟悉项目：

```
帮我看一下这个项目的目录结构，简单介绍一下每个目录是做什么的
```

## 核心特性

- **独立 npm 发行** Echadron 使用自己的命令和数据目录，可与 Kimi Code 并存。原生独立发行将另行提供。
- **极速启动** TUI 在毫秒级就绪，开一个新会话没有任何心智负担。
- **精致的 TUI 体验** 端到端打磨的交互界面，专为长时间、专注的 Agent 会话优化。
- **视频也能输入** 把屏幕录像、演示视频拖进对话，让 Agent 看那些难以用文字描述的东西——把参考片段做成 LUT、把长视频剪成短视频、把录屏变成代码，等等。
- **AI-native 的 MCP 配置** 通过 `/mcp-config` 对话式添加、编辑、认证 MCP 服务器，无需手写 JSON。
- **丰富的插件生态** 从插件市场或任意 GitHub 仓库安装 skills、MCP 服务器和数据源，每次安装都会标明来源的信任级别。
- **子 Agent 聚焦并行工作** 内置 `coder`、`explore`、`plan` 子 Agent 在隔离上下文中处理子任务，主对话保持清爽。
- **生命周期 hooks** 在关键节点执行本地命令：拦截高风险工具调用、审计决策、发送桌面通知，或对接你自己的自动化脚本。
- **编辑器 / IDE 集成（ACP）** 用 `echadron acp` 让 Zed、JetBrains 等任意 [Agent Client Protocol](https://agentclientprotocol.com/) 客户端直接驱动会话。


## 在编辑器里使用（ACP）

Echadron 支持 [Agent Client Protocol](https://agentclientprotocol.com/)，ACP 兼容的编辑器 / IDE（Zed、JetBrains……）可以通过 stdio 直接驱动会话。使用 `/login` 登录一次后，把编辑器指向 `echadron acp` 子命令即可，无需重复登录；支持 terminal-auth 的 ACP 客户端也可以直接启动 Echadron OAuth 登录。

以 Zed 为例，在 `~/.config/zed/settings.json` 中加入：

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

随后在 Zed 的 Agent 面板新建对话即可。JetBrains 配置与排障见[在 IDE 中使用](https://github.com/YaseenHQ/echadron/tree/main/docs/zh/guides/ides)，完整能力矩阵见 [`echadron acp` 参考](https://github.com/YaseenHQ/echadron/tree/main/docs/zh/reference/kimi-acp)。

## 文档

- [快速上手](https://github.com/YaseenHQ/echadron/tree/main/docs/zh/guides/getting-started)
- [交互与审批](https://github.com/YaseenHQ/echadron/tree/main/docs/zh/guides/interaction)
- [会话](https://github.com/YaseenHQ/echadron/tree/main/docs/zh/guides/sessions)
- [在 IDE 中使用（ACP）](https://github.com/YaseenHQ/echadron/tree/main/docs/zh/guides/ides)
- [配置](https://github.com/YaseenHQ/echadron/tree/main/docs/zh/configuration/config-files)
- [命令参考](https://github.com/YaseenHQ/echadron/tree/main/docs/zh/reference/kimi-command)

## 本地开发

环境要求：Node.js ≥ 24.15.0，pnpm 10.33.0。

```sh
git clone https://github.com/YaseenHQ/echadron.git
cd echadron
pnpm install
```

```sh
pnpm dev:cli    # 以开发模式运行 CLI
pnpm test       # 运行测试
pnpm typecheck  # TypeScript 检查
pnpm lint       # 运行 oxlint
pnpm build      # 构建所有包
```

完整贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 社区

- [Issues](https://github.com/YaseenHQ/echadron/issues)
- 安全漏洞反馈，请见 [SECURITY.md](SECURITY.md)。

## 致谢

我们的 TUI 构建在 [`pi-tui`](https://github.com/earendil-works/pi-mono/tree/main/packages/tui) 之上。我们衷心感谢 `pi-tui` 作者的工作。

## 许可证

基于 [MIT](LICENSE) 协议发布。
