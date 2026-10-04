# Registration-first Worktree discovery

## Change Evidence Card

- Symptom: ordinary repository source directories trigger a depth-limit warning
  even after Git has returned all registered Worktrees.
- Intent: inventory local Worktrees without recursively searching tracked source
  contents or suggesting that an already discovered repository is incomplete.
- Owner: Worktree discovery. Git registration is authoritative for Worktrees;
  directory traversal discovers repository entry points only.
- Scope: conventional/manual/Workspace locations, nested repositories, submodules,
  centralized Worktree directories, deep containers, aliases and cancellation.
- Boundary: retain canonical deduplication, bounded directory/output/time budgets,
  no whole-Home scan, no descendant-link crawl, and read-only Git commands. Cleanup
  validation, recovery and ownership rules are unchanged.
- Proof: reproduce false incompleteness with tracked source directories; prove a
  repository beyond seven container levels is discovered; preserve Git-registered
  trees outside scope, nested untracked/ignored repositories and submodules. Run
  focused service/renderer/IPC tests and current-build Electron Worktree workflows.
- UI reuse: existing Scan locations IconButton, Notice/DiagnosticMessage and
  shared modal shell. No new controls or page styles.

## Implementation boundary

Repository containers are searched under a shared directory budget, not a fixed
depth limit. Once a repository entry point is found, Git supplies untracked and
ignored directory candidates and declared submodule paths. Tracked source folders
are not recursively opened by repository discovery. An unusual nested repository
whose containing files are already tracked and which has no submodule declaration
must be added explicitly; discovery must not claim to inventory the entire disk.
Known in-repository Worktree containers remain explicit discovery candidates.

## Additional finding

An isolated absorbed-submodule fixture showed Git `worktree list` returning the
submodule administration directory as its first/main path, both from that directory
and from the working directory. `rev-parse --show-toplevel` resolves the actual
main directory. Registration normalization now uses that declaration for non-bare
administration-directory entries, including fresh cleanup checks. The regression
asserts that the submodule main directory is protected and cleanup is rejected.

## Completion receipt

- The two original regression fixtures failed before implementation: a repository
  below eight container levels was absent, and a tracked source tree incorrectly
  marked a complete registered inventory as incomplete. Both now pass.
- Final build identity: `c0e3f61dd2ff`, verified against current runtime source.
- 63 focused tests passed across discovery, service, IPC and renderer coverage.
  They cover tracked-source pruning, deep containers, external registered paths,
  ignored nested repositories, conventional in-repository containers, absorbed
  submodules, round-robin budget fairness, aliases, unchanged indexes, malformed
  boundaries, config includes, cancellation, cleanup and recovery. Filename tests
  include spaces and Unix newlines; invalid Windows newline filenames are excluded.
- Three Electron workflows passed with real isolated Git repositories and fake
  Homes, for en/zh_CN/zh_TW at 920x620, 1180x728 and 1440x900. Scan locations,
  details, explicit cleanup and recovery remain in the existing shared UI.
- Current screenshots were inspected for the minimum inventory, Chinese scan scope,
  large Chinese inventory and Traditional Chinese recovery. Evidence directory:
  `/private/tmp/agentenv-worktree-registration-final`.
- Build, module budget, Target boundary, feature evidence, UI contract and
  translation audits passed. No dependencies or real Agent/worktree data changed.
- No release-wide suite, packaged-app or native Windows/Linux verification was run.
  Undeclared repositories entirely embedded in tracked source remain explicit
  scan-location inputs, not a reason to crawl every source folder again.
