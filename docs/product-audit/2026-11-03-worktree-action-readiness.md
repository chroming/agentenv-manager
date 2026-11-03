# Worktree selection and action readiness

## Feature Admission: Recoverable Unfinished Git State

Local cleanup support now includes paused Git operations, not just file/index
contents. This is the existing removal intent, not a new navigation destination.
The device-local recovery owner must retain operation files and required Git
objects; no Profile, Agent, remote repository or AI policy changes are included.
Idle/selected state is not execution authority. Preview is read-only and scoped;
Remove performs fresh checks and verified backups; success requires absence from
disk and registration. Errors retain originals or protected recovery records.
Cancellation before Remove writes nothing; stale/changed writers are never silently
adopted. Restore protects externally changed paths and preserves paused-operation
contents after restart and Git GC. Unknown space is not a preparation prerequisite.
Native Windows/Linux and packaged runtime proof are separate from local macOS proof.

## Change Evidence Card

- Report: unfinished Git operations have no manual selection/removal; confirmation
  still waits for whole-directory work presented as space checking.
- Intent: choose an unwanted linked working directory and start one recoverable
  removal. A cached classification and optional space totals are not authorization.
- Ownership: shared selection predicate; main-process preview/execution and Git-state
  recovery; Renderer only presents request-scoped readiness, not safety permission.
- Red evidence: cached unfinished-operation Renderer test fails with no checkbox;
  unknown-size confirmation test already passes. Backend regression must prove that
  preview never enumerates/hashes the entire working folder.
- Required boundary: paused merge/rebase/bisect/conflict state is recoverable local
  content, not proof of an active writer. Preserve working files, index, operation
  metadata and required commit reachability before removing it. Real write locks,
  unstable contents, main trees and unrelated nested repositories must not be
  overwritten or forcibly killed to make a command look successful.
- Workflow: select -> lightweight read-only intent preview -> explicit Remove ->
  exact source snapshot + verified recovery -> Git remove -> verify -> restore.
- Space/date totals are optional derived data. Unknown metrics cannot disable
  Remove. Expensive content/backup verification belongs to execution progress.
- Preserve automatic/manual selection origins, sparse failures, one final destructive
  confirmation, sequential per-repository execution and stop-after-current semantics.
- Components remain WorktreeSelectionMenu, ResourceRow, WorktreeCleanupReview,
  InteractiveStatus, existing modal and progress primitives. No new visual system.
- Evidence: actual merge-conflict/rebase fixtures with remove/restore, active-lock and
  stale-data protection, delayed full scan, old cached entries and unknown metrics;
  current Electron artifact across minimum/default/large windows and three locales.

## Completion Receipt

- Root causes confirmed: paused Git markers were classified as active writers;
  preview also performed full-directory fingerprint/size work before confirmation.
- Source/build: `b7436fd58c0a7cf0c44266bd7aeca0282154f8f46f8c40e62c1f9a570addb4b0` /
  `5b1842908b0011b3fbfbd528a1f94acdf6db28631fb891dacd71f01195f94699`.
  The current-source build gate passed after the final native run.
- Backend: 140 focused tests passed. Regression fixtures cover paused merge/rebase,
  conflict/staged index, unreachable commit/index objects, hidden index flags,
  writer locks, pointer substitution, exclusive-copy races and legacy interrupted
  full-checkout recovery. Preview regression forbids full-tree fingerprinting.
- Independent review replayed the four original safety counterexamples: redirected
  registrations are rejected before victim writes; exclusive copy preserves a racing
  external file; required-object resolution failure prevents removal; four-character
  pending cherry-pick commits remain usable after deletion, reflog expiry and GC.
  Real merge/rebase recovery and abort preserve main; clean trees keep refs-only
  removal and reclaim space. Legacy altered file/index/operation cases are refused.
- Native Electron: four scoped E2E cases passed using isolated Home directories and
  real temporary Git repositories. The normal workflow covers 920/1180/1440 widths
  across en/zh_CN/zh_TW. Each locale also removes/restores a real paused merge at
  920x620 while its preview deliberately reports unknown optional size.
- Visual proof: inspected and registered three paused-operation confirmation images;
  warning, unknown-size disclosure and enabled footer actions fit the minimum window.
  All 127 earlier reviewed baselines and comparison thresholds remain unchanged.
- Six audits passed: styles, modules, Targets, translations, feature evidence and UI
  contracts. Broader non-Electron regression: 335 files / 2680 tests passed in
  111.20 seconds, including the new recovery and visual-baseline integrity cases.
- Scope: no real user repository was modified, no paid model request was made, and
  there is no new dependency, packaged-app, native Windows/Linux or release claim.
