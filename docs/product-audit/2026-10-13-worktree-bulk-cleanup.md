# Worktree Bulk Cleanup

## Change Evidence Card

- Intent: select cleanup candidates across repositories and review/remove them in
  one batch. Analysis remains an explicit single-tree action.
- Defect class: hidden conditional selection and missing batch stop feedback.
- Owner: WorktreeDialog selection/operation state; shared batch-eligibility rule.
- Reuse: ChoiceInput (including native mixed state), ResourceRow, ControlGroup,
  CatalogToolbar, Button, DialogFooter, OperationStatusBar, Notice.
- No new dependencies, filesystem format, AI requests or background jobs.
- Core job -> batch efficiency -> never interpret selection as deletion consent
  -> preview and fresh removal checks remain authoritative.
- Intent -> eligible selection -> fresh previews -> confirmed existing removal
  transaction -> verified results/recovery; stop affects only subsequent trees.
- Existing shell, tokens and resource rows remain; no new control styling.
- Coverage: global/group/row state, search scope, collapsed groups, ignored
  repositories, zero candidates, stale preview, failure isolation, graceful stop;
  desktop geometry/pixels in three locales and three sizes using temporary Git
  fixtures, never actual user worktrees.

## Verification

- Final Electron build identity: `7b5cbfaa3e0a`.
- 190 focused assertions passed across renderer primitives, Worktree selection,
  sorting, service, analysis, discovery, cache, IPC and recovery snapshots.
- Three real Electron workflows passed (en, zh_CN, zh_TW), each covering
  920/1180/1440 widths, selection, cleanup preview, single-tree AI with a mock
  endpoint, actual temporary Git removal and recovery/persistence checks.
- Native mixed selection, graceful stop and repository-failure isolation have
  renderer regressions. No calls to a real AI provider or actual user repositories.
- Screenshots: `/tmp/agentenv-worktree-batch-captures`, including nine selected
  state captures. Inspected minimum Chinese/traditional Chinese and large English
  captures; shared rows/controls fit without overlap. Desktop geometry assertions
  cover all locales/sizes. No new page-level control CSS was needed.
- Build, translation, style, module, Target-boundary, feature-evidence and UI
  contract audits passed; `git diff --check` passed.
- Scope: focused macOS development-build verification, not a full repository suite,
  packaged release, Windows or Linux validation. No release was produced.
