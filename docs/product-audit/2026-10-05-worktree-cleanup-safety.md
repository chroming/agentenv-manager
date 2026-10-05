# Worktree Cleanup Safety

## Change Evidence Card

- Symptom: unrelated refs could admit unfinished work to batch selection; index-only edits
  after Backup escaped the final content check; failures did not stop the repository batch.
- Intent: remove reviewed working directories without losing unreviewed local work or Git
  history. Preserve individual review, verified dirty recovery and existing UI primitives.
- Owner: Worktree service owns evidence and authorization; renderer owns repository-scoped
  progress, failure and not-run reporting. Git registration remains authoritative.
- Scope: inventory, target selection, Preview, Remove, recovery, manual AI analysis and batch
  results, in all locales and supported window sizes.
- UI reuse: SelectField, DetailList, AlignedResourceList/ResourceRow, Badge, Notice and
  DiagnosticMessage. No page-owned control styles or dependencies are introduced.

## Boundaries

- Local refs only; no automatic fetch, MR lookup, AI request or branch deletion.
- A contained HEAD proves ancestry, not task completion or functional correctness.
- Dirty removal remains individually approved and backed up; nested/submodule/active Git
  states remain protected. Unknown integration does not prevent individual review.
- Checks detect Git/index/evidence drift, not arbitrary external writes atomically. An
  already removed directory remains a completed result when subsequent verification warns.
- Logical space estimates retain their existing contract, not physical disk guarantees.

## Required Evidence

- Real disposable Git fixtures: sibling/tag/recovery refs, explicit and missing targets,
  target revision drift, preview and post-backup index-only edits, branch preservation,
  dirty restoration, bare repositories, stale registrations and post-removal warnings.
- Renderer: failed-repository stop, independent continuation, truthful totals, preserved
  recovery, target selection and fresh state.
- Rebuilt Electron: existing Worktrees flow plus target selection and minimum-window
  geometry/pixel inspection; translated default/large sizes remain covered.
- Completion commands and limitations are reported in the task, not inferred from an older
  verification snapshot.

## Completion Evidence

- Native `npm run verify:commit`: 2,284 non-Electron tests, 196 Electron tests and all
  six engineering audits passed. The initial nested-sandbox run failed six native process
  isolation tests; the native rerun passed without skipping them.
- Final renderer refinements preserve kept/locked/unavailable siblings after repository
  failure and do not present the Worktree's own branch as integration proof. All 95
  Worktree service, analysis, IPC and renderer tests passed after these refinements.
- Final `npm run build` passed. The rebuilt Worktrees Electron test passed for English,
  Simplified Chinese and Traditional Chinese, with 920, 1180 and 1440 pixel widths.
- Actual target-review, analysis and cleanup-result pixels were inspected. All nine
  analysis captures passed the existing visual contract (0.014-0.025% changed pixels,
  1.2% limit), without replacing goldens or loosening tolerances.
- Tests use disposable Git repositories and a fake AI service. This is macOS source and
  rebuilt Electron evidence, not Windows/Linux packaged certification or a live MR/model
  correctness guarantee. No real user Worktrees were removed.
