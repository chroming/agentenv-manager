# Interface typography review

## Change Evidence Card

- Reported symptom: Worktrees group names, prose, detail headings and path previews
  do not share the application's text scale.
- Intent: retain a readable hierarchy without emphasizing routine metadata or
  reducing every type of text to one size.
- Evidence: current Electron build `fb33044a1bcd` resolves Worktrees group names,
  ordinary paragraphs and confirmation labels to 16px; detail headings resolve
  to 16px/600. Resource names are 13px, metadata 12px and dialog titles 16px/600.
- Owner: base typography supplies an explicit body and fallback section scale.
  Shared SectionLabel and PathListPreview supply compact headings and selectable,
  wrapping path lists. Worktrees page CSS retains arrangement only.
- Siblings: Workspace confirmations, Instruction deletion, Skill summary history,
  capture review, backup summaries and other ordinary UI prose. Document Markdown,
  syntax editors, diff content and primary object/dialog headings retain their
  explicit reading or identity styles.
- Evidence required: computed typography against named tokens; Worktrees details,
  scope and confirmation in three languages and window sizes; current mock
  captures of Agents, Profiles, Workspaces, Skills, Instructions, Conversations
  and Settings; focused primitive/renderer/contract tests and architecture audits.
- Safety: no service, persistence, cleanup, deployment or recovery behavior changes.

## Review method gap

Previous alignment/containment tests did not measure inherited font sizes and
weights. Shared controls were correct, but unstyled text between them fell back
to browser defaults. Typography must be measured alongside geometry, and captures
must check ordinary prose as well as titles and controls.

## Completion receipt

- Final Electron build: `20b57a419450`, confirmed against current source.
- Build, style ownership, UI contract, module-budget and translation audits passed.
- Focused renderer/contract coverage: 10 files, 122 tests passed.
- Electron workflows: Worktrees in English, Simplified Chinese and Traditional
  Chinese, Workspace mutation/recovery and referenced Instruction deletion;
  all 5 tests passed using isolated fake Homes and Git fixtures.
- Worktrees geometry and computed type roles were checked at widths 920, 1180
  and 1440. Ordinary prose and destructive confirmation use 13px/400;
  compact section labels use 13px/500; path previews and counts use 12px/400;
  dialog titles retain 16px/600. Explicit auxiliary descriptions remain 12px.
- Current mock capture completed: 194 PNGs, 191 computed typography records,
  97 ordinary paragraph observations and zero typography violations.
  Evidence directory: `/private/tmp/agentenv-typography-final`.
- Pixel inspection covered Worktrees list, detail, scan locations, confirmation
  and recovery; sibling Profiles, Workspaces, Agents, bulk Skill updates,
  syntax preview, Conversations, Settings Data/Sync and Instruction deletion.
  Worktrees minimum and large sizes and both Chinese locales were included.
- Two initial sibling assertions were corrected after tracing explicit metadata
  styles: Workspace tests now select body prose rather than the header caption;
  Instruction deletion tests retain the intentional 12px auxiliary role.
  No production styles or pixel thresholds were changed to satisfy those tests.
- No dependencies, service behavior or user data were changed. Full release-suite,
  packaged and cross-platform verification were not run for this typography fix.
