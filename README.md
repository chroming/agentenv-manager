# AgentEnv Manager

[English](README.en.md) | 简体中文

AgentEnv Manager 是一个本地桌面客户端，用来管理和切换本机 agent 工具的工作环境。

这里的“环境”指一组可复用配置：指令文件、工具配置、Skills，以及目标 Agent 已安装 MCP 的启停选择。MCP 定义、登录和凭据继续由各 Agent 自己管理。目标是让你在不同开发阶段切换不同 agent 环境时，不需要手动改一堆散落在本机目录里的文件。

![AgentEnv Manager Profiles](docs/images/profiles.png)

## 当前状态

这是一个本地优先的 Electron 客户端，目前处于 `0.1.0` 预发布阶段，已经可以用于真实测试 OpenCode、Claude Code、Codex、Antigravity 和 Trae CLI 的 profile 切换流程。首次接管真实 Agent 前仍应仔细检查 Preview，并保留自己的重要配置备份。

项目使用 `electron-builder` 生成本地应用和安装包。`npm run build` 生成 Electron/Vite 运行产物，`npm run pack` / `npm run dist` 生成本地可运行程序或安装包。

当前支持边界：

- macOS arm64：开发、打包和 packaged e2e 已验证。
- macOS x64：源码支持构建，但尚未进入持续发布验证。
- Windows x64 / Linux x64：已实现平台路径、命令发现、链接策略、原生菜单、终端启动和安装包目标，并配置原生 runner 的 packaged e2e；首次 CI 结果产生前仍视为待验证。
- 正式签名和 notarization 的公开安装包尚未发布。

## 功能

### Profile 管理

- 创建、编辑、复制、删除 profile。
- 每个 profile 是可移植的环境配方，可以应用到任意兼容 Agent；首选 Agent 只决定默认上下文，不限制应用目标。
- Profile 可以管理：
  - 指令文件，例如 `AGENTS.md`、`CLAUDE.md`
  - 来自统一 Library 的 Skills
  - 各 Agent 原生 MCP 的稀疏启停选择；定义、凭据与其他原生配置仍归 Agent 所有
- 应用 profile 前会先生成 diff preview。
- 确认 preview 后才会写入目标 agent 目录。
- 每次应用前会自动创建 backup。
- 支持从 history 预览并回滚 backup。
- macOS 上可用 OpenCode 对已保存 Profile 执行一次隔离评测：选择本地 Git 项目与任务后，查看最终回复、Git Diff、耗时和 CLI 明确上报的 token。评测只使用项目 `HEAD`，临时排除 clone 内的项目级 Agent 资源，不会 Apply、修改原项目或真实 Agent；会调用模型并消耗对应账号额度。

文档入口和现行/历史资料边界见 [`docs/README.md`](docs/README.md)。Profile、Library、Target、Apply、漂移与恢复的规范语义见 [`docs/product-contracts.md`](docs/product-contracts.md)。跨页面交互一致性、桌面布局、状态覆盖与发布证据要求见 [`docs/product-quality-checklist.md`](docs/product-quality-checklist.md)。自动化测试的证据边界、Target 通用契约和打包验证范围见 [`docs/testing-strategy.md`](docs/testing-strategy.md)。

### 对话查找与跨 Agent 继续

- 在一个只读索引中查找本机各 Agent 的历史对话，支持标题、摘要与可见消息正文搜索。
- 当前流式、增量读取 Codex 和 Claude Code 的可见用户/助手消息；OpenCode 优先只读本地 SQLite/旧版存储并在需要时回退官方 CLI；Antigravity 当前只展示可可靠读取的摘要信息。
- `Open original` 通过来源 Agent 支持的命令打开原对话，不直接修改其历史数据库。
- `Continue` 会在另一个 Agent 中创建新对话，并传入经过大小限制和敏感值检查的可见上下文；它不会伪装成迁移原生 session、隐藏状态或运行中的工具。
- 上下文优先通过权限为 `0600` 的短期本地文件交给目标 Agent，无法自动接收时才明确回退为剪贴板。
- 原始历史始终归 Agent 所有；AgentEnv 只保存可删除、可重建的本机缓存，不进入 Workspace Sync、Profile、Backup 或数据导出。

