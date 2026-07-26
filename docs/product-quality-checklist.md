# AgentEnv Manager Product Quality Gate

This document is the project-level acceptance checklist for product behavior,
interaction consistency, desktop layout, and release evidence. It complements
[`product-contracts.md`](product-contracts.md):

- `product-contracts.md` defines what the product means and what persisted
  effects are allowed.
- This document defines how those contracts must appear, behave, and be proven
  across the complete desktop application.

A change is not complete merely because the reported screenshot looks better or
an E2E selector can click the new control. Every applicable invariant below must
hold across sibling surfaces, supported states, languages, window sizes, and the
rebuilt desktop artifact.

## 1. Product Read

AgentEnv Manager is a local-first macOS desktop tool for technical users who
need to understand, organize, and safely apply reusable Agent environments.

The core job is:

> Know what AgentEnv manages, understand what will change, and safely keep the
> intended Instructions, Skills, and supported MCP activation choices in effect
> across local Agents.

Quality constraints:

| Dimension | Rating | Consequence |
| --- | ---: | --- |
| Operation risk | 8 / 10 | Mutations require preview, verification, and recovery. |
| Task frequency | 6 / 10 | Common inspection and local edits must remain fast. |
| Information density | 8 / 10 | Lists need stable columns and restrained emphasis. |
| Visual expression | 3 / 10 | Platform fit and clarity outrank decoration. |
| Motion intensity | 2 / 10 | Motion is limited to feedback and continuity. |

Avoid:

- Lifecycle jargon presented as user commands.
- Status text that is actually an action.
- Multiple visual systems for sibling resource views.
- Decorative icon tiles, badges, borders, and filled buttons on routine data.
- Content-sized columns in repeated rows.
- Page-level scrolling or horizontal scrolling at supported window sizes.
- Explanatory prose used to compensate for ambiguous labels or hierarchy.
- Passing tests that preserve a current workaround rather than the product
  contract.

## 2. Release Verdict

Use one verdict for every audit or release:

- **Block:** A destructive or external mutation is ambiguous, a visible command
  appears inert, text overlaps a control, required content is unreachable, the
  packaged app behaves differently from the tested artifact, or persisted
  effects and recovery have not been verified.
- **Needs refinement:** Workflows complete, but visual hierarchy, cross-view
  consistency, state coverage, localization, native behavior, or evidence is
  incomplete.
- **Approve:** The applicable product contract, interaction states, visual
  invariants, persisted effects, and packaged-runtime checks all pass.

## 3. Hard Blockers

- [ ] No page-level horizontal scrolling at `1180 x 760` or `920 x 620`.
- [ ] No text overlaps, clipped button labels, cropped status pills, or
  inaccessible controls.
- [ ] No visible primary command can complete without local progress and an
  explicit result.
- [ ] No status cell uses a command label in place of the current state.
- [ ] No same-named command has different persisted effects in another view.
- [ ] No popover, tooltip, or context menu is clipped by a row or scroll
  container.
- [ ] No mutation proceeds from stale preview data or skips required backup,
  verification, and recovery.
- [ ] No semantic no-op reports replacement or writes files.
- [ ] No refresh, navigation, or background enrichment flashes a false empty
  page.
- [ ] No release claim uses stale renderer or Electron build output.

## 4. Skills Library P0 Contract

### 4.1 Peer projections

`Skill list` and `By source` are two projections of one Skill Library. They are
not separate products and must share:

- Page header and mode-tab geometry.
- Search, Filters, update checking, and feedback primitives.
- Type scale, row density, icon rules, status vocabulary, action hierarchy, and
  overflow behavior.
- The same command label for the same user intent.
- The same detail, popover, context-menu, and loading behavior.

The projections may expose different facts, but every fact must occupy the same
semantic role:

```text
Identity -> supporting metadata -> status fact -> current action -> more actions
```

### 4.2 Skill list columns

The authoritative reading order is:

```text
Skill | Source | Usage | Status | Action | More
```

- [ ] Header and body rows use one shared column definition.
- [ ] `Skill` owns icon, name, one-line description, and compact version detail.
- [ ] `Source` owns source type, source name or path, and source branch or
  revision where relevant.
- [ ] `Usage` uses two fixed text lanes: `Profiles <count>` and
  `Agents <count>`.
