# Nonblocking explicit Worktree cleanup

## Change Evidence Card

Reported symptom: manual cleanup still has Git-lock, metadata and advisory-data
prerequisites after the user has explicitly chosen to discard a directory.
Governing intent: release directory space after one scoped confirmation. Automatic
selection can remain conservative; it must not veto explicit manual selection.
Owner: Worktree disposal capability and its shared confirmation/result projection.
Sibling paths: Trash, permanent deletion, emptying existing/interrupted Trash,
raw-folder restoration, batch preparation, and optional Workspace impact lookup.

Only actual target ambiguity, main-repository/data-root scope, replaced directory
identity, occupied restoration targets and real filesystem failures can stop that
directory operation. Git writing or unavailable metadata suppress permission to
change Git administration, not permission to move/remove the selected folder.
Unsafe optional Git writes are skipped with a scoped warning; there is no lock
deletion, process termination, forced chmod, automatic AI or extra confirmation.

Reuse: WorktreeCleanupReview + Notice for contextual warnings; existing Button,
ResourceRow, DetailList, ModalFrame and DialogFooter for confirmation/progress/results.
No page CSS, new control, navigation destination or dependency is needed. Risk 9/10,
frequency 6/10, density 8/10, expression 3/10, motion 2/10. The shell and supported
920/1180/1440 layouts remain unchanged. A warning cannot disable the final command.

Proof: real temporary-repository tests must complete the intended filesystem action
with index/HEAD locks before/after Preview, keep Git lock/admin bytes unchanged,
continue batch siblings, purge interrupted records without Git repair, and preserve
directory substitution/main-root protections. Advisory Workspace read failure must
not reject preparation. Rebuilt native tests cover enabled warning confirmations
in en/zh_CN/zh_TW, persisted effects, minimum-size visibility and legacy recovery.

## Completion Receipt

- Corrected the acceptance boundary, not just the error message: locks disable Git
  writes, never the explicitly confirmed folder action. Source moves, private-slot
  deletion/retry, interrupted Trash, raw restoration and advisory Workspace reads
  follow this same rule. The legacy archive/Apply ownership safeguards are unchanged.
- Reused the interrupted-move registration helper for ordinary moves, so optional
  Git changes still check exact admin/pointer/backlink identity. Failure drops that
  permission and preserves directory progress. No process is stopped and no lock
  file is deleted. Main roots, actual folder substitution, occupied restore paths
  and real filesystem errors remain protected.
- Built and verified current source
  `1d447e30cd5a826383305ded1b561beaa044e64382412acd62e3aff34b9b89f7`;
  artifact `f76392d70ef8a1ff57ff888ea234ca4ca77dc81da7f2c3a290f6333e4754e880`.
- Full non-Electron run executed 2,751 tests: 2,750 passed initially, with only the
  expected visual-baseline inventory check failing before three new images were
  registered. Both visual-baseline tests passed on rerun after registration. The
  final source includes 48 temporary-repository disposal cases and 78 renderer cases,
  all passing, including locks before/after Preview and after rename, bounded failed
  Workspace reads shared across a batch, unresponsive progress observers, interrupted
  purge/restore, optional metadata retries and genuine identity protections.
- Four rebuilt native workflows passed: complete Worktree flows in en/zh_CN/zh_TW
  and protected historical backup inspection/recovery. The three localized workflows
  then passed again in an independent capture run. Busy-Git fixtures successfully
  moved to Trash, restored and permanently deleted through the UI; original lock,
  HEAD, backlink and main-repository contents stayed unchanged. AI remained an
  explicit single action, never part of cleanup.
- Warning confirmations are enabled and footer-visible at 920/1180/1440. Inspected
  the three minimum-size native warning captures, added only those three golden
  images, and preserved the existing 136 byte-for-byte. All 21 affected images
  passed independent comparison at the unchanged 1.2% limit (maximum 0.640%).
  Evidence: `/tmp/aem-worktree-intent-verify` and
  `/tmp/aem-worktree-intent-comparison/visual-report.json`.
- Style, module, Target, translation, feature and UI-contract audits passed.
  No real user Worktree was a fixture; the reported machine was not modified.
  Windows/Linux and a packaged build were not run. Genuine OS permission/disk
  failures and concurrent filesystem writers can still prevent a directory delete;
  these are not represented as successful cleanup.
