# Worktree Cleanup Size and Completion

## Change Evidence Card

- User outcome: see per-directory and total cleanup sizes, select eligible trees
  per repository, and finish verified cleanup without waiting for unrelated scans.
- Ownership: Git registrations and fresh content fingerprints authorize removal;
  sizes are presentation/accounting, never proof that a task has been integrated.
- Shared owners: AlignedResourceList/ResourceRow for rows, CatalogSortMetric for
  sizes, DetailList for totals, IconButton for repository selection, and existing
  modal header/body/footer for review and results. No new component style system.
- Exclusions: no automatic deletion, no skipped freshness checks, no cleanup of
  real developer worktrees, no branch deletion or remote mutation.

## Reproduction and Repair

- A real temporary Git fixture recorded two redundant inventory-only size scans
  during Preview/Remove. Fingerprints now collect sizes in their existing traversal.
- The renderer waited for a full inventory after successful removal. Verified paths
  now leave the list directly, and failed paths remain but lose batch eligibility.
- Small source files previously opened an individual read stream. Files up to 64KiB
  use buffered reads; larger files still stream. The persisted hash serialization is
  unchanged and independently checked against the original streaming implementation.
- A controlled 400-file fixture measured streaming at 32ms and combined fingerprinting
  at 17ms. This is a warm local fixture, not a promise about customer disk performance.
- Git removal disables fsmonitor. Git freshness checks, recovery refs, verified
  dirty-file/index backups, final pre-remove hashing and post-remove registration/path
  verification all remain intact. Large or dirty trees can still take time.

## Accounting and Selection

- Preview lists each reviewed directory size, selected total and estimated freed size.
- Results list each attempted size and count only verified removals in totals.
- Retained full recovery copies contribute zero to the freed estimate; their content
  remains recoverable. Unknown measurements remain unavailable, never a guessed zero.
- Sizes are logical file bytes excluding the root Git administration file, not exact
  disk blocks, filesystem deduplication or journal/ref overhead.
- Repository selection toggles only visible eligible trees. Dirty, ignored-content,
  main, kept, locked and unsafe trees require their existing individual review rules.
- Even errors with an empty message stay failures and cannot appear as Removed or
  contribute to freed space.

## Completion Evidence Receipt

- 99 targeted tests across six files: inventory, cleanup/recovery, snapshot hashing,
  discovery, IPC, renderer and sorting. Covers partial failure, retained backup totals,
  no post-cleanup global scan wait, selection boundaries and old hash compatibility.
- Build/type checking passed; final runtime source identity: `5ec6bf045eda`.
- Electron coverage: en/zh_CN/zh_TW; 920/1180/1440 widths; real isolated Git cleanup
  and restore; batch selection; totals; actual visible size-lane geometry; persistence.
- Capture location: `/private/tmp/agentenv-worktree-cleanup-20261005`. Minimum-window
  confirmation and results are visually inspected, not only checked in the DOM.
- Module budgets, style, translation, UI contracts and feature evidence audits passed.
- No full release suite, packaged-app test or native Windows/Linux run in this task.
- No changes to real worktrees, no dependency additions, no push or release.
