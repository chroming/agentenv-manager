# Project Environments Design

## Product Read

AgentEnv Manager is a local desktop tool for developers who need to understand and safely manage reusable global Agent environments and the project-local resources loaded from their working directories. Project work is frequent, information dense, and file mutations are high risk. The interface must remain compact, native, explicit about scope, and honest when an Agent capability is partial.

```text
OPERATION_RISK 8/10
TASK_FREQUENCY 8/10
INFORMATION_DENSITY 7/10
VISUAL_EXPRESSION 3/10
MOTION_INTENSITY 2/10
```

Avoid: an AgentEnv-owned duplicate of project configuration, hidden Profile Apply, guessed Agent precedence, Home-relative links inside projects, whole-project ownership, and generic capability claims that are not backed by an adapter.

## Feature Admission Card

### Feature and core user outcome

Projects lets a user remember common local working directories, inspect and manage their real project-local Instructions, Skills, and MCP resources, preview the observable environment one selected Agent will load there, and launch that Agent with the project directory as its working directory.

### Domain object, owner, scope, and source of truth

- A `Project` is a device-local reference to an existing directory. AgentEnv owns only the reference metadata: stable ID, canonical root path, display name, last-used Agent, creation time, and last-opened time.
- The selected directory is the sole source of truth for project resources. AgentEnv does not copy project configuration into its data root.
- Project Instructions, Skills, and MCP files remain project-owned. A Project may be a Git repository, but Git is not required.
- Profile and Target State remain Agent-global. Projects do not bind, select, or automatically Apply Profiles.
- Conversation association is derived from its canonical working directory. It is not another saved Project binding.
- Effective environment preview is derived from a fresh read of one selected Agent's real global resources plus its known project-local discovery paths. The preview is not persisted as authority.

### Core decision chain

```text
Core job -> manage the Agent environment of recurring working directories
Proposed simplification -> save only an Agent launch shortcut
Value lost if literal -> no project Instructions, Skills, or MCP management
Recommended boundary -> Project is a directory reference; resources stay in the directory

User intent -> inspect, edit, preview, or open one Project
Conditional branches -> missing path, unsupported Agent resource, conflict, stale file, launch unavailable
Persisted effects -> Project reference metadata or an explicitly reviewed project file mutation
Recovery -> per-operation backup, atomic write, verification, and visible restore path
```

### Non-goals

- No Profile-to-Project binding or automatic Profile Apply.
- No requirement that a Project be a Git repository.
- No project cloning, workspace synchronization, background indexing of arbitrary descendants, or project-wide file ownership.
- No management of model, account, credentials, permissions, plugins, hooks, or arbitrary Agent configuration.
- No claim to show inaccessible built-in prompts or undocumented load precedence.
- No Library symlink into a Project. Adding a Library Skill creates a portable project-owned copy.
- No copy of private Library metadata such as `.agentenv-skill.json` into a Project.

### Capability and support matrix

Each Target adapter declares inspection and mutation independently. `Inspect` never grants write authority, and a shared service never upgrades a partial adapter to full support. The first release deliberately keeps MCPs read-only until an adapter has a field-level mutation allowlist.

| Agent | Instructions inspect/edit | Skills inspect/add-remove | MCP inspect/edit | Effective preview | CLI launch |
|---|---|---|---|---|---|
| OpenCode | Supported / Supported | Supported / Supported | Partial names-only / Unsupported | Partial | Supported when enabled and installed |
| Claude Code | Supported / Supported | Supported / Supported | Partial names-only / Unsupported | Partial | Supported when enabled and installed |
| Codex | Supported / Supported | Supported / Supported | Unsupported / Unsupported | Partial | Supported when enabled and installed |
| Antigravity CLI | Supported / Supported | Partial / Unsupported | Unsupported / Unsupported | Partial | Supported when enabled and installed |
| Trae CLI | Partial / Supported files only | Supported / Supported | Partial names-only / Unsupported | Partial | Supported when enabled and installed |
| Pi | Supported / Supported | Supported / Supported | Unsupported / Unsupported | Partial | Supported when enabled and installed |

`Partial` means AgentEnv shows every included and excluded source and never labels the result complete.

### State and effect matrix

