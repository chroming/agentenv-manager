# Skills 视图统一验证

## 改动契约

- 用户目标：在 Skill list、By source、Groups 中使用一致的筛选和更新入口；来源新增项可先看文件和 AI 摘要，再决定导入。
- 所有者：SegmentedControl、InteractiveStatus、SkillUpdateDialog、SkillSummaryReview；来源行网格由 catalog-contract.css 管理，手动组沿用 ResourceDisclosureSection / ResourceRow。
- 写入边界：检查及新增预览不导入；Add 继续走原导入事务和冲突处理，确认前重新核对候选哈希。摘要仅手动调用，不修改 Skill 内容。
- 本轮不改变 Profile 组成员关系、部署策略或源仓库内容。

## 证据收据

- Electron 构建：`0310c8d89165`，类型检查和生产构建通过。
- 定向逻辑/Renderer：147 项通过，包括新增预览零导入、不可变摘要证据、内容变化拒绝、取消冲突、缓存复用、手动组检查范围和状态入口。
- Electron：`repositorySkillSource.e2e.test.ts`、`skillSummaries.e2e.test.ts` 共 5 项通过，使用隔离 Home、本地 Git 和假 API。
- 来源行：920 / 1180 / 1440，英语/简中/繁中，测量标题行与成员状态文字、操作列起点及溢出。
- 手动组：三档窗口，检查/批量更新/单项状态入口与按钮容纳；新增预览确认前不存在 Library 文件，确认后导入并关闭。
- 人工查看本轮来源最小窗口、手动组大小窗口及新增预览截图。截图位于 `/tmp/agentenv-source-alignment-evidence`、`/tmp/agentenv-addition-preview.png`；摘要多语言截图由原有 E2E 保留在 `/tmp/agentenv-summary-evidence`。
- 样式、模块预算、翻译、Target 边界、功能证据与 UI 契约审计通过。
- 未运行整库完整套件、未打包发布、未调用真实 AI 服务；不将定向验证解释为全部用户环境或真实模型质量保证。
