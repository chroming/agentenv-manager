# Local observation performance review

## Change Evidence Card

- Intent: reduce unnecessary local I/O and post-operation waiting without changing resource
  ownership, mutation scope, or layout.
- Product: a local-first desktop Agent environment manager. Data safety takes precedence over
  avoiding a fresh mutation check.
- Defect class: repeated observation reads, serial independent reads, and a completed mutation
  holding global busy state while an unrelated inventory scan finishes.
- Owners: Activation status observation, Instruction usage inventory, and Backup recovery controller.
- Sibling boundaries inspected: Profile Activation, Instruction deletion/reference rollback,
  backup maintenance, workspace inspection, and indexed Conversation reads. Only the three
  evidenced opportunities below changed; this is not a claim that every operation is optimal.

## Changes and measurable invariants

| Operation | Before | After |
| --- | --- | --- |
| Two Agents using one Profile | Two Profile reads per status observation | One read per observation |
| Linked Skill status | Drift and effective-version checks each hash the path | One hash per exact path/kind per observation |
| No visible Agent state entries | Still scans Library | Returns without the Library scan |
| Independent Instruction reference reads | One at a time | Up to four, ordered batches |
| Backup deletion completes | Global busy waits for the inventory scan | Mutation completes; inventory refresh runs separately |

The new regressions first reproduced five failures in the old implementation. Tests assert
I/O counts, bounded concurrency, and completion before a deliberately held inventory request.
They do not promise a particular speedup on another device or filesystem.

## Safety and interaction boundaries

- Observation reuse is request-local. Later refreshes re-read external changes. Preview/Apply
  continue to use fresh independent resource checks; distinct Agent paths and kinds remain distinct.
- Instruction reads join the active batch before failure. No later batch starts after failure,
  and reference mutation, backups, and rollback stay unchanged.
- A pre-deletion inventory result is discarded. The freshness coordinator performs a new scan
  after the older one settles, even if the older scan failed. A new failed scan is not retried automatically.
- Only one exactly confirmed deleted backup is removed optimistically. Bulk counts do not identify
  deleted IDs, so bulk cleanup waits for authoritative inventory data to replace the list.
- During that passive scan, deletion controls wait but previews, closing, and navigation remain
  available. A refresh failure cannot turn an already completed deletion into a mutation failure.
- Full backup integrity/protection checks remain unchanged. No dependencies or visual CSS changed.

## Evidence Receipt

- The first complete run passed 2,259 non-Electron assertions and exposed eight desktop
  assertions that still used superseded UI contracts: ambiguous sort/overflow selection,
  pre-Worktrees navigation order, old catalog/filter classes, native `title` instead of
  shared hover disclosure, pre-TextAction line height, and the old Reset label. Current
  components and styles were already present before this change. Tests now target the
  shared controls and retain the same workflow, count, filtering, and geometry coverage.
- Targeted service/controller/component regressions passed, including fresh external drift,
  shared Profile reads, exact path/kind separation, joined read failure, coalesced refresh,
  partial cleanup, and usable preview/dismissal during passive scanning.
- Complete `npm run verify:commit` passed: 2,259 non-Electron tests in 307 files and
  196/196 Electron tests with exact coverage. Style, module, Target, translation, feature
  evidence, and UI contract audits passed. No tests were removed.
- Electron build artifact: `839597955d2e`.
- The backup deletion workflow was also run separately at 920px and its rendered capture
  `/tmp/agentenv-observation-perf/backups-after-delete-920.png` was visually inspected.
- Packaged-app and other-device timing verification are not part of this change.
