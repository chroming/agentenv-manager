# Exclusive resource editors

## Product read

- Product: local Electron configuration manager for individual developers.
- Core jobs: compose a Profile for one Agent and inspect or edit one Workspace resource family without losing context.
- Risk / frequency / density / visual / motion: `7 / 6 / 8 / 3 / 1`.
- Avoid: simultaneous top-level editors, duplicate counts or routine states, stacked command strips, nested card chrome, and multiple competing scroll owners.

## Goal and interaction contract

The report is that expanded Instructions and Skills are visually noisy, and the same interaction must be consistent in Workspaces. The governing owner is the top-level resource disclosure state shared by Profiles and Workspaces.

1. Opening Instructions, Skills, or MCPs closes the previously open sibling. Clicking the open sibling collapses it, so zero or one top-level editor may be open.
2. The collapsed disclosure header is the sole owner of the resource count and policy summary. The expanded body contains local commands and editable content only.
3. Routine row facts already expressed by a switch, policy, or parent group are not repeated as `On`, `Off`, `Ready`, `Library`, or `Group off`. Exceptional states such as missing content, update availability, external ownership, and pending apply remain visible.
4. Shared-copy migration remains a blocking, reviewable state, but its inline notice states only the consequence and next action. Paths and the complete migration plan belong in the review flow.
5. The page workbench remains the primary context owner. The single active editor may retain its bounded content scroll, but multiple sibling editor scroll areas can no longer compete in the same viewport. Nested Skill groups retain their own disclosure behavior because they represent children of the active Skills editor.

Expanded state is transient UI state. This change performs no filesystem mutation and does not alter Profile Apply, Workspace editing, persistence, rollback, or dirty-navigation semantics.

## Component reuse map

- State: `useExclusiveDisclosure` for top-level Profile and Workspace resource families.
- Structure: `ResourceDisclosureSection` and `ResourcePanelToolbar`.
- Rows: `ResourceRow`, `Switch`, `ToolbarOverflowMenu`, and `InteractiveStatus`.
- Blocking migration: shared `Notice` plus the existing review action.

## Evidence map

- Baseline: `profile-resources-multi-expanded-920x620.png` and `workspaces-resources-multi-expanded-920x620.png` at commit `f13ebea`.
- Renderer: hook behavior, Profile composer, Workspace resource groups, Instructions rows, and Skills rows.
- Desktop: opening a second top-level resource closes the first at `920x620`.
- Visual: paired Profile and Workspace captures at `920x620`, plus the existing expanded-region geometry checks.

## Completion receipt

- Shared owner: `useExclusiveDisclosure` now governs the top-level resource family in both Profiles and Workspaces; nested Skill groups are unchanged.
- Information budget: the expanded Instructions toolbar no longer repeats its enabled total, routine Instruction and Skill row states are implicit in their switches, and exceptional states remain in the fixed state lane.
- Blocking state: the shared-copy notice keeps its consequence, Target scope, and review action while moving path detail into the existing review flow.
- Renderer evidence: 38 targeted tests passed across the disclosure hook, Workspace resource groups, Instructions, and Skills.
- Desktop evidence: targeted Profile and Workspace flows passed, followed by the complete gate at 1690/1690 unit and integration tests plus 156/156 Electron tests.
- Audit evidence: style architecture, module budgets, Target boundaries, 1657 translated messages, feature evidence, and UI contracts passed.
- Visual evidence: final-build `profile-resource-exclusive-920x620.png`, `workspaces-resource-exclusive-920x620.png`, `profile-skills-920x620.png`, and `profile-skills-region-920.png` matched their committed baselines byte-for-byte. The full visual sweep also reported baseline drift in unaffected Agents, standalone Instructions, and Target stop-management captures; those unrelated baselines were not accepted or rewritten as part of this change.