- [ ] Usage does not use a generic people icon to represent Profiles.
- [ ] If icons are retained, Profile and Agent each use a distinct icon in the
  same fixed icon slot; otherwise both lines use no icon.
- [ ] Usage labels align with each other and count values align with each other.
- [ ] `Status` contains only a state fact and optional detail.
- [ ] `Action` contains at most one currently executable workflow command.
- [ ] Rows without an action retain the action lane so neighboring rows align.
- [ ] `More` contains secondary, rare, and destructive commands.

### 4.3 Source list columns

The authoritative reading order is:

```text
Source | Skills | Last checked | Status | Action | More
```

- [ ] Rows use fixed lanes rather than content-sized counters and buttons.
- [ ] `Skills` distinguishes total inventory from updates without floating
  badges.
- [ ] `Last checked` is a fact and never doubles as update state.
- [ ] `Status` uses the same update vocabulary as Skill list.
- [ ] `Action` aligns with the Skill list action lane and uses the same control
  primitive.
- [ ] The source row supports the same context-menu and More-menu commands.

### 4.4 Status and action vocabulary

Allowed status labels include:

- `Up to date`
- `Update available`
- `Checking`
- `Not checked`
- `Check failed`
- `Monitoring off`
- `Disabled`
- `Needs sync`
- `Source unavailable`

Allowed current actions include:

- `Review update`
- `Retry check`
- `Sync installs`
- `Resolve conflict`

Rules:

- [ ] `Review` alone is never used.
- [ ] `Check monitored` is not a user-facing command.
- [ ] Both projections use `Check for updates`.
- [ ] The current tab or filter explains scope; the command name does not change
  with scope.
- [ ] Working state replaces or disables the triggering command without moving
  adjacent controls.
- [ ] Completion reports checked, updated, unchanged, skipped, and failed
  counts as applicable.

### 4.5 Filters

- [ ] Both projections use one FilterBar and one filter-panel primitive.
- [ ] Search, Filters, Refresh, and Check for updates retain the same order.
- [ ] Input, select, and button heights match.
- [ ] Field labels use the same typography and spacing.
- [ ] Reset occupies the same location and is disabled when nothing can reset.
- [ ] Applying or clearing filters does not move the page header or toolbar.
- [ ] Filter state survives details, dialogs, and peer-view navigation where it
  remains meaningful.
- [ ] A filtered-empty result is visually distinct from an empty Library.

## 5. Cross-Application Product Checklist

### 5.1 Objects, ownership, and counts

- [ ] Profile, Skill, Source, Agent, MCP, Conversation, and Backup have one
  canonical user-facing name.
- [ ] Every object declares its source of truth and any managed deployment.
- [ ] Managed, external, disabled, missing, conflict, and unavailable remain
  distinct states.
- [ ] Detach, remove from Profile, disable, and delete permanently are distinct
  effects and verbs.
- [ ] Counts name their unit and scope.
- [ ] Total, enabled, selected, Profile-referenced, and Agent-installed counts
  are not interchanged.
- [ ] Global state is not presented as Profile-local, and Target state is not
  presented as global.

### 5.2 Navigation and stable shell

- [ ] Sidebar width, icon slot, label origin, selected background, and section
  spacing remain identical across destinations.
- [ ] Navigation labels are vertically centered inside the selected surface.
- [ ] Switching destinations does not change content origin, base font size, or
  control scale.
- [ ] The title bar has a complete drag region without swallowing controls.
- [ ] Interactive elements are marked as no-drag.
- [ ] The app paints a stable shell immediately during startup.
- [ ] The sidebar status card does not wrap routine labels or distort `+N`
  counters.
- [ ] Clean close is prompt and does not wait for optional scans or network work.

### 5.3 Page headers and toolbars

- [ ] Comparable pages share title origin, title size, supporting-copy spacing,
  toolbar height, and top inset.
- [ ] Only one ordinary primary command receives a filled accent treatment.
- [ ] Page-level commands remain near the page title or current object.
- [ ] Object-level Save and Apply controls remain adjacent.
- [ ] More menus contain secondary actions and do not compete with the primary
  command.
- [ ] Supporting copy is removed when labels and hierarchy already explain the
  page.
- [ ] Necessary explanation uses contextual information help rather than
  permanent prose.

### 5.4 Repeated rows and tables

