# Operation Boundaries

## Change Evidence Card

AgentEnv is a local-first desktop tool for safely changing selected resources.
Risk 9/10, frequency 6/10, density 8/10, expression 3/10, motion 2/10.
The reported Worktree stall identifies a broader class: advisory work can hold a
primary command or make a committed change look like a failure. Keep the existing
shell, modal, AppFeedback, selection and safety model. Do not timeout an authorized
write and then claim it stopped, silently bypass a mandatory prerequisite, retry
an already committed mutation, or present unknown information as zero.

## Findings And Fixes

| Surface | Confirmed coupling | Owner correction |
| --- | --- | --- |
| Startup, IPC, Copy details, report export | Diagnostic disk writes/reads or metadata collection could stall a real result | Bound optional waits, cap the writer queue and preserve recent redacted evidence in memory |
| Profiles, Apply, Skill import/update/cleanup, recovery | Whole-environment readback could delay or overwrite success | Apply returned records first; report a failed refresh separately and do not replay the write |
| Instructions | Profile usage was required to read healthy Instructions; save waited for another list/usage pass | Treat usage as advisory for display; keep mutation-time reference verification and the recovery backup |
| Settings and data restore | Native menu, retention list, Agent refresh or Profile readback could strand saved/restore feedback | Return the verified result, release busy, then refresh; do not accept an older settings snapshot over a newer save |
| SSH devices | Save or rename waited for SSH and sometimes probed unrelated devices | Save local changes independently; report connection failure on the affected device; verify a changed managed connection before persisting it |
| Workspaces | Adding/removing a reference and editing resources waited on follow-up discovery | Use the returned summary or selected ID; read back resources independently |
| Sync and remote Workspace copies | Scratch disposal could mask success or the original error | Discard only private unique scratch storage after the outcome; prepare rollback inputs before applying |

Manual Profile refresh still waits for the selected Profile read before opening
the primary command again. Independent inventory, usage and GitHub results do not
wait for one another to appear. Unknown usage does not become an empty reference
list. Real overlapping writes, stale confirmations, path or identity checks,
reference verification, backup and journal writes, and verified completion remain
mandatory. No new dependency, CSS, recovery format, or destructive command.

## Completion Evidence

- Red proof: five stalled-writer regressions failed on the original IPC behavior,
  `/tmp/aem-operation-boundaries-red.json`.
- Final full non-Electron regression: 2,819 passed in 346 files, zero failures,
  `/tmp/aem-operation-boundaries-verified.json`. Includes pending/rejected optional
  reads, copyable evidence, a failed mandatory Instruction reference read, managed
  SSH identity protection, Sync rollback and stalled scratch cleanup. Test teardown
  drains isolated log writes before deleting fixtures; no product deadline was
  extended to make tests pass.
- TypeScript, production build and current-build assertion passed for fingerprint
  `95f62d903672` (676 build inputs). Styles, module budgets, Target boundaries,
  translations, feature evidence and UI contract audits and diff checks passed.
- Current-build native Electron: 10 tests passed across scoped resource operations,
  Workspace Sync and Worktrees, `/tmp/aem-operation-boundaries-final-native.json`.
  Synthetic Profile list failure left one committed Profile, closed the Create
  dialog and showed a separate warning with an executable Refresh action. The
  minimum-window capture was inspected; 920/1180/1440 geometry was verified.
  Captures: `/tmp/aem-operation-boundaries-final-native`.
- Scope: synthetic local data and native macOS Electron only. Remote identities and
  failure modes use fixture transports; no actual remote host, user data or model
  quota was used. This is not a packaged release verification. The Worktree
  physical-deletion policy and its remote root-cause investigation are unchanged.
