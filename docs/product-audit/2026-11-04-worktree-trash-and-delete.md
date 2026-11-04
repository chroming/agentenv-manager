# Worktree Trash and permanent deletion

## Feature Admission: Explicit Worktree Disposal

Core job: quickly reclaim working-directory space. Trash is reversible retention,
not freed space; permanent deletion explicitly discards local contents without a
full backup. Neither command requires integration analysis, fsck, AI, source hashes
or complete size measurements. Preview verifies registered linked-directory identity.
Main trees, redirected paths and real write locks remain protected.

Product read: a local-first desktop environment manager whose cleanup task is to
release directory space deliberately, not certify code integration. Risk 9/10,
frequency 6/10, density 8/10, expression 3/10, motion 2/10. Avoid hidden copying,
implicit destructive fallback, fake freed-byte totals, per-row ceremony and new
page-owned controls. The existing Worktrees list and centered resizable dialog
remain the shell; paths and destructive scope stay visible at 920 x 620.

Owner: Worktree service, device-local disposal journal and same-volume storage.
Trash retains Git administration/index/operation state and uses a detached HEAD
where available, so the old branch is not reserved. It stays registered at its valid
retained path until purged; AgentEnv excludes only journal-verified Trash entries
from normal inventory. Restore never overwrites an occupied original path. Branch
reattachment is best effort and never moves a branch or overwrites another checkout.
Permanent deletion removes the directory and its exact Git administration only;
it never prunes other registrations or deletes branch/remote refs.

UI: two explicit commands, one shared confirmation/progress/result flow, existing
buttons, Notice, ResourceRow, ModalFrame, and recovery components. Ordinary failures
are item-local. Partial deletion and pending registration cleanup are truthful,
retryable results; cancellation stops after the current transaction. Unknown sizes
remain unknown and never delay an action. Trash has Restore / Delete permanently /
Empty Trash; old recovery points remain distinct and cannot be silently purged.

Component mapping: Button / IconButton and ControlGroup own commands; ContextMenu
composes existing ActionMenu / ActionMenuItem without new styles; ModalFrame and
DialogFooter own the overlay; WorktreeCleanupReview, DetailList, AlignedResourceList,
ResourceRow, InteractiveStatus, Notice and DiagnosticMessage own review and feedback.
The existing Worktree shell, scroll owner, compact density and maximize behavior stay
unchanged. Destructive actions keep visible labels; utility actions retain tooltips.
Control values belong to `ui/controls.css`, dialog geometry to `ui/overlays.css`,
resource compositions to `ui/patterns.css`; existing `ui/pages/worktrees.css`
only arranges domain content. No primitive geometry is overridden by this feature.
No new page CSS, dependency, navigation destination or automatic AI operation is added.
Relative Git pointers are normalized only inside retained storage, recorded and
restored to their original text. The owning Git DB and other registrations stay pinned.

Evidence required: temporary real repositories for dirty/ignored/paused/stale-state
disposal, symlinks, branch availability, restore, missing size, restart, failures,
partial metadata cleanup and no full-copy/hash/health-check calls. Renderer and
native Electron cover both commands and minimum-window/localization stress.

## Completion Receipt

- Implemented both commands and the shared confirmation, progress, result, Restore,
  Empty Trash and registration-only retry paths. No real user Worktree was a fixture.
- Current build: `9446ce2b6e6acad8f591e7fda23279f152f0c05c002dc9184d1da638a36691d6`;
  source `f1365a65b7b89af5d1369b0455c008f77bfcd18737f9b971ddcdfa604d70e4e4`.
  `npm run build` and current-artifact identity checks passed.
- Complete non-Electron regression: 2,718 tests across 336 files passed on Node 22.
  This includes 24 real temporary-repository disposal cases: dirty/ignored contents,
  all Git commands unavailable, old missing operation history, relative pointers,
  same-inode move, staged/untracked restore, branch reuse, changed/occupied paths,
  actual writer locks, interrupted and partial deletion, metadata-only retry,
  stale/tampered journals, missing repository, progress failure and no copy fallback.
- Rebuilt native Electron: three complete Worktree workflows in en/zh_CN/zh_TW
  plus the protected legacy Backup manager workflow passed. Includes 920 x 620,
  1180 x 728 and 1440 x 900, unknown size, batch selection, cancellation/navigation,
  right-click commands, Restore, permanent deletion and Empty Trash. Persisted
  files, staged state, operation metadata, branches and unrelated graph caches
  were inspected, not inferred from success text.
- Inspected 18 affected native baselines; registered six new critical captures.
  A subsequent independent capture from the final build passed all 18 comparisons
  at the unchanged 1.2% threshold (maximum observed 0.769%). Other 118 baselines
  remain unchanged. Captures: `/tmp/aem-worktree-disposal-current`; pixel report:
  `/tmp/aem-worktree-disposal-comparison/visual-report.json`.
- Style, module-growth, Target-boundary, translation, feature-evidence and UI-contract
  audits passed. Feature registry covers the new states and existing eight Targets.
- Limits: this is macOS source-built Electron and temporary-fixture evidence, not
  packaged Windows/Linux approval or proof for every filesystem. Filesystem permission
  errors and genuine active writer locks can still fail an item. Permanent deletion
  intentionally has no content recovery. No real credentials, user directories or
  paid models were used, and no push/release is part of this change.
