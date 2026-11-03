# Worktree Recovery Backup Inventory

## Feature Admission: Protected Worktree Recovery Backups

Core job -> inspect existing full recovery copies in Backup manager -> normal
retention cannot establish that another copy of uncommitted work exists -> register
a read-only protected projection, never a disposable ordinary recovery point.

User intent -> list or preview -> read the original journal and saved paths -> no
persisted writes, repository commands, ref deletion, rollback, or restore effects.

- Owner/source of truth: Worktree service owns `worktree-recovery/<uuid>.json`,
  `<uuid>/files`, `<uuid>/index`, and repository recovery refs. The new reader owns
  only their Backup manager projection. No new manifest or registration write.
- Non-goals: disposal, integrity verification, restore, progress, or changes to
  Worktree service, snapshot logic, shared worktree types, or WorktreeDialog.
- Support: local recovery storage on macOS/Linux/Windows; existing English,
  Simplified Chinese, Traditional Chinese Backup manager shell. Remote recovery
  and packaged-app approval are outside this change.
- States: idle/listing/preview use existing inventory loading, inline errors and
  Back/Close controls. Missing root is a no-op. Malformed/missing journals, orphan
  UUID copy directories, pending transactions, missing declared copies, and
  unreadable paths remain protected. Refresh rereads disk; nothing is reconciled
  or rewritten. Cancellation closes the dialog without any write.
  An unsafe or unreadable recovery root produces a scoped inventory issue in the
  existing manager notice; ordinary backup inventory continues normally. Preview
  of that recovery storage still rejects the unsafe root.
- Safety: all worktree recovery items, including restored and unchanged records,
  are non-deletable and excluded from every retention scope. Git refs/history are
  not read or modified. Manual disposal is unsupported without a whole-transaction
  protocol owned by the Worktree service.
- Components: existing BackupManagerDialog list/preview composition and styles;
  SelectControl type option; existing Button, FileTypeIcon and GitFork icon;
  existing protected status/action vocabulary. No new raw control or CSS owner.
- Size: logical bytes of journal, payload and index, not source-size estimates or
  filesystem allocation/dedup accounting; symlinks count their own metadata bytes.
  Bounded scans or unreadable paths report lower bounds, never exact zero.
  Metrics share a cooperative two-second deadline across the whole inventory;
  previews have a separate two-second budget. Pending OS filesystem calls cannot
  be forcibly interrupted. Metadata discovery/validation still runs after the
  traversal budget to keep all copies visible. A measurement budget or unreadable
  nested metrics path does not itself imply an incomplete recovery transaction.
- Preview: saved file paths only, including journal/index and empty directories;
  no file bodies or symlink targets. Bounded lists disclose truncation. Inventory
  presence is not a hash verification or evidence that recovery will succeed.
- Evidence: `tests/main/worktreeRecoveryBackup.test.ts`,
  `tests/main/backupMaintenanceService.test.ts`,
  `tests/renderer/BackupManagerDialog.test.tsx`,
  `tests/renderer/catalogSort.test.ts`,
  `tests/e2e/worktreeRecoveryBackups.e2e.test.ts`.
- Completion boundary: focused tests, current build and isolated Electron proof;
  packaged/distribution acceptance remains explicitly unverified.

## Completion Evidence

Focused inventory/maintenance/IPC/renderer tests passed, including unsafe-root
isolation, shared measurement budget, symlink/orphan preservation and unchanged
records with deliberately discarded payloads. Full non-Electron verification passed
2648 tests. Native Backup manager E2E passed on artifact `cd353d7c7833`, covering
920/1440 widths, saved-path preview, retention/manual-delete protection, restart
and invalid-root isolation. The reviewed en-920 critical capture is registered in
the feature evidence manifest and both visual verification entry points. No Git
refs, original directories or recovery payloads are modified by this projection.
