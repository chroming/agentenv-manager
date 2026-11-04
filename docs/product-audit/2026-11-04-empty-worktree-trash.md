# Empty Worktree Trash

## Change Evidence Card

Reported symptom: Trash needs one bulk command. The current command omits retained
contents from failed permanent deletion and interrupted moves.

Core job -> reclaim retained disk space -> discard every recovery object would
destroy unrelated restore data -> empty only owned Worktree Trash contents after
one explicit confirmation. Do not require Git health, AI or size calculation.

User intent -> review all retained Trash folders -> permanently remove each exact
verified storage directory -> show per-item progress, keep failures retryable, and
allow stopping after the current item. Original paths are never deletion targets.
Old recovery points and active/interrupted restores remain untouched.
After files are gone, optional Git registration cleanup remains available from the
full recovery view without keeping an otherwise empty Trash visibly occupied.

Owner: shared Worktree recovery classification, disposal journal and existing
WorktreeDialog/WorktreeCleanupReview. Reuse Button, DialogFooter, Notice, ResourceRow,
DiagnosticMessage and the current batch progress/results; no new component CSS.
Risk 9/10; frequency 4/10; density 7/10; expression 3/10; motion 2/10.

Evidence: mixed normal/partial/prepared/legacy/restoring records; partial failure
and retry; restored-after-preview protection; missing space estimates; persisted
original folders and branches. Rebuild before native Electron verification at
920/1180/1440 and en/zh_CN/zh_TW. No real user Trash is a fixture.

## Completion Receipt

- Implemented one Empty Trash command for normal moves, retained interrupted moves
  and partially deleted folders. Previous recovery points and restoring/restored
  items are excluded; ordinary per-item failure does not stop independent items.
- Confirmation reuses the current destructive review, progress, stop-after-current
  and retry flow. It identifies the actual retained paths, not reused original
  folders. Space estimates remain unknown after partial deletion; metadata-only
  retry reports zero additional freed bytes.
- Source-built Electron fingerprint: `4dba415145ee` (672 inputs). TypeScript,
  production build and current-artifact verification passed.
- Related regression: 370 tests in 15 Worktree domain/renderer suites passed.
  Regression tests were first reproduced red for omitted Trash categories and
  restore-state changes, then verified green. No existing tests were removed.
- Native macOS Electron: all three complete Worktree workflows passed in en,
  zh_CN and zh_TW. The extended Empty Trash case purges mixed healthy/partial
  records in one confirmation, preserves a new folder at a reused original path,
  and makes no AI request. Layout/captures cover 920/1180/1440 widths.
- Inspected the rebuilt minimum-window and translated captures. All 21 applicable
  existing critical images passed the unchanged 1.2% pixel threshold; no golden
  replacements or new page CSS were needed. Six style/module/Target/translation/
  feature/UI-contract audits and `git diff --check` passed.
- Evidence: `/tmp/aem-empty-trash-regression-final.json`,
  `/tmp/aem-empty-trash-native-final.json`, `/tmp/aem-empty-trash-native-final/`,
  `/tmp/aem-empty-trash-visual-final/visual-report.json`.
- No real user directories, Trash, credentials or paid models were used. Verification
  is source-built macOS Electron, not packaged Windows/Linux approval. Unsafe or
  inaccessible storage remains a per-item failure; it never authorizes deleting a
  substituted directory. Clear permanently discards the selected Trash contents;
  it deliberately does not create another content backup.