- [ ] Every repeated row type has a documented column contract.
- [ ] Header and body share one CSS grid or table definition.
- [ ] Primary and secondary text have fixed line heights and stable baselines.
- [ ] Primary and secondary lines within one cell start at the intended shared
  origin.
- [ ] Repeated rows do not size columns from individual content.
- [ ] Numeric values align consistently.
- [ ] Status labels align consistently.
- [ ] Action controls align consistently.
- [ ] Rows with missing metadata reserve intentional geometry or use a defined
  compact alternative.
- [ ] Selection, hover, focus, disabled, loading, error, and update states do
  not change row dimensions.
- [ ] Selecting a Profile or Skill never reorders it or moves its name.
- [ ] Zero, one, and many-item expansions use content-sized bodies without
  artificial empty height.

### 5.5 Icons

- [ ] One icon family supplies navigation, object, command, and status icons.
- [ ] Each semantic object uses an appropriate and stable icon.
- [ ] Object icon containers use one fixed box and optical size.
- [ ] Toolbar and row-command icons remain unboxed unless a platform convention
  requires a surface.
- [ ] Hover backgrounds are centered and equal on all sides.
- [ ] Hover does not remove an existing background unexpectedly.
- [ ] Source favicon failure has a deterministic fallback.
- [ ] Icon selection does not shift object text.
- [ ] App, Dock, mounted volume, and Finder icons have transparent corners and
  no unintended border.

### 5.6 Typography and long content

- [ ] The type scale has explicit roles for page title, section title, object
  title, body, metadata, label, and status.
- [ ] Routine metadata does not use bold weight.
- [ ] Dense rows reserve bold only for the object identity.
- [ ] Descriptions display at most one line where specified.
- [ ] Long names, paths, URLs, hashes, errors, and translated labels have a
  selectable full-value surface.
- [ ] Tooltips intended only as hints remain brief and non-interactive.
- [ ] Detail popovers intended for copying remain pointer-enterable and
  selectable.
- [ ] Truncation never hides the difference between two commands or states.
- [ ] Status pills are shortened semantically rather than clipped.

### 5.7 Status, badges, and emphasis

- [ ] A status reports what is true now.
- [ ] An action reports what the user can do next.
- [ ] A process state reports what is happening now.
- [ ] Routine source, version, owner, and count metadata uses plain text.
- [ ] Badges are reserved for compact exceptional or actionable states.
- [ ] Disabled objects use a clearly distinguishable but readable row treatment.
- [ ] Disabled Skills appear only in `All` and `Disabled` scopes.
- [ ] Semantic colors preserve one meaning throughout the app.
- [ ] Blue indicates the current primary commitment, not arbitrary
  availability.
- [ ] Warning and error emphasis is proportional to required user action.

### 5.8 Commands and action topology

- [ ] Every visible command names an object or predictable result.
- [ ] Every repeated row exposes at most one current workflow action.
- [ ] Secondary and destructive commands live in More and context menus.
- [ ] Context menu and More menu expose the same applicable commands in the same
  order.
- [ ] Adjacent identical icons never perform different actions.
- [ ] Disclosure, selection, edit, policy, and More have separate click zones.
- [ ] Row click behavior is consistent across Skill, Source, Profile, Agent, and
  Conversation rows.
- [ ] Disabled commands expose a concise reason.
- [ ] Destructive actions name the object and consequence.
- [ ] Bulk actions report affected and skipped counts.

### 5.9 Inputs, filters, tabs, and binary state

- [ ] Buttons, icon buttons, inputs, selects, segmented controls, and switches
  use shared sizes and focus rings.
- [ ] Binary state uses a switch or checkbox; mutually exclusive policies use a
  segmented control or select.
- [ ] Labels remain visible and placeholders are examples only.
- [ ] Tabs represent peer views and retain stable geometry when counts change.
- [ ] Count badges do not resize a tab unexpectedly.
- [ ] Search scope is clear from the current view and placeholder.
- [ ] Clearing search or filters preserves the current view and selection where
  possible.
- [ ] Option labels changing length do not move the control itself.

### 5.10 Popovers, menus, tooltips, and dialogs

