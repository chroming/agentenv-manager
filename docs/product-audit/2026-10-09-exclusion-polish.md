# Exclusion interaction follow-up

## Contract

Keep low-frequency excluded resources available without allowing them to dominate
the working list. Use the shared disclosure, icon-button and menu components; do not
change cleanup eligibility, scan coverage or persisted exclusion records.

## Changes

- Ignored repositories are collapsed by default with a repository count. Search
  temporarily opens the section; clearing search restores its disclosure state.
- View repository opens the excluded section before focusing its recovery action.
- Excluded filter covers individual keeps and repository ignores; cancellation uses
  Stop keeping Worktree rather than the implementation term Remove keep marker.
- No eligible rows means no batch selection button. Review uses ClipboardCheck,
  reserving Trash for the actual removal step.
- Skill source menus offer Unignore as well as Ignore; the status shortcut remains.

## Verification

- Build, TypeScript, UI contract, translation and module-budget checks passed.
- 53 Worktree/Skill source renderer tests passed, including search restoration,
  absence of inapplicable controls and menu reversal without import.
- Three native Electron locale cases passed across 920/1180/1440-width layouts.
- Isolated fixtures only; no production AI or real Worktrees changed.
- Screenshots: `/tmp/agentenv-exclusion-polish-20261009`.
- Full release suite and packaged application verification were not run.
