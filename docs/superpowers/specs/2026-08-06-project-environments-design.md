# Profiles and Workspaces Product Model

## Product Read

AgentEnv Manager is a local-first desktop application for developers who reuse coding-agent Profiles across several local Agents while retaining visibility and control over workspace-local Agent files. Profile switching is the primary reusable workflow; Skill maintenance, Agent deployment, workspace context, recovery, and conversation history are supporting systems with distinct ownership.

```text
OPERATION_RISK       8/10
TASK_FREQUENCY       7/10
INFORMATION_DENSITY  7/10
VISUAL_EXPRESSION    3/10
MOTION_INTENSITY     2/10
```

Avoid: a false `Profile -> Agent -> Workspace` hierarchy, generic Manage/Add verbs with different effects, links from the Library into workspaces, Profile-sync claims for intentionally local files, hidden filesystem scope, duplicate import or deployment workflows, and page-owned versions of shared controls.

## Feature Admission Card

### Core outcome

The user can compose a reusable Profile, review and Apply it to a supported Agent, understand the additional local resources that Agent will load in a frequently used folder, safely edit project-owned files when explicitly requested, and open the Agent in that folder.

### Object and ownership model

```text
Skill Library -> Profile -> Apply -> Agent-global resources
                                      \
Workspace-local files -----------------> Agent session
Agent-native unmanaged settings --------> Agent session

Conversation <- Agent session + canonical cwd
```

- A `Profile` is an AgentEnv-owned reusable recipe containing Instructions, Library Skill references, and supported MCP enablement policy. The public interface calls this object Profile; persisted schema and service names may remain unchanged.
- The Skill Library is AgentEnv-owned reusable Skill content. It does not own Instructions, MCP definitions, Hooks, or workspace files.
- An Agent is an external runtime and Apply destination. AgentEnv owns only explicitly applied, allowlisted resources and deployment evidence.
- A Workspace is a device-local reference to a real folder. The folder owns its local Instructions, Skills, and MCP files. AgentEnv stores reference and optional copy-association metadata only.
- A Conversation is Agent-owned read-only history associated with an Agent and canonical working directory.
- Workspace files are not expected to equal a Profile. They are additional session inputs and must never be labelled out of sync with a Profile.

### Goal-preservation chain

```text
Core job -> safely compose, compare, and switch reusable Profiles
Proposed simplification -> retain only features that directly modify a Profile
Value lost if literal -> existing Skill cleanup, workspace-local context, recovery, and conversation continuity disappear
Recommended boundary -> Profile owns the main reusable workflow; every supporting system keeps one distinct object, owner, and mutation vocabulary

User intent -> save a folder, inspect it as one Agent, edit a named local file, or open it
Conditional branches -> Git status, unsupported resource, existing link, content conflict, stale file, missing Agent
Persisted effects -> folder reference or explicitly previewed regular-file mutation
Recovery -> path-bound backup, atomic write, verification, and restore receipt
```

### Capability boundary

- Every Agent adapter continues to declare inspection, mutation, preview, and launch support independently.
- Partial support is displayed as Partial or Detected only; an empty unsupported category is omitted.
- Workspace inspection never grants mutation authority.
- MCP definitions and credentials remain Agent- or workspace-owned. Workspace MCP editing stays unsupported until an adapter provides a field-level safe editor.

## Vocabulary and Verb Contract

Reserve `Profile` for the saved reusable recipe. Do not use Environment as a second object name in navigation, page titles, or commands. Runtime descriptions may say current Agent setup or loaded resources.

| Verb | Object | Persisted effect | Does not do | Recovery |
|---|---|---|---|---|
| Import | Skill Library | Creates or updates Library content | Does not add to a Profile or deploy | Library backup/restore |
| Add | Profile Skill reference | Adds a Library reference to a saved Profile | Does not copy files to an Agent or Workspace | Profile Save/Discard |
| Apply Profile | Agent | Deploys the reviewed Profile scope | Does not modify Workspace files | Target backup/restore |
| Add folder | Workspace list | Saves one canonical folder reference | Does not modify the folder | Remove from list |
| Copy to Workspace | Workspace Skill | Writes a verified regular-file snapshot | Does not create a link, stage, or commit Git | Project recovery receipt |
| Update Workspace copy | Workspace Skill | Replaces one associated copy after Diff review | Does not update automatically | Project recovery receipt |
| Remove Workspace copy | Workspace Skill | Removes one named project-owned copy | Does not delete the Library Skill | Project recovery receipt |
| Open | Workspace + Agent | Launches an Agent with canonical Workspace `cwd` | Does not Save or Apply a Profile | None |
| Remove from list | Workspace reference | Removes only AgentEnv reference metadata | Does not remove or traverse folder files | Re-add folder |

The same generic label must not cross these effects. A Workspace action never says Install, Manage, Apply, or Sync. An Agent action never says Copy to Workspace.

## Workspace and Git Contract

- `Copy to Workspace` always creates ordinary files, whether or not Git is present. AgentEnv never creates a Library symlink inside a Workspace.
- Library-private metadata is excluded. A device-local association may record Workspace ID, relative destination, Library ID, and copied content hash; it is not written into the repository.
- Git detection is advisory and bounded to the selected Workspace and affected paths. Preview may report `Tracked modified`, `Untracked`, `Ignored`, or `Not a Git repository`.
- AgentEnv never stages, commits, checks out, resets, cleans, or rolls back unrelated Git state.
- An existing link is inspect-only. The explicit `Replace with portable copy` workflow previews the link target and affected files, backs up the link entry, then writes regular files.
- A copied Skill does not update automatically. When a known association differs, the status is `Library changed`, `Workspace changed`, or `Both changed`; the user reviews the Diff before replacing either side.
- Importing a Workspace Skill into Library reuses the existing Library Import flow with its folder preselected. It is not a second import implementation.