- [ ] Floating layers render in an overlay root outside clipping ancestors.
- [ ] First, middle, and last row placements are tested.
- [ ] Window-edge and nested-scroll placements are tested.
- [ ] Popovers remain anchored to their trigger when the list scrolls.
- [ ] Escape and safe outside click close dismissible layers.
- [ ] Pointer interaction inside a detail popover does not dismiss the parent
  dialog or click through to content behind it.
- [ ] Closing restores focus.
- [ ] Only one peer menu is open.
- [ ] Dialog title, body, alert, and action regions use shared geometry.
- [ ] Dialog buttons never touch the border or wrap.
- [ ] Long dialog sections start at the top rather than vertically centering
  against a taller sibling.
- [ ] Scrollable dialog content makes continuation visually obvious.

### 5.11 Feedback and asynchronous work

- [ ] Every command defines Idle, Pressed, Working, Success, Warning, and Error
  behavior as applicable.
- [ ] Pressed feedback is immediate.
- [ ] Work beyond perceptual immediacy shows local progress.
- [ ] The triggering control prevents duplicate submissions while working.
- [ ] Local commands update the affected row or section before relying on global
  feedback.
- [ ] Cross-page and background work uses the shared global feedback region.
- [ ] Success feedback expires after about five seconds.
- [ ] Errors persist until dismissed and their text can be selected.
- [ ] Partial success names what succeeded, failed, and can be retried.
- [ ] Completion updates the visible object and persisted state.
- [ ] Refresh and enrichment retain last-good data.
- [ ] Slow remote enrichment never blocks local navigation or clean shutdown.

### 5.12 Save, Apply, and dirty state

- [ ] Profile modifications make Save visibly primary and disable Apply.
- [ ] Saving shows local working feedback until persistence completes.
- [ ] After Save, Save is disabled and Apply becomes available only when the
  selected Agent differs.
- [ ] The action label remains `Apply`; the selected Agent provides scope.
- [ ] Navigation with unsaved changes offers Discard, Cancel, and Save and
  continue without cramped geometry.
- [ ] Apply preview includes Instructions, Skills, MCP activation, links,
  copies, removals, preserved files, blocked items, and warnings.
- [ ] Apply sections align at the top and expose all changes.
- [ ] No-change Apply is disabled or produces an explicit no-op without writing.
- [ ] Apply progress, verification, result, and recovery remain visible.
- [ ] Profile list application indicators match verified Agent state.

### 5.13 Filesystem and external-state safety

- [ ] Every external mutation follows fresh read, semantic preview, backup,
  atomic write, verification, and recovery.
- [ ] Canonical Library data, deployed copies, aliases, symlinks, shared roots,
  unmanaged files, caches, and backups are distinguished.
- [ ] Broken and cyclic symlinks cannot make an unrelated operation fail.
- [ ] Deletion resolves only the selected object's owned paths.
- [ ] Duplicate-name import compares name, source, version, hash, modification
  time, and readable `SKILL.md` differences.
- [ ] Existing external files are never deleted merely because a Profile omits
  them.
- [ ] Drift is checked immediately before Apply.
- [ ] Malformed unrelated backup or neighboring data does not prevent safe
  inspection or deletion of another object.
- [ ] Credentials never enter Profile data, Library metadata, backups, logs,
  renderer payloads, or diagnostics.
- [ ] Rollback restores all successfully changed owned resources after a later
  failure.

### 5.14 Performance and native runtime

- [ ] Startup renders shell and local cached data before optional discovery.
- [ ] Navigation is not blocked by Agent scans, Git checks, hashing, or remote
  authentication.
- [ ] Local Profile edits update in memory and rerender only the affected
  region.
- [ ] Save avoids rescanning unrelated Agents and resources.
- [ ] Preview reuses valid normalized state while fresh-reading external paths
  required for safety.
- [ ] Quit does not wait for optional polling or background enrichment.
- [ ] Packaged Agent discovery accounts for GUI `PATH` differences.
- [ ] System Git, SSH Agent, credential helper, Keychain, locale, permissions,
  and native file pickers are tested from the packaged process.
- [ ] GitHub device-flow polling respects server intervals and slow-down
  responses while allowing recovery.

### 5.15 Localization, keyboard, and accessibility

