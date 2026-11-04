# Worktree filesystem cleanup reliability

## Change Evidence Card

- Report: recursive deletion fails with ENOTEMPTY inside a large application/dependency
  tree; diagnostic copying appears stuck; missing and Git-unavailable directories are
  mixed in the inventory and cannot be usefully cleaned up.
- Intent: release space from explicitly selected known directories, not certify Git
  health. Root identity is mandatory; permission to modify Git administration is optional.
- Owners: Worktree disposal retries/identity, inventory presence, and the shared
  DiagnosticCopyButton/diagnostic formatter. Existing ResourceRow, Notice, ModalFrame,
  selection and progress components are retained; no page-specific control or CSS.
- Red evidence: four focused tests fail before the fixes: injected ENOTEMPTY aborts,
  a confirmed missing registered directory remains listed, an already absent Git admin
  blocks permanent deletion, and a pending diagnostic read prevents copying any text.
- Cause confirmed in code: no recursive-rm retry policy, existence conflated with
  inspection success, Git registration required for filesystem removal, and an
  unbounded diagnostic read. The log alone does not identify the process/filesystem
  condition that made the remote machine's Resources directory nonempty.
- Effects: only private disposal slots are retried; each retry rechecks device/inode.
  A known directory with broken metadata can be moved/deleted after fresh confirmation,
  without modifying unverified registration data. Its raw Trash restore is not Git repair.
  Missing paths disappear; unreadable paths remain explicit unknowns. Missing Git
  registration no longer makes a previously discovered, existing directory vanish.
- Safety: root replacement, path redirection, standalone main repositories, known
  active writer locks, retained payload identity, occupied restoration paths, and
  legacy journal support remain tested. No force chmod, process termination, shell
  command construction, full scan or automatic AI request is added.
- Copy behavior: full diagnostics when promptly available; otherwise the visible
  error/reference within 500 ms. Original text is selectable. Native clipboard errors
  still report failure, not false success; old records need no causes array.
- Evidence scope: all worktree domain tests, shared diagnostic renderer tests,
  native minimum-window copy/error and broken-metadata cleanup workflows in three
  languages, persistence inspection, current build and unchanged visual thresholds.

## Completion Receipt

- Build passed; final artifact:
  `1c38585c6e28baf26530a213383bede9006a68629a415f343595711e24248ab3`.
  Source: `2305a48dc214428c62a5a4670a032f656411c8d1a161d0d03c4e31f1571656cd`.
- Full non-Electron regression: 2,736 tests / 336 files passed. After the final
  failure-summary presentation adjustment, all 225 affected domain/renderer tests
  passed again. The disposal file contains 36 real temporary-repository cases.
- Four rebuilt native Electron workflows passed: complete Worktree behavior in en,
  zh_CN and zh_TW, plus protected historical recovery. New checks cover a missing
  registered directory, manually selecting and permanently deleting broken Git
  metadata, a scoped removal error, and Copy details when the diagnostic-read IPC
  never resolves. Clipboard IPC was intercepted to inspect the copied mock text
  without replacing the user's system clipboard; this proves the native UI/IPC
  flow, not every operating-system Pasteboard failure.
- Inspected three 920 x 620 failure/copy captures from the final artifact: actions
  remain visible; errors wrap; unknown retained space is not shown as zero. All
  18 existing affected layout baselines passed independent comparisons at the
  unchanged 1.2% limit (maximum 0.633%). No golden images were replaced.
  Captures: `/tmp/aem-worktree-cleanup-final`; comparison:
  `/tmp/aem-worktree-cleanup-final-comparison/visual-report.json`.
- Style, module-growth, Target-boundary, translation, feature and UI-contract
  audits passed. Build identity and whitespace checks passed.
- No user directory was a fixture; the reported machine's residual files were not
  touched. Windows/Linux and a packaged build were not run. Persistent writers,
  genuine permissions and replaced targets can still fail safely; the precise cause
  of the remote machine's original ENOTEMPTY cannot be inferred from the stack alone.
