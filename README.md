# AgentEnv Manager

[English](README.en.md) | 简体中文

AgentEnv Manager 是一个本地桌面应用，用来整理 coding agent 的 Skills、Profile 和对话记录，并把同一套工作环境安全地应用到不同 Agent。

它不会接管模型、账号或所有原生配置。每次写入前都会先展示变化并创建恢复点。

> 当前版本为 `0.1.0` 预发布版。macOS、Windows 和 Linux 已进入打包应用验证。macOS 包暂未签名或公证，通过官方 Homebrew Cask 安装时会先核对 SHA-256，再移除 quarantine 属性。

## 安装

macOS 推荐使用官方 Cask：

```bash
brew install --cask chroming/tap/agentenv-manager
```

Homebrew 会按当前架构下载固定版本的官方 Release，并在安装前验证 SHA-256。应用内自动更新也只对这类 Homebrew 安装生效。直接下载的用户仍可检查更新，并从官方 Release 页面手动安装。

## Agents

应用会检测本机已经安装的 Agent，并显示哪些正在由 AgentEnv 管理、使用哪个 Profile，以及上次应用状态。

![Agents overview](docs/images/agents.png)

目前内置支持：

- OpenCode
- Claude Code
- Codex
- Antigravity CLI
- Trae CLI 2.0 和 Legacy 布局
- Pi Coding Agent

不同 Agent 的 MCP 和对话能力并不完全相同。界面会直接说明某项能力是否可用，不会换用另一个 Agent 代替执行。

## Profiles

Profile 是一套可复用的工作环境，可以包含 Instructions、Library Skills，以及已有 MCP 的启停选择。你可以从当前 Agent 捕获 Profile，也可以新建、复制和编辑后应用到兼容 Agent。

![Profiles workspace](docs/images/profiles.png)

Apply 之前，AgentEnv 会重新读取目标环境、展示文件变化和冲突，并说明哪些内容会保留。确认后才会备份并写入；失败时会尝试恢复。

### Compare before Apply

Compare 会用同一个任务分别运行当前 Agent 环境和候选 Profile。两次运行使用隔离的临时 Home 和 Workspace，结果会并排展示回复、文件变化、耗时和 CLI 明确上报的 token。

![Profile comparison](docs/images/profile-compare.png)

Compare 会调用对应 Agent 的模型并消耗账号额度，但不会 Apply，也不会修改真实 Agent 或原项目。无法完整隔离的资源会明确标记为未包含。

## Skill Library

Library 保存一份可复用的 Skill 内容。Skills 可以来自本地目录、ZIP、GitHub 或普通 Git 仓库，再由 Profile 安装到各 Agent 的目录。

按来源视图会把同一个仓库或目录下的 Skills 放在一起，显示新增、更新和删除，并允许按来源检查更新、合并来源或忽略不准备导入的条目。

![Skills grouped by source](docs/images/skills-by-source.png)

`Scan local` 用来处理已有目录中的重复副本、冲突、失效链接和共享目录。清理动作会先预览，并为发生变化的文件创建恢复记录。

## Conversations

Conversations 在一个只读索引中查找本机 Agent 的历史记录。你可以搜索标题和可见消息、打开原对话，或把经过检查的上下文交给另一个 Agent 继续。

![Conversation history](docs/images/conversations.png)

原始会话仍归对应 Agent 所有。AgentEnv 不会修改历史数据库，也不会把对话放进 Profile、Backup 或 Workspace Sync。

## 安全边界

- Profile 写入遵循 Preview、Backup、Apply、Verify 流程。
- AgentEnv 只修改对应 Target integration 明确声明可管理的文件或字段。
- MCP 定义和凭据继续由 Agent 保存；Profile 只管理受支持的启停状态。
- Repository 扫描使用独立缓存，不修改现有 checkout。
- Workspace Sync 只同步可移植的 Profile 和 Library 数据，不同步凭据、Target 状态或备份。
- 应用没有广告或承载用户数据的云服务。匿名可靠性统计默认关闭，开启前可以在 Settings 中查看完整字段。

完整语义见 [产品契约](docs/product-contracts.md)，隐私和本地数据说明见 [PRIVACY.md](PRIVACY.md)。

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

## 测试和打包

```bash
npm run build
npm test
npm run test:e2e
npm run verify:release
```

生成当前平台的未压缩应用：

```bash
npm run pack
```

生成安装包：

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

推送与 `package.json` 完全匹配的 `vX.Y.Z` tag 后，GitHub Actions 会构建各平台包，生成 SBOM、校验文件、发布清单和 Homebrew Cask。正式发布前需要在仓库中配置 `HOMEBREW_TAP_DEPLOY_KEY`；这把 Deploy Key 只允许写入 `chroming/homebrew-tap`，不授予发布流程访问其他仓库的权限。

架构、Target integration、测试证据和发布流程见 [开发文档](docs/development.md)。

## 参与项目

提交改动前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

AgentEnv Manager 使用 [Apache License 2.0](LICENSE)。产品名称和标志归各自权利人所有，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目是独立项目，与上述 Agent 的开发者没有隶属或背书关系。
