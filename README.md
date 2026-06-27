# AgentEnv Manager

AgentEnv Manager 是一个本地桌面客户端，用来管理和切换本机 agent 工具的工作环境。

这里的“环境”指一组可复用配置：指令文件、工具配置、Skills、MCP Servers，以及和这些资源相关的安装、预览、备份和回滚记录。目标是让你在不同开发阶段切换不同 agent 环境时，不需要手动改一堆散落在本机目录里的文件。

## 当前状态

这是一个本地优先的 Electron 客户端，目前已经可以用于真实测试 OpenCode / Claude Code / Codex 的 profile 切换流程。

项目仍处在早期阶段：`npm run build` 可以生成 Electron/Vite 的运行产物，但还没有接入 `electron-builder` 或 `electron-forge` 这类安装包工具，所以暂时还不会生成 `.dmg`、`.zip`、`.app` 或 Windows/Linux 安装包。

## 功能

### Profile 管理

- 创建、编辑、复制、删除 profile。
- 每个 profile 绑定一个目标 agent，例如 OpenCode、Claude Code 或 Codex。
- Profile 可以管理：
  - 指令文件，例如 `AGENTS.md`、`CLAUDE.md`
  - agent 配置文件，例如 JSONC / TOML 配置
  - profile 自带 Skills / Agents
  - 来自统一 Library 的 Skills
  - 来自统一 MCP Library 的 MCP Servers
  - Codex disabled skill paths
- 应用 profile 前会先生成 diff preview。
- 确认 preview 后才会写入目标 agent 目录。
- 每次应用前会自动创建 backup。
- 支持从 history 预览并回滚 backup。

### Skill Library

- 将本地已有 skill 导入统一 skill library。
- 从 GitHub 仓库目录导入 skill。
- 为 library skill 配置更新来源。
- 检查 skill 更新。
- 单个更新或批量更新。
- Profile 应用时可以用 copy / symlink / auto 模式把 library skill 安装到目标 agent。

### MCP Library

- 统一管理可复用 MCP server。
- Profile 可以引用 MCP Library 中的 server。
- 同一个 MCP server 可以被多个 profile 和多个 target 复用。

### Target 支持

当前内置 target adapter：

- OpenCode
- Claude Code
- Codex

新增 agent 的理想方式是写一个独立 target adapter，然后注册到 `src/main/targets/registry.ts`。核心切换流程不应该为了新增 agent 大改。

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

安装依赖：

```bash
npm install
```

启动开发版 Electron app：

```bash
npm run dev
```

运行普通测试：

```bash
npm test
```

运行 Electron e2e 测试：

```bash
npm run test:e2e
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

当前项目还没有正式打包脚本。

如果要生成 macOS `.dmg` / `.zip` / `.app`，建议下一步接入一个成熟打包工具，例如：

- `electron-builder`
- `electron-forge`

建议优先使用 `electron-builder`，然后增加类似脚本：

```json
{
  "scripts": {
    "pack": "npm run build && electron-builder --dir",
    "dist": "npm run build && electron-builder"
  }
}
```

在接入前，`npm run build` 只能说明代码可以被构建，不能替代真正的应用分发打包。

## 运行数据

默认情况下，应用会把 profile、library、backup、target state 等数据放在 Electron app data 目录下。

开发时可以指定一个固定数据目录：

```bash
AGENTENV_DATA_ROOT=.agentenv-runtime npm run dev
```

常用环境变量：

```text
AGENTENV_DATA_ROOT          覆盖应用数据目录
AGENTENV_HOME               覆盖目标 home 目录
AGENTENV_FAKE_HOME          覆盖 fake home 目录
AGENTENV_GITHUB_FIXTURE_ROOT e2e 中用于 GitHub fixture
```

## 安全模型

AgentEnv Manager 的核心原则是：先预览，再应用。

应用 profile 时会：

1. 读取目标 agent 当前文件。
2. 生成 preview diff。
3. 检查冲突和不可写状态。
4. 用户确认后才写文件。
5. 写入前创建 backup。
6. 写入失败时尝试自动恢复 backup。

对 Codex 这类敏感目标，真实 home 写入默认有额外保护。开发和 e2e 中可以通过 fake home 隔离测试。

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

比较值得继续补的事情：

- 接入正式应用打包工具。
- 清理界面里还没有真实动作的占位控件。
- 完善 Settings 中和真实写入、安全边界相关的说明。
- 为新增 target adapter 写更明确的开发文档。
- 增加首次启动引导，让用户更清楚 Library、Profile、Target 三层关系。