- [ ] `en`, `zh_CN`, and `zh_TW` use complete, equivalent vocabulary.
- [ ] Translation changes do not alter command meaning.
- [ ] Default, minimum, and large windows fit every language.
- [ ] Keyboard focus order follows visual order.
- [ ] Focus is visible on every interactive control.
- [ ] Menus, tabs, segmented controls, switches, and dialogs support expected
  keyboard behavior.
- [ ] Color is never the only status signal.
- [ ] Accessible names match visible command meaning.
- [ ] Text enlargement does not hide commands or overlap content.
- [ ] Progress updates do not steal focus.

## 6. Page-Specific Gates

### 6.1 Skills

- [ ] Skill list and By source satisfy the P0 projection contract.
- [ ] Import local folder opens a native folder picker.
- [ ] Repository import honors a supplied subtree and previews discovered Skills
  before import.
- [ ] HTTPS authentication failure can offer a safe system-Git SSH fallback
  without storing credentials.
- [ ] Per-item import progress animates and failures expose selectable reasons.
- [ ] Duplicate import comparison supports replace or keep separately.
- [ ] Local imports default to manual update policy.
- [ ] Tracked sources may opt out of update checking without being described as
  temporarily paused.
- [ ] Update checking reports no update, available update, skipped, and failure.
- [ ] Global disable keeps a Skill in Library while removing it from Profile
  selection and update scopes.
- [ ] Deleting an unreferenced Skill reports the correct deleted count.
- [ ] Local Skill Cleanup shows only cleanup responsibilities, not unrelated
  Library maintenance.
- [ ] Auto-manage distinguishes automatic, decision-required, ignored, managed,
  and externally retained outcomes.

### 6.2 Profiles

- [ ] Profile rows preserve creation ordering during selection.
- [ ] Icon, name, description, resource summary, and application state align for
  short and long names.
- [ ] Composer resource rows share one trigger height and one policy lane.
- [ ] Instructions, Skills, and MCPs expose `Use Profile`, `Turn off`, and
  `Keep current` consistently where supported.
- [ ] Expanding one resource does not resize sibling triggers.
- [ ] Zero and one-item editors fit content without empty vertical space.
- [ ] Skill rows show path, version, enabled state, and effective Agent result.
- [ ] Resource counts communicate enabled and total recipe content.
- [ ] Save and Apply follow the authoritative state machine.
- [ ] Create from Agent captures readable resources, warns on broken links, and
  does not fail the entire Profile for safely ignorable unavailable Skills.

### 6.3 Agents

- [ ] Installed detection distinguishes command availability from directory
  existence.
- [ ] GUI process discovery works for packaged macOS installations.
- [ ] Agent rows use one list geometry and diagnostics expand independently.
- [ ] Capture, Profile, diagnostics, recovery, and More have distinct hierarchy.
- [ ] Capture preview shows ignored, imported, externally retained, broken, and
  unsupported resources.
- [ ] Recovery lives behind a clear command and is not an oversized default
  section.
- [ ] CLI and IDE variants are modeled through adapter capabilities without
  exposing adapter-specific complexity in ordinary workflows.

### 6.4 MCP activation

- [ ] Agent definitions, credentials, and installation remain Agent-owned.
- [ ] `Keep current` performs no MCP read, diff, backup, write, or ownership
  claim.
- [ ] Managed choices mutate only allowlisted activation fields.
- [ ] Missing managed `On` entries explain setup requirements.
- [ ] Missing managed `Off` entries are no-ops.
- [ ] Agent-controlled targets remain read-only without pretending activation
  succeeded.
- [ ] MCP rows use compact content-sized layout and stable policy controls.

### 6.5 Conversations

- [ ] Indexing remains read-only and keeps the last-good result after parser or
  source failure.
- [ ] Source Agent, date, title, summary, and searchable content have clear
  provenance.
- [ ] Search and filters do not imply unavailable transcript coverage.
- [ ] Open original and Continue are distinct commands with predictable scope.
- [ ] Handoff preview exposes included content, exclusions, size limits, and
  destination.
- [ ] Temporary handoff files and clipboard fallback are visible and safely
  cleaned up.

### 6.6 Settings

- [ ] Appearance, GitHub, updates, Workspace Sync, and storage settings use one
  preference-row geometry.
- [ ] Inputs, buttons, selects, and switches align within each section.
- [ ] GitHub sign-in appears next to GitHub-dependent capabilities.
- [ ] Device code is selectable and has a clear Copy command.
- [ ] Successful authorization updates the visible account without requiring
  manual navigation.