### Skill Library

- 将本地已有 skill 导入统一 skill library。
- 从 GitHub 单个 Skill、任意目录或整个仓库扫描并批量选择导入；支持仓库内 `llms.txt` 明确索引的 Skill 套件。
- 从公司内网或私有 Git 仓库通过 HTTPS / SSH Clone 地址导入；可指定分支、标签和子目录。
- 通用仓库操作复用系统 Git、SSH Agent 与 credential helper，应用不保存仓库密码、Token 或 SSH 私钥。
- 为 library skill 配置独立的 Tracked / Untracked 更新策略。
- 检查 skill 更新。
- 单个更新或批量更新。
- 原地刷新 Library，不清空当前搜索、筛选和列表上下文。
- Skill 与 Profile 可以从内置图标中选择并持久化显示图标。
- Profile 应用时可以用 copy / symlink / auto 模式把 library skill 安装到目标 agent。

### Workspace Sync

- 在 `Settings > Workspace Sync` 连接一个用户自己的私有 Git 仓库。
- 同步可移植的 Profile、Skill Library 与 Skill 来源信息，不同步 Target 状态、凭据、备份、缓存或本机绝对路径。
- 后台只检查远程状态，不会自动拉取、推送或 Apply。
- 更新本机前按资源展示新增、修改、删除与冲突；同一部分的双端修改必须手动选择版本。
- 更新前创建可恢复备份，失败会整体恢复 Profile、Library 和来源注册表。
- 复用系统 Git、SSH Agent 与 credential helper，不保存仓库密码、Token 或 SSH 私钥，也不会强推。
- Live link Skill 可能立即影响正在运行的 Agent，更新前会单独提示并要求确认。

### MCP 管理

- 自动发现各 Agent 已配置的 MCP，不复制定义或凭据。
- Profile 按 Target 保存 `Use Agent setting`、`On` 或 `Off` 三态选择。
- Codex 和 OpenCode 通过原生 `enabled` 字段切换；Trae CLI 2.0 修改 `traecli.toml` 中已有 MCP 的 `enabled` 字段，Legacy 布局修改 `traecli.yaml` 中已有 MCP 的 `disabled` 字段；Claude Code 和 Antigravity 当前只读展示。
- Profile 要求开启但 Agent 中缺少的 MCP 会阻止 Apply；要求关闭但已不存在的 MCP 是 no-op。

### Target 支持

当前内置 target adapter：

- OpenCode
- Claude Code
- Codex
- Antigravity CLI (`agy`)
- Trae CLI (`traecli` / `trae-cli` / `trae-agent`)
- Pi Coding Agent (`pi`)

Trae CLI 会优先识别 2.0 布局：配置和共享资源位于 `~/.trae`，会话等运行时状态位于 `~/.trae/cli`。仅在没有新版证据且存在 `traecli.yaml` 时使用 Legacy 布局。两版共用 `~/.trae/skills` 和 AgentEnv 自有的 `~/.trae/rules/agentenv-manager.md`；版本差异不会出现在 Profile 操作中。

Pi 使用 `~/.pi/agent`，并兼容 `PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR` 和 `settings.json` 中的 `sessionDir`。AgentEnv 只管理 Pi 的 `AGENTS.md` 与 `skills/`；原生设置、认证、包和扩展保持 Pi 所有。Pi 没有内置 MCP 配置，因此不会在 Profile 中修改 MCP。

新增 agent 的理想方式是写一个独立 integration 模块，然后注册到 `src/main/targets/integrations/index.ts`。安装检测、路径、Profile、Skill 运行时扫描规则、原生 MCP 发现与启停能力和资源部署都由该模块声明。适配器只报告 Agent 特有事实，Preview、备份、原子 Apply、校验和回滚仍由统一核心完成。

### 界面语言

