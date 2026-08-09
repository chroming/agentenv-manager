# AgentEnv Manager

[English](README.en.md) | 简体中文

[![Latest release](https://img.shields.io/github/v/release/chroming/agentenv-manager)](https://github.com/chroming/agentenv-manager/releases/latest)
[![CI](https://github.com/chroming/agentenv-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/chroming/agentenv-manager/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/chroming/agentenv-manager)](LICENSE)

AgentEnv Manager 是一个本地桌面应用，用来整理多个 coding agent 的 Skills、Instructions、MCP 启停状态和历史对话。你可以把一套工作方式保存为 Profile，在写入 Agent 前预览变化、运行隔离对比，并在需要时从恢复点还原。

应用不会接管模型、账号、凭据或整份原生配置。每个 Agent 只开放经过明确适配的资源。

![Agents overview](docs/images/agents.png)

## 安装

macOS 推荐使用官方 Homebrew Cask：

```bash
brew install --cask chroming/tap/agentenv-manager
```

Homebrew 会按架构下载官方 Release、验证 SHA-256，并移除 quarantine。以后可以在应用内直接安装更新。

更新已安装版本：

```bash
brew upgrade --cask chroming/tap/agentenv-manager
```

macOS、Windows 和 Linux 安装包也可以从 [GitHub Releases](https://github.com/chroming/agentenv-manager/releases/latest) 下载。macOS 直接下载包使用 ad-hoc 签名，没有 Developer ID 和公证；请先把应用复制到“应用程序”并推出 DMG，再按 [Apple 的说明](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)选择“仍要打开”。直接下载的版本可以检查更新，但需要手动安装新版本。

## 第一次使用

1. 启动应用，确认自动检测到的 Agent。没有安装的 Agent 默认保持关闭。
2. 在 Agents 中配置一个 Agent，把当前设置保存为 Profile，或从空 Profile 开始。
3. 如果机器上已经有较多 Skills，先打开 `Skills > Local Skills`，检查重复副本、冲突、共享目录和失效链接。
4. 在 Profile 中选择要管理的 Instructions、Skills 和 MCP 状态，保存后查看 Apply 预览。
5. 确认变化后再 Apply。AgentEnv 会先创建恢复点，写入失败时尝试自动回滚并保留恢复记录。

## Profiles

Profile 保存可复用的 Agent 工作方式，包括 Instructions、Library Skills，以及受支持 Agent 中已有 MCP 的启停选择。每类资源都可以选择使用已保存内容、关闭或保留 Agent 当前状态。

![Profiles](docs/images/profiles.png)

Apply 前会重新读取目标环境，列出新增、替换、删除、保留和需要确认的资源。AgentEnv 只在确认后写入，并验证最终状态。

### Apply 前对比

Compare 会让当前 Agent 设置和候选 Profile 对同一个任务各运行一次。两次运行使用隔离的临时 Home 和 Workspace，结果并排展示回复、文件变化、耗时和 CLI 明确上报的 token。

![Profile comparison](docs/images/profile-compare.png)

Compare 会消耗对应 Agent 的账号额度，但不会 Apply，也不会修改真实 Agent 或原项目。当前隔离对比需要 macOS；OpenCode、Claude Code、Codex、Antigravity CLI 和 Pi 提供已验证的实现，Trae CLI 暂不支持可靠的一次性运行。

## Workspaces

Workspaces 保存常用本地目录的引用，并按所选 Agent 展示该目录会加载的 Instructions、Skills 和 MCP 名称。你可以编辑明确支持的 Workspace Instructions、把 Library Skill 复制为目录中的普通文件，也可以用已安装的 Agent 在该目录启动工作。

![Workspace resources](docs/images/workspaces.png)

目录中的文件始终是唯一事实源，不会绑定或 Apply Profile。AgentEnv 不会在 Workspace 中创建 Library 链接，也不会替你 stage 或 commit Git 变化。写入前会校验文件版本并创建独立恢复点；移除 Workspace 只删除应用内引用，不会删除目录。

## Skill Library

Library 为每个 Skill 保存一份可复用内容。可以从本地目录、ZIP、GitHub 路径或普通 Git 仓库导入，再通过 Profile 安装到各 Agent 的专属目录。

![Skills grouped by source](docs/images/skills-by-source.png)

按来源视图会显示同一仓库或目录中的新增、更新和删除。你可以按来源检查更新、合并来源、忽略暂不导入的条目，也可以关闭某个来源的自动检查。

`Local Skills` 用来处理现有目录中的重复副本、内容冲突、失效链接和共享集合。所有清理动作都会先预览，并为修改过的文件保留恢复记录。

## Conversations

Conversations 只读索引本机 Agent 的历史记录。可以搜索标题和消息、按目录筛选、回到原对话，或检查上下文后交给另一个 Agent 继续。对话目录已添加为 Workspace 时，还可以直接跳到对应 Workspace。

![Conversation history](docs/images/conversations.png)

原始会话仍归对应 Agent 所有。AgentEnv 不会修改会话数据库，也不会把对话加入 Profile、Backup 或 Workspace Sync。

## 支持的 Agents

- OpenCode
- Claude Code
- Codex
- Antigravity CLI
- Trae CLI
- Pi Coding Agent

不同 Agent 支持的 Instructions、MCP、Conversations 和 Compare 能力并不完全相同。应用会按实际能力显示可用操作，不会用另一个 Agent 代替执行。

## 其他功能

- Workspace Sync 通过专用私有 Git 仓库同步可移植的 Profiles 和 Skill Library。拉取和发布都需要手动审核，不会自动 Apply 到本机 Agent。
- Recovery 集中展示 Apply、Skill 清理和同步产生的恢复记录，可以预览文件后再恢复。
- GitHub 登录为仓库导入和更新检查提供更高的 API 限额；普通 Git 和 SSH 仓库继续使用系统 Git 凭据。
- 界面支持 English、简体中文和繁體中文。

## 安全和隐私

- Profile 写入遵循 Preview、Backup、Apply、Verify 流程；没有语义变化时不会写文件。
- AgentEnv 只修改对应 Target integration 明确声明可管理的文件或字段。
- MCP 定义和凭据继续由 Agent 保存，Profile 只管理受支持的启停状态。
- Repository 扫描使用独立缓存，不会修改已有 checkout。
- Workspace Sync 不同步凭据、Target 状态、Backup 或本机绝对路径。
- 官方构建默认每天最多发送一次匿名安装信息，包括随机安装 ID、应用版本、操作系统类型及主版本、架构、界面语言和安装渠道。Settings 中可以关闭，并可预览完整字段。

完整行为见 [产品契约](docs/product-contracts.md)，数据与网络访问说明见 [PRIVACY.md](PRIVACY.md)。

## 从源码运行

需要 Node.js 22.12 或更高版本、npm 10 或更高版本，以及 Git。

```bash
npm ci
npm run dev
```

开发真实文件操作时，建议隔离应用数据和 Agent Home：

```bash
export AGENTENV_DATA_ROOT="$PWD/.agentenv-runtime/data"
export AGENTENV_HOME="$PWD/.agentenv-runtime/home"
npm run dev
```

常用验证命令：

```bash
npm run test:quick       # 按当前改动运行相关测试
npm run verify:commit    # 提交前完整验证
npm run verify:release   # 打包应用与发布门禁
```

生成安装包：

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

架构、Target integration、测试策略和发布流程见 [开发文档](docs/development.md)。

## 参与项目

提交改动前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

AgentEnv Manager 使用 [GNU General Public License v3.0](LICENSE)。产品名称和标志归各自权利人所有，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目是独立项目，与上述 Agent 的开发者没有隶属或背书关系。
