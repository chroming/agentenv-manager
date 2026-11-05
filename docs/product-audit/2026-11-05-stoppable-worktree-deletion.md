# Stoppable Worktree Deletion

## Findings And Boundary

A remote installed app remained at 9/14 for over an hour without an elapsed display.
Its Stop command said it was finishing the current Worktree. The precise reason for
that remote filesystem wait remains unverified; do not assume another ASAR incident
or a stale package. A newer local package already includes the prior ASAR fix.

Three failing tests establish a separate, definite product defect: permanent deletion
ignored cancellation, the IPC had no cancellation controller, and the renderer could
only request Stop after current. Two further failing tests show that the outer runtime
diagnostics wrapper can strand an already finished Worktree result/failure behind an
advisory log write despite bounded stage flushing inside the handler.

## Contract And Owner

Core job -> stop an unresponsive cleanup -> returning early while deletion continues
would be unsafe -> isolate physical removal and acknowledge cancellation only after
the owned helper exits. Cancellation is not rollback; deleted files remain deleted.

Reuse the existing private slot, journal, directory identity, physical filesystem,
progress/results surface, Stop icon, OperationStatusBar and retry flow. No new modal,
CSS, dependency, Git repair, full-tree hash, backup copy or size prerequisite.

- Electron uses its built-in utility process; Node integration tests use a fork.
  The trusted worker checks the exact device/inode and removes only the pinned slot.
- The parent never runs a shell or terminates a Git/Agent process. It waits for helper
  exit, including after its success reply; no Promise.race can leave deletion alive.
- Stop bypasses the mutation queue and is bound to the initiating renderer/request.
  It stops the current permanent deletion and prevents later items from starting.
- The journal retains the deleting phase for interrupted contents. Results say Stopped,
  not Deleted or Failed, and do not guess how much a partial deletion freed. Retry is
  still available from Trash, including after restart. Completed independent items
  stay completed. Move to Trash and historical recovery keep Stop after current.
- Keep whole-slot retries with fresh identity checks, but disable nested per-directory
  retries that can amplify a persistent ENOTEMPTY across a deeply nested directory.
- Bound optional Worktree completion/failure log flushing at the actual outer IPC
  boundary too. This never bounds or bypasses required journal durability.

Risk 9/10. All fixtures use synthetic names and isolated directories. The user-specific
project name and paths are not copied into production or test fixtures.

## Evidence

Red tests: /tmp/aem-stop-current-red.json and /tmp/aem-worktree-log-flush-red.json.
Real Node subprocess tests verify cancellation after a first unlink, process exit
before return, untouched remaining files, identity rejection and pre-cancelled launch.
The real Electron queue fixture pauses the tenth helper after a first unlink, checks
9/14 plus elapsed time at 920/1180/1440, stops it, verifies nine completions and four
untouched directories, then retries only the residual Trash item. It also verifies
the main repository and the absence of a leftover cleanup process.

Source fixture evidence: /tmp/aem-stop-current-fourteen-source.json and
/tmp/aem-stop-current-native/. No claim is made that the remote machine was inspected.

## Completion Receipt

- All 2,792 tests in 343 non-Electron files passed. All seven native Electron cases
  passed, including the three ASAR fixtures and complete en/zh_CN/zh_TW workflows.
  The queue test also makes the helper ignore SIGTERM, proving the owned-process
  force-stop fallback exits before cancellation is acknowledged.
- All six style/module/Target/translation/feature/UI audits pass. All 21 existing
  critical captures pass the unchanged 1.2% threshold; no golden replacement or new
  CSS was needed. Stopped-result disclosure is at the top, not hidden after 14 rows.
- After that final disclosure reorder, 100 focused tests and the final source and
  packaged queue fixtures passed again at 920/1180/1440. The initiating renderer can
  cancel its request; another renderer cannot. Final TypeScript, production build,
  artifact freshness and diff checks pass. Source fingerprint: 1bc371f1ac6e, 675 inputs.
- Packaged ARM64 verification uses the actual signed App, not the development
  Electron binary. The new worker loads from app.asar; pending progress stays live,
  Stop ends the helper, nine removals remain completed, four directories remain
  untouched, and only the tenth item's residual Trash contents are retried.
- Final local artifact:
  release/local-stop-current-20261105/AgentEnv-Manager-0.2.5-stop-current-20261105-arm64.dmg
  (116,306,462 bytes). SHA-256:
  8945123c614d9115ac7f610a2880305064aea646f5a0c16c7231637dd460714e.
  DMG integrity is valid; codesign is valid on disk with the existing fixed identity.
  Gatekeeper rejects the non-notarized package as expected, not as an invalid seal.
- Packaged main, worker, preload and renderer entry match the current built output.
  No real user directory, Trash, Agent, secret or paid model was used. No push,
  release or external upload was performed. Windows/Linux packages were not run.
- Reports: /tmp/aem-stop-current-regression.json,
  /tmp/aem-stop-current-all-native.json,
  /tmp/aem-stop-current-final-focused.json,
  /tmp/aem-stop-current-final-source.json,
  /tmp/aem-stop-current-final-packaged.json,
  /tmp/aem-stop-current-visual/visual-report.json.
