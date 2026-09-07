# Skill 标签输入与列表列布局

## 契约

- 标签建议只发送名称、描述与标签词表。固定标签来自整个 Library，作为优先词表与命名风格参考，不强行匹配无关标签。
- 本地 SKILL.md 校验、哈希与保存前防过期检查保留，不发送正文。分析规则版本、名称描述、固定标签归属变化参与缓存键。
- Tags 独立列与名称、来源、状态共享表格网格。完整标签才能显示，剩余进入 +N 菜单，不换行、不截断半个标签。
- 使用 TagChip 与 ToolbarOverflowMenu，菜单复用既有 Portal、Escape、焦点恢复逻辑。标签筛选和编辑功能保留。

## 验证

- 构建标识：`ec22b957d0a2`。
- 主进程标签服务、共享标签规则、标签编辑/建议弹窗及 Library renderer 定向测试通过。
- Electron 使用隔离 Home 与本地假 AI 服务，覆盖 en / zh_CN / zh_TW，920 / 1180 / 1440 宽度；检查所有表头与内容列起点对齐、名称与标签居中、列不重叠、完整标签在列内及溢出菜单可达。大窗口截图发现旧列号错位后已修复并补入该断言。
- 截图：`/tmp/agentenv-ai-tags-evidence/tag-list-{locale}-{width}.png`；人工查看最小英文与最大中文布局。
- build、styles、translations、ui-contracts、diff whitespace 检查通过。未运行全量发布套件、未调用真实 AI、未打包发布。

## 标签视觉复查

- 用户反馈揭示了组件选型缺口：标签溢出使用了工具栏 IconButton，导致 +N 是方形按钮。ToolbarOverflowMenu 现在提供 tag 触发器，使用同一 TagChip 外形；列表标签明确采用 20px 紧凑高度，避免通用按钮最小高度覆盖。
- 建议结果移除重复的 New tag 行内标记，新标签信息与推荐理由保留在悬浮说明。未改变标签来源或保存语义。
- 当前构建 `ea034e07e938`：18 项 renderer 测试及 Electron 三语言三尺寸测试通过，额外断言标签与 +N 的高度、圆角一致。检查列表与生成建议截图；styles、构建及 whitespace 检查通过。

## 列表密度与来源标识

- 列表专用标签收紧为 18px、小圆角和弱边框，不改变编辑器的操作热区。固定标签使用 Pin，AI 标签使用 Sparkles；完整标签、溢出菜单均保留来源说明，尺寸测量包含图标。
- 构建 `ac6122b42e23`：9 项定向 renderer 测试、三语言三尺寸 Electron 测试通过。查看最小窗口截图，styles 与 whitespace 检查通过。