| State | Visible behavior | Executable actions | Durable effect | External effect |
|---|---|---|---|---|
| Idle | Stable Project list and selected detail | Add, select, inspect, edit, preview, open | None | None |
| Dirty | Edited bytes remain local to the editor | Save, Discard, Cancel navigation | None until Save commits | None |
| Working | Initiating control shows bounded progress | Cancel where cancellation is safe | None until commit | Read-only scan or staged write |
| Success | Affected row refreshes and scoped feedback appears | Continue working | Reference or verified file state persists | Explicit file mutation or Agent launch |
| Error | Error remains beside the command with diagnostic reference | Retry, inspect path, export report | Existing state preserved | No partial unverified write |
| Cancelled | Prior view and focus are restored | Retry | None | None |
| No-op | Reports that content already matches | Close | No write and no backup | None |
| Stale | Diff refreshes against the changed file | Review again | None | None |
| External change | Resource hash no longer matches the opened revision | Reload, compare, cancel | None | None |
| Partial | Unsupported or unreadable sources are named | Open path, retry, continue with honest scope | None | None |
| Persisted | Restart restores references and last-used Agent | Open or edit | Device-local metadata remains | Project files remain project-owned |
| Failed but restored | Commit failed and automatic restore verified | Inspect receipt, retry | Protected recovery receipt remains | Original bytes verified |
| Recovery required | Commit and automatic restore could not be verified | Open Recovery, export diagnostics | Protected state blocks overlapping writes only | Files are left untouched until explicit recovery |
| Return | Project, resource, tab, dialog, or app close encounters a dirty editor | Save and continue, Discard and continue, Cancel | Depends on explicit choice | No hidden write |
| Rollback | Recovery identifies exact files and operation | Preview restore, restore | Recovery receipt remains | Original bytes restored atomically |

### Shared primitives and rule owners

- Shell and navigation: `ProfileSidebar`, `useWorkspaceNavigation`.
- List-detail geometry: Profiles and Conversations split-view rules, without inheriting page-local CSS overrides.
- Header and commands: `PageHeader`, `Button`, `IconButton`, `ActionMenu`.
- Rows and metadata: `ResourceRow`, `Badge`, `OverflowTooltip`.
- Dialogs and focus: `ModalFrame`; dismissible read-only previews support Escape and safe outside click.
- Diff and file preview: `DiffWorkspaceDialog`, `SyntaxCodePreview`, file-tree primitives from the Skill browser.
- Progress and feedback: local button progress plus `AppFeedback` for cross-page outcomes.
- Terminal launch: the existing conversation terminal launcher after extracting a generic `AgentLaunchSpec`.

### Evidence registration

- Domain: Project store validation and migration, adapter path resolution, fresh effective preview, stale/no-op mutation, portable Skill copy, missing directory behavior.
- Renderer: list-detail selection, empty and missing states, resource tabs, supported/partial/unsupported presentation, local progress, split Open command, preview scope.
- Desktop: native directory picker, real terminal launch spec, restart persistence, safe remove-reference behavior, diagnostic failure.
- Persistence: `projects.json`, per-operation project recovery receipts, unchanged project bytes after cancelled or failed actions.
- Visual: empty, selected Project, partial preview, edit working state, minimum/default/large viewport, English/zh-CN/zh-TW.
- Packaged: command discovery and terminal opening must be verified from the packaged Electron process.

### Completion boundary

The feature is complete only when a user can add a directory, restart and retain it, inspect its actual resources, safely edit supported resources, preview one selected Agent's observable global plus project environment, launch an installed supported CLI in that directory, remove the reference without touching the directory, and recover every committed project-file mutation. Unsupported and partial capabilities must remain explicit.

## Information Architecture

`Projects` is a top-level Workspace destination because it owns a distinct repeated task. The navigation order is `Agents`, `Projects`, `Profiles`, `Conversations`, `Skills`, `Settings`.

The workspace uses a stable list-detail layout:

- The list shows only display name, selectable full path, and exceptional state such as missing directory.
- The detail header shows display name, path, `Preview environment`, and a split `Open` command whose primary action uses the last-used available Agent.
- Detail content uses peer views for `Instructions`, `Skills`, and `MCPs`. Each row names the real path and the Agents that consume it.
- Removing a Project removes only its reference. Destructive resource commands are always scoped to a named path.

