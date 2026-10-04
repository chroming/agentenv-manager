# Visible Sort Metrics

## Reopened Defect

Sorting controls and correct ordering are not sufficient evidence: users must see the value
responsible for a row's position. The previous catalog change hid several criteria in hover
details or omitted them entirely. This follow-up corrects the row projection, not the comparator
or resource-management model.

## Scope and Contract

- Skills reuses the Source track for source modification time or distinct Profile references
  when those sorts are active. Name sorting retains the existing source control. The date is
  `upstream.updatedAt`, exactly as in the comparator, not an available update's date.
- Instructions shows modification time in its existing secondary line during date sorting.
- Worktrees shows size or modification time in the existing metadata track. Repository headers
  show the comparator's aggregate of visible linked Worktrees, excluding the main directory.
  An incomplete measurement is unavailable, not a partial total or zero.
- Groups displays the eligible, distinct update count; Sources also displays zero changes when
  sorted by changes. Failed source checks retain their error state and known change count.
- Conversations shows message count during message sorting. Unknown sizes no longer fall back
  to a timestamp in the size position. Backups already exposes size and creation time.
- Metrics are quiet, read-only metadata with full-value hover details. No new persistent columns,
  remote checks, file scans, resource writes, dependencies, or management policies were added.

## Verification

- TypeScript and Electron production build passed; final source identity `8d86ee69b1a8`.
- 127 focused unit/renderer tests passed across ten files; seven component-policy/product-contract
  checks passed. Coverage includes visible values, matching ordering, distinct references,
  eligible update counts, zero/unknown/invalid metrics, retained error states and no extra scans.
- Six Electron scenarios passed across Catalogs and Worktrees: en, zh_CN, zh_TW;
  920/1180/1440 widths. Tagged Skills, Instructions dates, source/group counts and Worktree size
  metrics are checked for visibility and overflow; Worktree metric centers are checked against rows.
- The existing complete Conversation desktop workflow passed with new size/message metric and
  minimum/normal/wide geometry assertions, using synthetic sessions only.
- Fresh captures: `/private/tmp/agentenv-sort-metrics-catalog`,
  `/private/tmp/agentenv-sort-metrics-worktrees`, `/private/tmp/agentenv-sort-metrics-conversations`.
  Pixel review covered minimum Skills dates/references with tags, Instructions dates, Groups,
  Worktree sizes and Conversation counts. No real user data was read or mutated by these fixtures.
- Module, style, Target, translation, feature-evidence and UI-contract audits passed.
- No full release suite, packaged build or native Windows/Linux pixel validation was performed.