## Information Architecture

The sidebar order is `Profiles`, `Agents`, `Workspaces`, `Conversations`, `Skills`, `Settings`. First-run Agent discovery may open Agents; later launches restore the last valid destination.

- Profiles: compose, Save, Compare, Preview, and Apply reusable Profiles.
- Agents: discovery, availability, active Profile provenance, diagnostics, capture, stop managing, and recovery entry.
- Workspaces: remember folders, inspect loaded-resource inputs for one Agent, edit explicit workspace-owned files, and Open.
- Conversations: read-only history and continuation.
- Skills: Library import, update, source grouping, enablement, and local cleanup.

Only the owning page implements a mutation. Other pages navigate to that workflow with context rather than recreating it.

## Workspace Screen

Workspaces uses the shared single-object workspace shell. A temporary searchable object switcher replaces the permanent middle list, so the selected folder owns the available content width.

- Page toolbar: freshness and Refresh. Add folder lives in the object switcher footer and the empty state; once a Workspace is selected, Open is the one emphasized action.
- Object switcher row: folder name, compact path, last-used Agent, and exceptional state only.
- Inspector header: folder identity, an explicitly labelled `Open with` Agent selector, primary Open, and More.
- Loaded-resource summary: applied Profile provenance for the selected Agent, workspace-local counts, Agent-owned input count, and concrete conflicts. It never reports Workspace/Profile sync.
- Workspace files: compact disclosure sections for Instructions, Skills, and detected MCPs. Empty unsupported categories are omitted; read-only categories say Detected only.
- Environment preview becomes `Loaded resource details`, a secondary read-only dialog listing Profile/Agent-global, Workspace-local, and Agent-owned sources separately. Unknown precedence is a limitation, not the headline.
- Empty state appears once across the workbench and contains the standard Add folder command.

## Component Reuse Map

| Visible structure | Shared component | Owner |
|---|---|---|
| Page title and actions | `PageHeader`, `ControlGroup`, `FreshnessStatus` | shared UI/pattern styles |
| Add folder / Refresh / Open | `Button` with existing size and icon variants | shared primitive styles |
| Single-object shell | `SingleObjectWorkspace`, `ObjectSwitcher` | shared pattern styles |
| Folder row | `SelectableListRow`, `OverflowTooltip` | shared pattern styles |
| Detail header | `InspectorHeader`, `SelectField`, `ActionMenu` | shared UI/pattern styles |
| Resource disclosure | new `ResourceDisclosureSection`, extracted below `ProfileComposerSection` | shared pattern styles |
| Section Add | `Button size="compact" variant="secondary"` with `Plus` and `Add` | shared primitive styles |
| File or Git Diff | `DiffWorkspaceDialog` and file-tree primitives | shared dialog styles |
| Dialog shell | `ModalFrame`, `DialogHeader`, `DialogBody`, `DialogFooter` | shared dialog styles |
| Feedback | initiating-control busy state, `Notice`, `AppFeedback` | shared feedback styles |

Page CSS owns only Workspace arrangement. It must not redefine button, field, disclosure, row, dialog, badge, or menu geometry.

## State and Interaction Contract

| State | Visible result | Current command |
|---|---|---|
| Loading | Stable shell and selected reference remain; local scan progress appears | Cancel where safe |
| Ready | Loaded-resource summary and local file sections | Open or explicit edit |
| Partial | Named unsupported/unreadable sources | Details or Retry |
| Dirty | Editor retains unsaved bytes | Save, Discard, Cancel |
| No-op | Content already matches; no write or backup | Close |
| Stale | Current file Diff replaces old preview | Review again |
| Git change | Exact affected paths and Git state | Confirm copy/update/remove |
| Existing link | Link target and portability warning | Keep link or replace with copy |
| Error | Error remains in the initiating dialog with diagnostic reference | Retry or Close |
| Recovery required | Only the affected canonical path is blocked | Open Recovery |
| Missing folder | Reference remains visible | Reconnect or Remove from list |

Every async command follows `Idle -> Pressed -> Working -> Success | Warning | Error`, keeps control geometry stable, and restores focus after dismissal.

## Evidence Plan

- Domain: vocabulary contract, Workspace copy never links, Git advisory status, no Git mutation, association drift, existing-link handling, no-op/stale/rollback.
- Renderer: shared controls, one primary action, Agent context scope, collapsed/expanded resource states, read-only capability, empty/missing/partial/error states.
- Desktop: folder picker, real command discovery, canonical `cwd`, persistence, dirty close guard, native context menu and terminal launch.
- Visual: Profiles/Agents/Workspaces/Skills sibling captures at 920x620 and 1180x728, English/zh-CN/zh-TW, zero/one/many resources, collapsed/expanded, idle/working/error.
- Packaged: Add folder, inspect, copy regular Skill files, restart persistence, and Open launch spec from the rebuilt application.

## Acceptance Boundary

The redesign is complete only when a first-time user can explain where a Skill is imported, where it is added to a Profile, where a Profile is applied, and why a Workspace copy is an ordinary project file. The interface must expose one mutation owner per intent, one emphasized action per selected Workspace, no Profile-sync claim for local files, no Workspace Library links, and no page-specific duplicate of a shared control.