- 支持 English、简体中文和繁體中文。
- 首次运行默认跟随操作系统语言；不支持的系统语言回退为 English。
- 可在 Settings > Appearance > Language 中即时切换，选择会持久化，无需重启应用。

### 故障排查

- 运行时操作失败会显示一个形如 `AEM-20260728-ABC123` 的诊断编号。错误消息上的复制和详情入口会提供可选择的脱敏错误、动作、耗时与调用栈。
- 在 `Settings > Data > Diagnostics` 可以复制最近一次问题、导出 JSON 报告或打开本机日志目录；原生 `Help > Export Diagnostics…` 也可以直接导出。
- 诊断日志保存在本机并自动轮转。报告不会包含指令、Skill 文件、对话、MCP 定义、环境变量、凭据或剪贴板内容，Workspace Sync 也不会同步它。
- 反馈另一台设备的问题时，请同时提供诊断编号和导出的 JSON 报告；不需要手工寻找或修改 Agent 配置文件。

## 技术栈

- Electron
- Vite / electron-vite
- React
- TypeScript
- Vitest
- Playwright Core
- Zod
- Shiki
- jsonc-parser
- @iarna/toml

依赖刻意保持少而常见，不为小便利引入冷门包。

## 开发运行

要求：

- macOS、Windows 或 Linux
- Node.js 22.12 或更高版本
- npm 10 或更高版本
- Git；重新生成 macOS 图标时还需要系统自带的 Swift 与 `iconutil`

安装依赖：

```bash
npm ci
```

启动开发版 Electron app：

```bash
npm run dev
```

运行普通测试：

```bash
npm test
```

只运行所有内置 Agent 共用的 Target 契约和机器目录兼容性夹具：

```bash
npm run test:targets
```

只读探测本机安装的 Agent 命令及版本：

```bash
npm run test:compat:installed
```

运行 Electron e2e 测试：

```bash
npm run test:e2e
```

运行完整产品门禁并刷新 `docs/verification-snapshot.json`：

```bash
npm run verify:product
```

发布前运行包含 packaged smoke 的门禁：

```bash
npm run verify:release
```

## 构建

生成 Electron/Vite 构建产物：

```bash
npm run build
```

构建输出在：

```text
out/
```

本地验证构建产物可以运行：

```bash
npm run build
npx electron .
```

注意：这只是运行构建后的 Electron app，不是生成可分发安装包。

## 打包安装包

项目使用 `electron-builder` 打包。常用入口：

```bash
npm run pack
```

生成当前平台未压缩的本地应用，适合快速验证。输出分别位于
`release/mac[-arm64]/`、`release/win-unpacked/` 或
`release/linux-unpacked/`。

生成当前平台的可分发安装包：

```bash
npm run dist
```

只生成 macOS 安装包：

```bash
npm run dist:mac
```

生成 Windows NSIS 安装包或 Linux AppImage / deb：

```bash
npm run dist:win
npm run dist:linux
```

默认输出目录：

```text
release/
```

macOS 目标包含 `.dmg` 和 `.zip`，Windows 目标为 NSIS，Linux
目标包含 AppImage 和 deb。`npm run dist:mac` 会先重新生成 PNG/ICNS
图标；其他平台直接使用已提交的 PNG 资源。

正式发布需要先在 Keychain 安装 `Developer ID Application` 证书，并配置 electron-builder 支持的 Apple notarization 凭据，然后运行：

```bash
npm run dist:mac:signed
```

该命令会在打包后校验应用签名、Gatekeeper 评估和 DMG stapling；任一项失败都会终止发布。

验证当前平台实际打包后的应用能在精简 `PATH` 下发现所有内置 Agent
与系统 Git、导入 Repository Skill，并完成六个 Agent 的 Profile Apply：

```bash
npm run test:e2e:packaged
```

该测试使用隔离的临时 HOME、数据目录和假 OpenCode 命令，不会修改真实 Agent 环境。

## 运行数据

默认数据目录为：macOS 的 `~/.config/agentenv-manager`，Linux 的
`${XDG_CONFIG_HOME:-~/.config}/agentenv-manager`，以及 Windows 的
Electron userData 下 `data/`。`AGENTENV_DATA_ROOT` 在三种平台都可覆盖该位置。

