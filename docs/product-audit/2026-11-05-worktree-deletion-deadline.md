# Worktree Deletion Deadline

## Contract

Core job -> reclaim selected space without indefinite waiting -> merely returning
from a Promise.race could leave deletion running -> use one monotonic deadline and
the existing owned-process termination/exit acknowledgement.

- Permanent deletion receives two minutes from accepted execution. Helper startup
  and all whole-slot retry attempts share that budget; they cannot reset it.
- A helper deadline starts termination, then force-stops only that owned helper
  after the existing 750ms grace period. The result waits for its actual exit.
- Timeout is distinct from manual Stop. Timeout leaves one partial, retryable Trash
  item and continues other independent selected Worktrees. Manual Stop ends the queue.
- No automatic timeout retry, extra confirmation, size scan, Git analysis, dependency,
  user setting or filesystem-authorization change is introduced.
- Progress shows elapsed time against the limit. Results use the shared clock icon,
  warning status, top-level notice, result rows, diagnostics copy and Trash retry flow.
  Partial reclaimed/remaining space stays unknown. The trace marks the result partial.

The deadline does not permit abandoning mandatory journal writes, unsafe directory
substitution, or claiming process exit without acknowledgement. It covers cancellable
physical execution, not an absolute guarantee that an unresponsive OS or mandatory
atomic persistence returns at precisely two minutes.

## Evidence Plan

- A real Node helper ignores SIGTERM and hangs after an unlink. Timeout must force
  its exit and preserve the remainder; exhausted budgets must not launch a helper.
- Planner fault-injection tests preserve existing filesystem failure/race coverage
  while separate runner/native tests exercise the real executor. A 90-second first
  attempt leaves only 30 seconds for retry, and timeout is never automatically retried.
- The renderer must not mark timeout Deleted or cancel unrelated items. Diagnostics
  must say partial and offer the existing copy-details action.
- Native Electron pauses item 10 of 14. Manual Stop leaves four items unstarted;
  deadline expiry instead finishes the other thirteen, retains only item 10, exits
  the helper and permits retry. Test-only timer acceleration avoids a two-minute wait
  without adding an application environment override or user-controlled worker path.
- Cover 920/1180/1440, rebuilt source and actual signed package. No user data is used.

## Completion Receipt

- Red proof: `/tmp/aem-timeout-red.json` captured the missing process deadline and
  the renderer incorrectly treating a timeout as successful deletion (two failures).
- Full non-Electron regression: 2,798 passed across 343 files, zero failures,
  `/tmp/aem-timeout-regression.json`. TypeScript, build, six existing audits and
  `git diff --check` passed. No dependencies or CSS changes were needed.
- Rebuilt native Electron: eight Worktree E2E cases passed, including real archives,
  manual Stop and forced timeout, `/tmp/aem-timeout-verified-native.json`.
- Actual signed packaged application: both fourteen-item manual Stop and timeout
  cases passed, `/tmp/aem-timeout-verified-packaged.json`. The tenth helper really
  exited; timeout left one retryable remainder and completed the other thirteen.
  Both flows preserved unrelated data and retried only the retained remainder.
- Captured source and packaged states at 920/1180/1440. Inspected the packaged
  minimum-window result; 21 existing visual comparisons passed the unchanged 1.2%
  limit, `/tmp/aem-timeout-visual/visual-report.json`. No golden images changed.
- E2E readiness waits now tolerate concurrent test load without changing the product
  deadline. Diagnostic verification uses the existing parser on the diagnostic
  message itself, excluding adjacent footer text.
- Artifact source fingerprint: `44c18372159b`, 675 inputs. Current-build verification
  passed; packaged main, worker, preload and renderer payloads match the rebuilt output.
- Local ARM64 DMG: `release/local-worktree-timeout-20261105/AgentEnv-Manager-0.2.5-worktree-timeout-20261105-arm64.dmg`,
  116,309,307 bytes; SHA-256
  `78ce53677165728ef71ab80d2e6c34551372b4e3c52e4cc3061f7b9c93771390`.
  DMG integrity and fixed-identity code-signature verification passed. Gatekeeper
  rejection remains expected for this non-notarized package.
- Scope: isolated macOS ARM64 fixtures only; no real user data was changed. This
  proves the timeout/Stop/retry behavior, not the precise cause of the remote hang.
  Windows/Linux packaged-runtime behavior was not verified in this run. No push,
  tag, public release or upload was performed.