- [ ] Rate-limit failures link to GitHub sign-in when no account is connected.
- [ ] Auto-check controls identify what is checked, how often, and whether they
  are active without moving the switch.

## 7. Required Test Matrix

### 7.1 Window sizes

| Name | Size | Required result |
| --- | --- | --- |
| Minimum | `920 x 620` | No horizontal page scroll or overlap. |
| Default | `1180 x 760` | Complete ordinary workflow without resizing. |
| Large | `1440 x 900` | Density remains intentional; content does not stretch arbitrarily. |

### 7.2 Languages

- English
- Simplified Chinese
- Traditional Chinese

### 7.3 Data stress set

- Empty Library and filtered-empty Library.
- One Skill and one Source.
- Eight mixed Skills in normal, update, disabled, error, and untracked states.
- Fifty, one hundred, and five hundred rows.
- Long English name, long CJK name, long source URL, long local path, long hash,
  long error, and three-digit counts.
- First, middle, and last row with menu, tooltip, context menu, and detail
  popover open.

### 7.4 State pairs

- Unselected / selected.
- Collapsed / expanded with zero, one, and many children.
- Idle / checking.
- No update / update available.
- Enabled / disabled.
- Clean / dirty.
- Saving / saved.
- No changes / Apply available.
- Preview closed / preview open.
- Applying / success / partial failure / blocked.
- Agent-managed / AgentEnv-managed / drifted.
- Short text / long text / translated text.

## 8. Evidence Ladder

Every completion claim names the highest verified layer:

1. **Domain:** normalized state, command semantics, no-op, conflicts, and
   persisted-effect tests.
2. **Renderer:** components, keyboard interaction, labels, local progress, and
   state transitions.
3. **Geometry:** computed origins, lane alignment, dimensions, overflow,
   clipping, and movement.
4. **Pixels:** same-state screenshots reviewed for hierarchy, optical centering,
   rhythm, whitespace, and discoverability.
5. **Desktop process:** real Electron IPC, menus, pickers, focus, navigation,
   startup, refresh, and shutdown.
6. **Persistence:** actual isolated filesystem effects, backup, verification,
   drift, rollback, and no-op.
7. **Packaged app:** GUI environment discovery, icon, DMG, permissions,
   credentials, first launch, close, and release hash.

Selectors and accessibility names prove reachability. Geometry proves
containment. Pixels prove visual clarity. Persisted inspection proves behavior.
None substitutes for the others.

## 9. Required Audit Procedure

1. Identify the owning layer: product contract, primitive, shell, page,
   overlay, adapter, or runtime.
2. Classify the defect: semantics, geometry, action, feedback, overlay,
   localization, state, performance, persistence, or native runtime.
3. List every sibling surface using the same object, primitive, or command.
4. Record the relevant state pairs, languages, viewports, and stress data.
5. Remove obsolete rules before adding replacements.
6. Rebuild the renderer or Electron artifact.
7. Run the smallest high-signal invariant test immediately.
8. Capture equal-state screenshots and perform a cold read without tooltips,
   selectors, or implementation knowledge.
9. Run the complete applicable suite.
10. Verify the persisted result or packaged runtime when the change touches
    either.
11. Update the product contract or this checklist when the defect reveals a
    missing invariant.

## 10. Change-to-Evidence Map

Complete this before changing a shared primitive, shell, resource row, overlay,
or feedback component:

```text
Change:
Owning layer:
User-visible invariant:
Persisted invariant:
Sibling surfaces:
State pairs:
Languages:
Window sizes:
Stress data:
Domain tests:
Renderer tests:
Geometry assertions:
Pixel captures:
Desktop-process E2E:
Persisted-effect checks:
Packaged smoke:
Known exclusions:
```

## 11. Completion Evidence Receipt

Attach this to a substantial UI, workflow, or release change:

```text
Source revision:
Build artifact:
Product contract checked:
Quality checklist sections checked:
High-signal tests:
Full applicable suite:
Default/minimum/large window results:
Languages checked:
State pairs checked:
Sibling surfaces checked:
Visual captures:
Desktop-process checks:
Persisted-effect checks:
Packaged-app checks:
Known gaps:
Verdict: Block | Needs refinement | Approve
```
