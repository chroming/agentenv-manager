# Worktree sorting evidence

## Change contract

Core job: review local Git working directories and clean only explicitly reviewed,
recoverable targets. Sorting improves inspection; it is not a cleanup decision.
Risk 2/10 for this UI-only change; frequency 5/10, density 7/10, expression 2/10,
motion 1/10. Avoid additional toolbar rows, page-owned control styling, rescanning
for every selection, or interpreting age/size as proof of completed work.

User intent -> select display order -> persist only device-local `ui-state.json`
-> no changes to Git, folders, recovery records, or sync -> choose Name to reset.

Owning layers: pure renderer sorting for group/row order; the existing UI state store
for persistence; shared `SortMenu` for controls and overlays. Conversations migrates
its existing sort interaction to that component without changing query semantics.

Component mapping: `PageHeader` / `ControlGroup`, `SortMenu` composed of `IconButton`,
`ActionMenu`, `ActionMenuItem`; `SectionLabel` / `AlignedResourceList` / `ResourceRow`.
Shared primitive CSS owns menu presentation; Worktrees owns no new control CSS.
The existing shell, scroll owner, minimum viewport and row lanes stay unchanged.
Visual anchor: current Conversations sort affordance, not a new page style.

Name is the default. Date sorts use measured file times; size uses measured bytes.
Groups use linked-tree total bytes, newest/oldest file time, or first status priority.
Main trees remain first but do not affect these group metrics. Incomplete measurements
sort last; ties use natural folder name and exact path. Filtered rows determine group
metrics. Sorting preserves selected identities, never mutates inventory or eligibility,
and is available while the existing inventory is refreshing.

## Required evidence

- Pure tests: all orders, ties, unknown/invalid/zero measurements, grouped aggregates,
  main-tree exclusion, status eligibility, input immutability.
- Renderer: local ordering without IPC scanning, retained selection, filter/refresh,
  restored preferences, modal Escape, shared keyboard/focus/dismissal behavior.
- Persistence: reload through the actual UI state store, unrelated preferences retained,
  malformed updates rejected without changing the last saved sort.
- Desktop: rebuilt artifact, all three locales at 920/1180/1440 widths, menu containment,
  unchanged aligned rows, actual persisted sort and navigation/restart restoration.
- Pixel evidence: list/menu pair at minimum/default/large sizes, selected and working
  toolbar at minimum size; compare shared menu grammar with Conversations.

## Completion receipt

- Artifact: rebuilt Electron identity `68a3168f9f60`; the pre-change artifact was
  `c0e3f61dd2ff`. Runtime and CSS were rebuilt before desktop tests and screenshots.
- Functional: 205 tests across 11 pure, renderer and main-process test files passed.
  Coverage includes 0/1/500 rows, all five orders, unknown values, selected paths,
  refresh/filter restoration, and unchanged cleanup rules. This is the affected suite,
  not the entire release suite.
- Shared-state defect discovered by the persistence test: Zod defaults were being
  applied to omitted patch fields, clearing unrelated ordering/preferences. Updates
  now validate only supplied fields; tests prove reload retention and explicit resets.
- Desktop: 3 Worktrees workflows (en / zh_CN / zh_TW, each at 920x620, 1180x728,
  1440x900) plus 1 Conversations workflow passed. These use isolated homes, synthetic
  histories and temporary repositories; no real Agent or repository data was changed.
- Persistence: each Worktrees desktop workflow reads the actual `ui-state.json` and
  restarts Electron to verify the selected order survives. Unit tests also preserve
  Profile/Agent/Workspace order and per-Workspace Agent selections.
- Overlays: viewport containment, shared radio-menu semantics, keyboard navigation,
  Escape/focus return and outside/scroll/resize dismissal tested. A sorting menu inside
  a Worktrees dialog consumes Escape without dismissing the containing dialog.
- Captures: `/private/tmp/agentenv-worktree-sort-captures`; list/menu pairs for all
  Worktrees locales and widths, plus Conversations menus at all three widths.
  Manually inspected the English minimum list and large menu, Simplified Chinese
  minimum menu, Traditional Chinese default menu and English Conversations minimum
  menu. Sorting uses neutral shared controls; no new toolbar band, row style or emphasis.
- Architecture: styles, module budgets, Target boundaries, translations, feature
  evidence, UI contracts and `git diff --check` passed.
- Known limits: no packaged installer smoke or native Windows/Linux execution; this
  change does not alter platform discovery or worktree removal. Existing timestamps
  are file measurements, not task completion evidence. Package/release readiness is
  not claimed.