开发时可以指定一个固定数据目录：

```bash
AGENTENV_DATA_ROOT=.agentenv-runtime npm run dev
```

常用环境变量：

```text
AGENTENV_DATA_ROOT          覆盖应用数据目录
AGENTENV_HOME               覆盖目标 home 目录
AGENTENV_FAKE_HOME          覆盖 fake home 目录
AGENTENV_CACHE_ROOT         覆盖可删除重建的 Repository cache 目录
AGENTENV_GITHUB_FIXTURE_ROOT e2e 中用于 GitHub fixture
AGENTENV_GITHUB_OAUTH_CLIENT_ID 源码构建使用自己的 GitHub OAuth App
```

官方构建使用项目维护者注册的 GitHub OAuth App。Fork 维护者应注册并启用
GitHub Device Flow，然后通过 `AGENTENV_GITHUB_OAUTH_CLIENT_ID` 使用自己的
Client ID；普通用户无需手动填写 Client ID。OAuth token 仅写入操作系统安全
存储；Linux 没有 Secret Service 或 KWallet 时会拒绝 `basic_text` 降级保存。

## 安全模型

AgentEnv Manager 的核心原则是：先预览，再应用。

应用 profile 时会：

1. 读取目标 agent 当前文件。
2. 生成 preview diff。
3. 检查冲突和不可写状态。
4. 用户确认后才写文件。
5. 写入前创建 backup。
6. 写入失败时尝试自动恢复 backup。

目录和配置替换会先写入同目录 staging，再通过可恢复的原子交换生效；若进程在交换中断，下一次启动会根据 journal 恢复。默认 Live link 模式链接的是完整 Skill 目录，而不是在目标目录内逐文件创建链接。Profile 删除进入应用私有回收区，Skill 删除、清洗和更新会保留可恢复备份。

Repository 扫描只写入操作系统缓存目录中的 bare cache，不会修改用户现有 checkout。缓存不属于 AgentEnv 数据备份，可以随时删除并在下次检查时重建。Repository 更新先进入 Library 的预览与备份流程，不会直接绕过 Profile Apply 修改 Target。

对 Codex 这类敏感目标，真实 home 写入默认有额外保护。开发和 e2e 中可以通过 fake home 隔离测试。

完整的本地数据、网络访问和删除说明见 [PRIVACY.md](PRIVACY.md)，漏洞报告方式见
[SECURITY.md](SECURITY.md)。

## 项目结构

```text
src/main/              Electron main process，文件系统、target adapter、backup、IPC
src/main/targets/      不同 agent 的 target adapter
src/preload/           安全暴露给 renderer 的 API
src/renderer/          React UI
src/shared/            共享类型和 schema
tests/main/            main process 单元测试
tests/renderer/        renderer/jsdom 测试
tests/e2e/             Electron e2e 测试
docs/                  设计、开发和产品审计文档
```

## 常见任务

开发时启动 app：

```bash
npm run dev
```

改完代码后快速验证：

```bash
npm test
npm run build
```

涉及真实切换流程时跑完整 e2e：

```bash
npm run test:e2e
```

使用临时数据目录启动：

```bash
AGENTENV_DATA_ROOT=.agentenv-runtime npm run dev
```

## 下一步

当前明确的发布后续：

- 使用真实 Apple Developer 账号完成签名和 notarization，并在干净 Mac 上复测。
- 将持久化 Profile 字段 `targetId` 平滑迁移为语义更准确的 `nativeTargetId`。
- 继续补充少见但内容确实不同的同名 Skill 冲突样例。

## 参与和许可

- 开发和提交约定：[CONTRIBUTING.md](CONTRIBUTING.md)
- 行为准则：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- 第三方软件与商标说明：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)

AgentEnv Manager 使用 [Apache License 2.0](LICENSE) 开源。项目独立开发，与
OpenAI、Anthropic、OpenCode、Google 或 ByteDance 没有隶属、赞助或背书关系。
