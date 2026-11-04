# Trash deletion stall and physical filesystem operations

Reported symptom: one Trash item stays at Removing / 0 of 1 / files for hours,
while all summary values show zero bytes. The affected machine is remote to this
development session; no claim is made that its filesystem state was inspected.

## Reproduction And Owner

- A pending renderer deletion reproduces the premature three zero-byte totals and
  storage basename `files` instead of the original Worktree identity.
- A real isolated Electron process fails to recursively remove a valid copied
  `default_app.asar` bundle with ordinary `fs.promises.rm`: ENOTEMPTY at
  `Electron.app/Contents/Resources`. The identical fixture using Electron's
  built-in `original-fs.promises.rm` completes in 4 ms. This reproduces the prior
  reported failure class, not proof of the remote machine's current exact folder.
- Electron patches Node filesystem APIs for virtual ASAR access. Filesystem
  deletion must target physical entries, not virtual archive contents. Do not
  toggle global `process.noAsar`, manually walk untrusted paths, or add dependencies.
- Worktree removal currently sends progress only when its stage changes; a long
  filesystem call has no liveness feedback. Stage logs are written only on exit.

## Contract And Reuse

Core job -> promptly reclaim selected Trash contents -> skipping ownership or
directory-identity checks would risk unrelated files -> use the original physical
filesystem for deletion while retaining existing scope and retry checks.

User intent -> review exact retained paths -> permanently remove physical contents
-> verify absence -> retain only failed residual contents and retryable metadata.
Use the same filesystem removal owner for Worktree, backup and shared atomic-staging deletion;
application module loading and ordinary reads remain ASAR-aware.

Reuse WorktreeCleanupReview, OperationStatusBar, DetailList and existing result
rows. Pending first-item state does not assert completed zero-byte totals. Display
the original Worktree name, elapsed time and real available counters. Liveness is
not fake file progress or proof that a stalled OS call completed. Diagnostic stage
start/periodic records contain stage/path/timing, never file contents or credentials.
Logging is advisory and must not delay an already completed destructive operation.

Risk 9/10; preserve original paths, outside symlinks, branches, recovery journals,
storage identity checks, bounded retries, legacy recovery and manual-only AI.
Verify with Node and rebuilt native Electron fixtures; no real user Trash is used.

## Completion Receipt

- Reproduced red through the actual native disposal IPC: a tiny valid ASAR fixture
  in Trash exceeds the 3-second deletion deadline with ordinary Electron filesystem
  traversal. The physical-removal owner makes the same test pass; the whole native
  case, including app startup and backup deletion, takes about 1-2.6 seconds.
- `physicalFileRemoval` uses Electron's built-in `original-fs`, with ordinary Node
  filesystem behavior outside Electron. Worktree disposal, historical Worktree
  recovery cleanup, backup removal and shared atomic-replacement cleanup reuse it.
  No dependency, shell deletion, global ASAR flag or path-authorization change.
- First-item pending UI no longer shows completed zero-byte totals or `files` as
  the Worktree name. Tests verify original identity and a 65-second elapsed display.
  IPC emits 1-second elapsed heartbeats, starts each stage's log before waiting,
  records liveness every 15 seconds, stops its timer on completion and bounds
  optional stage-log flushing. No file/byte percentage is fabricated.
- Production build and current-artifact check pass: `5f82bab1dc96`, 673 inputs.
  All 2,783 tests in 342 non-Electron files passed, including deletion, backup,
  rollback, stale-directory, symlink-boundary, logging-failure and pending UI tests.
  All four source-built native Electron cases passed, including ASAR deletion and
  the complete Worktree workflows in en, zh_CN and zh_TW at 920/1180/1440 widths.
- The ASAR case verifies the main repository, a reused original directory, outside
  symlink contents and the source Electron archive remain untouched, while the
  selected Trash contents and selected backup are gone. No user data was used.
- Inspected rebuilt minimum-size result/Trash captures. All 21 existing critical
  captures passed the unchanged 1.2% threshold; no baseline replacement or page CSS
  was required. All six renderer/module/Target/translation/feature/UI audits pass.
- Evidence: `/tmp/aem-asar-service-red.json`, `/tmp/aem-asar-service-green.json`,
  `/tmp/aem-trash-stall-regression.json`, `/tmp/aem-trash-stall-native.json`,
  `/tmp/aem-trash-stall-native/`, `/tmp/aem-trash-stall-visual/visual-report.json`.
- Remote-machine incident remains uninspected. This verifies a concrete matching
  failure class, not every cause of a blocked operating-system call. New heartbeat
  logs distinguish long pending stages without falsely declaring progress. Native
  verification is macOS source-built Electron, not a Windows/Linux package receipt.