Conversations keeps its existing history model. Its folder filter groups workspaces that resolve to
saved Projects separately from ordinary folders, and a selected matching Conversation offers
`Open Project`. Symlink aliases use the same canonical lookup as the Project store, so filtering and
navigation cannot disagree. No Conversation record is rewritten when a Project is added or removed.

## Effective Environment Preview

Preview is always Agent-specific. It performs a fresh read and separates sources instead of flattening them:

1. Project resources found from the selected launch directory using adapter-declared discovery rules.
2. Real Agent-global resources, including AgentEnv-managed and external resources.
3. Conflicts and duplicate runtime names.
4. Excluded or inaccessible surfaces that make the result partial.

Known precedence may be displayed only when the adapter can prove it. Otherwise the preview says `Load order unknown`. The active Profile may identify the source of AgentEnv-managed global resources, but no Project-to-Profile relationship is persisted.

## Mutation Contract

Project edits are direct edits to canonical project files, so they do not use Profile Apply. Every mutation follows:

```text
fresh read -> semantic diff -> explicit Save/Remove/Add -> backup -> atomic write
-> post-write verification -> recovery receipt
```

Text Save is disabled when bytes are unchanged. Remove and replace show the exact path and impact. Adding a Library Skill copies verified regular files into a target project Skill directory; links, escaping paths, metadata, and credentials are rejected. Existing project Skills remain project-owned and are not silently imported into Library.

### Project path authority

- A selected root may be a symlink, but AgentEnv persists and operates on its canonical target. A missing or replaced root becomes unavailable until the user re-adds it.
- Adapters declare bounded relative candidates. Discovery returns opaque resource IDs; the Renderer never supplies an absolute mutation path.
- Every mutation is bound to `{ projectId, agentId, resourceId, expectedHash }`. Immediately before backup and commit, Main re-resolves the Project ID, canonical root, relative declaration, parent chain, entry type, and expected hash.
- Child links, aliases, special files, case-folded duplicate destinations, escaping parents, and unexpected existing destinations are inspect-only. Portable Skill copies contain regular files and directories only.
- Mutations are serialized, and a `Recovery required` receipt blocks only another write to the same canonical path.

### Recovery and close behavior

- Every committed Project mutation records original path, original bytes or absence, post-write hash, Project ID, Agent ID, resource ID, and operation time in a private recovery receipt.
- Restore rechecks the current path and expected post-write hash. If the destination changed since the receipt, AgentEnv refuses to overwrite the newer bytes and requires another review.
- If the initial write fails, AgentEnv restores automatically and verifies the original hash. A failed restore becomes a persistent `Recovery required` item rather than a success or ordinary error.
- Project switching, resource switching, dialog dismissal, reference removal, workspace navigation, and app close all use the same Save / Discard / Cancel dirty-document guard.
- Removing a Project reference never removes project files or its protected recovery receipts.

### Privacy boundary

Effective preview exposes MCP names, source labels, and supported non-secret metadata only. Credential values, environment values, secret-like command arguments, and raw unsupported configuration never cross preload, diagnostics, logs, screenshots, or persisted preview state.

## Adapter Architecture

Project behavior becomes an optional Target capability rather than a Renderer switch on Agent IDs:

```ts
interface AgentProjectCapability {
  support: ProjectCapabilitySupport;
  declarations: ProjectResourceDeclarations;
  parseInstructions(input: ProjectParseInput): ProjectInstructionSummary[];
  parseMcpNames(input: ProjectParseInput): RedactedProjectMcpSummary[];
  createLaunchSpec(input: ProjectLaunchInput): AgentLaunchSpec | undefined;
}
```

Shared services own canonical path validation, bounded discovery composition, effective resolution, backup, atomic mutation, persistence, diagnostics, redaction, and terminal launch. Adapters own declarative documented relative candidates, parsers, consumer relationships, known precedence, and CLI arguments. Compare may consume the same declarations, but evaluation masks remain separate until equivalence is proven.

`Open in <Agent>` means AgentEnv handed an absolute executable, argument array, and canonical Project `cwd` to the configured terminal. It does not claim that the terminal or Agent later completed startup. `lastAgentId` changes only after a successful handoff. Disabled, missing, and newly unavailable Agents are excluded and explained inline.
