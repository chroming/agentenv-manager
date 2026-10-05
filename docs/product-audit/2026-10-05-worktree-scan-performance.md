# Worktree Scan Performance and Git Warnings

## Reproduction

Four regression fixtures failed against the previous scanner:

- An ordinary scan container launched a failing Git repository probe.
- An invalid `.git` directory stopped discovery of a valid repository below it.
- A worktree without submodules still started the recursive git-submodule process.
- Independent registered trees were checked serially, with a maximum of one Git process.

Reproduction command:

```sh
npx vitest run tests/main/worktreeService.test.ts -t 'ordinary scan containers|invalid Git marker|submodule process startup|independent worktrees concurrently' --maxWorkers=1
```

The seven-tree fixture measured 778ms before and 219ms after the change. It injects
20ms into each status call to expose scheduling and uses temporary real Git repositories.
This is controlled regression evidence, not a speed estimate for customer machines.

## Repair

- Discover ancestor Git markers with filesystem reads before invoking Git. Ordinary
  containers do not produce failed repository probes; selected repository subfolders
  still resolve to their owning repository.
- Preserve invalid-metadata warnings with an exact path and repair guidance. Continue
  scanning their child directories and other locations. Other Git failures retain
  their original details; incomplete discovery remains marked incomplete.
- Identify submodules from index gitlinks instead of spawning git-submodule. Gitlinks
  protect missing declarations and missing checkouts as well as initialized submodules.
- Inspect registered trees with at most four workers, preserving registration order.
  Cancellation waits for active workers and does not start queued checks or publish
  partial cleanup eligibility.
- Disable fsmonitor and optional locks for passive Git reads. No Git index refresh,
  resource mutation, dependency addition or renderer styling change is introduced.

## Verification

- 96 targeted tests passed across six files: discovery, inventory, cleanup/recovery,
  IPC cancellation, process runner, renderer workflow and sorting.
- New coverage includes ordinary containers, invalid markers with valid descendants,
  bounded inspection concurrency, cancellation during concurrent checks, selected
  source subfolders and gitlinks without declarations/checkouts.
- Three current-build Electron Worktrees workflows passed for en/zh_CN/zh_TW, with
  920/1180/1440 widths, explicit cleanup and recovery, and repeated/cancelled scans.
- Build/type checking, module budgets and feature evidence audit passed. Current
  runtime source identity: `6cb4079d9ecc`.
- Mock captures: `/private/tmp/agentenv-worktree-scan-20261005`; minimum-size English
  inventory inspected. All mutation tests use isolated temporary repositories.
- The reported other-machine warning stream was not available for direct replay.
  The reproducible discovery defects are fixed; distinct permission, ownership or
  repository corruption failures remain visible and require their specific paths.
- No full release suite, packaged-app or native Windows/Linux verification was run.
