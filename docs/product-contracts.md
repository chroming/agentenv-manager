# AgentEnv Manager Product Contract

Date: 2026-07-12  
Status: Authoritative product contract  
Audience: Product, design, engineering, QA, and target-adapter contributors

## 1. Purpose

AgentEnv Manager is a local-first desktop application for cleaning reusable agent resources, composing them into Profiles, and safely deploying a complete Profile to local agent tools.

The product succeeds when a user can answer all of these questions without inspecting implementation files:

1. Which resources are canonical and reusable?
2. What does this Profile contain?
3. Which Agent will receive it?
4. What exactly will be added, replaced, removed, or preserved?
5. Is the deployed Agent still identical to the saved Profile?
6. How can the user recover or stop AgentEnv management?

User-facing product language uses **Agent** for a local coding tool such as OpenCode, Codex,
Claude Code, Antigravity, or Trae CLI. The implementation keeps `Target`, `TargetAdapter`, and `targetId` as stable internal
architecture terms. Internal names MUST NOT leak into navigation, commands, status, confirmation,
or recovery copy.

This document defines the behavior those answers require. Existing code and tests must conform to this contract. A feature is not complete merely because its happy-path control works.

## 2. Product Read

- Primary user: a developer who uses multiple local coding agents and wants reliable, reusable environments.
- Core job: clean local resources, compose an environment once, and safely deploy or switch it across supported Targets.
- Platform: local macOS desktop application, with filesystem and CLI integration.
- Primary constraint: operations modify files used by other tools, so ownership, preview, atomicity, drift detection, and recovery matter more than visual novelty.

Product ratings:

| Dimension | Rating | Consequence |
| --- | ---: | --- |
| Operation risk | 8/10 | Every destructive deployment requires impact preview and recovery. |
| Task frequency | 6/10 | Common checks and switches should remain compact. |
| Information density | 7/10 | Lists must scan well without hiding lifecycle state. |
| Visual expression | 3/10 | Use a restrained operational desktop language. |
| Motion intensity | 2/10 | Motion is limited to feedback and spatial continuity. |

Avoid:

- Treating Target file layouts as the user's primary mental model.
- Implying that a Profile can only be used by its preferred or created-from Target.
- Silent writes, ambiguous replacement, and success-only feedback.
- Destructive actions without affected-object counts or recovery.
- Inferring major lifecycle states from unrelated counters or prose.
- Adding a new Target through conditionals spread across the application.

## 3. Normative Language And Implementation Status

The words MUST, MUST NOT, SHOULD, and MAY are normative.

Feature status is recorded separately:

- `Implemented`: current production behavior is covered by automated tests.
- `Partial`: part of the contract exists, but an important path or state is missing.
- `Required`: normative behavior that still needs implementation before production approval.

Status annotations do not weaken the contract. They expose implementation gaps instead of redefining incomplete behavior as correct.

## 4. Core Objects And Ownership

### 4.1 Library

The Library is global to AgentEnv Manager and contains canonical reusable Skills.

- Skill Library owns canonical Skill content and update metadata.
- Library content MUST NOT be duplicated into every Profile.
- A Profile stores references to Library Skills, not private copies of them.
- In Copy mode, updating the Library MUST NOT silently deploy changes to a Target.
- Live link is the default deployment policy: Library updates immediately affect linked Target Skills and therefore do not provide an Apply-gated snapshot. Copy remains available when Apply-gated snapshots are preferred.

Source of truth: `~/.config/agentenv-manager` or the configured AgentEnv data root.

### 4.2 Shared Runtime Locations

`~/.agents/skills` and other cross-tool compatibility paths MAY be consumed by more than one Target. They are migration sources, not canonical Library storage or AgentEnv's default deployment destination.

- Canonical Skill content MUST remain under AgentEnv data.
- Apply normally deploys Skills to the selected Target's dedicated managed directory. While an equivalent shared compatibility copy is active, Apply MUST record that Target's current `install` or `omit` intent without creating a duplicate dedicated copy.
- Applying an OpenCode Profile MUST NOT change Codex or Claude Code Skill directories, and equivalent isolation applies to every Target pair.
- Compatibility copies MAY be captured into a Profile, but MUST remain in place while any installed consumer lacks a current prepared Profile intent.
- Importing a compatibility copy creates an independent Library copy and MUST NOT replace, link, or remove the compatibility location.
- An exact Target-specific copy that already existed beside a compatibility copy MAY be adopted during first Take over only when its current canonical Skill hash matches the current Library hash. Adoption is previewed, backed up, verified again immediately before replacement, and MUST remain a no-op on the next Preview while shared migration is still pending.
- A compatibility copy is switched only through an explicit Scan local migration action after every installed consumer Target has applied a current preparation; Capture never removes it as a side effect.
- Completing migration MUST create one restorable backup for the shared paths, every affected Target path, and every affected Target state. It removes the shared paths first, deploys or omits the Skill according to each prepared Profile, verifies the result, and restores the whole transaction on any failure.
- AgentEnv MUST NOT edit per-Agent configuration to suppress duplicate discovery during this migration.
- `Keep shared copy` is a path-scoped decision. It MUST NOT ignore or alter same-name copies in Target-specific directories.
- A compatibility copy with conflicting content blocks automatic consolidation.
- External manager metadata, including Skills CLI lock files, is read-only evidence. AgentEnv MUST NOT silently edit or delete another manager's lock data.
- Importing an externally managed Skill creates an independent Library copy and MUST NOT imply that AgentEnv has taken ownership of the external installation.
- A Target-specific Skills root MAY itself be a symbolic link to a shared or external directory. Capture MAY read that linked content, but Apply MUST treat the root link as one filesystem boundary: Preview names the link and resolved destination, Apply backs up and atomically replaces only the root link with a real Target-owned directory before installing child resources, and the linked destination remains untouched.
- A broken, cyclic, or non-directory Target Skills root link blocks Apply with remediation. Rollback after root isolation MUST restore the exact original link and remove only the Target-owned directory created by AgentEnv.

### 4.3 Profile

A Profile is a saved environment recipe. It owns:

- Instructions.
- References to Library Skills, each with an install name and enabled state.
- An independent MCP policy for each Target: `Leave unchanged` or a sparse set of `On` and `Off` choices for MCP servers already defined by that Agent.

A Profile MAY record a preferred Target for default UI context and the Target it was created from for provenance. Neither field binds deployment: the same Profile MAY be applied to every compatible Target, and each Target still has at most one active Profile.

Create from Target MAY record a machine-local Capture receipt containing source paths, location roles, and content hashes. The receipt is optional takeover evidence, lives outside portable AgentEnv data, is never part of the Profile or data backup, cannot authorize content that differs from the current Library hash, and is consumed after the first successful Apply to that Target. Missing or malformed receipt data falls back to current content and ownership validation.

Source of truth: the saved Profile directory in AgentEnv data.

A v2 Profile directory contains exactly `profile.json`, `INSTRUCTIONS.md`, and `resources.json`. It MUST NOT store arbitrary native configuration, credentials, private Skill copies, Agent definitions, hooks, environment variables, or disabled-path lists.

Profile name, description, and icon are identity metadata rather than environment payload. Editing
them MUST persist immediately and independently without saving a dirty Instructions, Skills, MCP activation,
or resource draft, changing deployment readiness, or writing any Target. Environment content keeps
the explicit whole-Profile Save contract below.

Each Library Skill reference has a Profile-scoped enabled state. Missing legacy state means enabled.

- Turning a Skill off MUST preserve the reference and its Library content; it removes the Skill only from that Profile's effective payload.
- Turning a Skill back on MUST restore the same reference without another Library import or picker flow.
- A disabled Skill MUST NOT be deployed, validated as a desired Target resource, counted as an effective resource, or recorded in applied Library versions.
- Enable and disable are Profile edits: they become durable on Save and affect a Target only after Preview and Apply.
- An enabled reference whose Library Skill is missing blocks Apply. A disabled missing reference remains visible for repair but is an effective no-op.
- Disabling a Skill removes only an AgentEnv-owned deployment. If an active same-name copy is outside AgentEnv ownership, Preview blocks instead of pretending it can turn that copy off.

Each Target MCP policy follows these rules:

- `Leave unchanged` means Apply MUST NOT inspect, parse, hash, diff, back up, write, or retain ownership of that Target's MCP configuration. Retained inactive selections are editor convenience only and MUST NOT affect the Target-specific Profile hash.
- `Managed by Profile` is sparse. A connection absent from the selections remains Agent-owned.
- `On` plus an existing native definition updates only the adapter's verified activation field. `On` plus a missing definition blocks Apply and tells the user to configure it in the Agent or turn it Off.
- `Off` plus an existing native definition updates only the verified activation field. `Off` plus a missing definition is a no-op.
- A Target without a verified activation mechanism is Agent-controlled. Its Profile policy MUST remain `Leave unchanged`, and Apply MUST NOT write its MCP configuration.

### 4.4 Agent (internal Target)

An Agent is a supported local coding tool and its deployment locations. OpenCode, Codex, Claude Code, Antigravity, and Trae CLI are Agents.

- Target files are deployed copies, links, or serialized output.
- Target files are never the canonical Library source.
- A Target can have at most one active Profile at a time.
- One Profile can be active on multiple Targets simultaneously.
- A Target can be modified by AgentEnv Manager, the agent itself, or another local process.

### 4.4.1 Enabled Agent Scope

Settings owns the explicit set of enabled Agents.

- Existing installations without an Agent scope MUST migrate with every currently supported Agent enabled.
- Once the scope is persisted, a newly added adapter MUST remain off until the user enables it.
- Turning an Agent off MUST remove it from navigation, status summaries, Profile destination choices, discovery results, lifecycle scans, Capture, Apply, rollback, stop-management, and Agent-specific Skill scans.
- Every write or recovery entry point MUST re-check the enabled scope in the main process. Hiding a renderer control is not sufficient authorization.
- Turning an Agent off MUST NOT edit or delete its files, deployment state, Profiles, Library resources, or Backups, and MUST NOT end an existing management relationship.
- Turning off a managed Agent requires an impact confirmation. An Agent in `Recovery required` cannot be turned off through the UI until recovery is resolved.
- Turning an Agent on MUST run fresh installation and lifecycle discovery before restoring operational controls.
- An enabled Agent remains visible when its installation is not detected. Configuration directories alone do not make an Agent installed.
- Installation detection MUST use adapter-declared authoritative evidence. A command, desktop application, or another verified platform installation marker MAY establish installation; stale configuration files MUST NOT.
- Installation probes MUST be platform-aware and testable without reading the developer's real machine. A macOS application probe MUST NOT prevent the same adapter from using command or platform-native evidence on Windows and Linux.
- Shared Library data and global compatibility locations remain global concerns; disabling one Agent MUST only remove that Agent's identity and dedicated paths from consideration.

Status: explicit persisted scope, discovery filtering, renderer filtering, operation guards, managed-Agent confirmation, and recovery lock are `Implemented`.

### 4.5 Backup

A Backup is an immutable pre-operation snapshot used for recovery.

- Backup belongs to one operation and records its Profile and Target when applicable.
- Backup is not a Profile and MUST NOT silently become canonical content.
- A no-op MUST NOT create a Backup.
- A complete user-selected copy stored outside AgentEnv data is a Data Export, not a managed recovery Backup, and MUST NOT be removed by automatic retention.

### 4.6 Deployment State

Deployment State records AgentEnv ownership and the exact Profile and Library versions applied to a Target.

It MUST include enough information to distinguish:

- The active Profile.
- The Target-specific Profile hash.
- Referenced Library resource versions.
- Managed paths and their applied hashes.
- Last successful application time.

## 5. Identity Rules

### 5.1 Profile Identity

- Profile ID is stable and unique inside AgentEnv data.
- Renaming a Profile changes its display name, not its ID.
- Duplicating a Profile creates a new ID and no deployment relationship.

### 5.2 Library Skill Identity

- Library Skill ID is the canonical identity used by Profile references.
- Display name, folder name, GitHub repository, and content hash are attributes, not identity.
- Two locations with the same Skill ID but different content form a conflict group.
- Different IDs with identical content are potential duplicates and MUST be shown as such without being merged automatically.
- Import MUST NOT silently overwrite an existing Library ID with different content.

### 5.3 Native MCP Identity

- An MCP connection is identified by stable Target ID plus the name in that Target's native configuration.
- Definitions, commands, URLs, authentication, credentials, and installation lifecycle remain Agent-owned.
- A Profile MUST NOT copy one Target's MCP definition to another Target.
- A Profile selection is three-state: missing means `Use Agent setting`, `enabled: true` means `On`, and `enabled: false` means `Off`.
- Returning a previously selected MCP to `Use Agent setting` MUST preserve its current native value and remove it from AgentEnv deployment state. It MUST NOT implicitly turn the connection off.
- The external v1 migration backup MAY retain legacy MCP Library references for recovery. Conversion maps known Target/name pairs to native Target selections once; v2 runtime MUST NOT read or write legacy definition references.

### 5.4 Target Identity

- Target ID is defined by its adapter and remains stable across path changes.
- Executable discovery determines whether the Target is installed.
- Missing configuration directories do not make an installed Target missing; writable directories MAY be created during Apply.

## 6. Command Semantics

| Command | Contract |
| --- | --- |
| Save | Persist the entire Profile draft. It does not change any Target. |
| Import | Copy or ingest a resource into the canonical Library. Imported content no longer depends on the original path for normal use. |
| Track source | Attach an explicit update source to a Library resource. It does not update immediately. |
| Check update | Compare canonical Library content with its explicit tracked source. It does not write. |
| Update | Replace canonical Library content after preview. It marks affected deployments pending; it does not deploy. |
| Add to Profile | Add a Library reference to the Profile draft. Save is still required. |
| Preview | Compute one fresh, complete deployment plan against current Profile, Library, and Target facts. It records the inventory fingerprint, approved transitions, expected content hashes, and backup scope without writing. |
| Apply | Verify that the reviewed Profile, Library, inventory, native state, sources, and live paths still match Preview, then execute that exact deployment plan transactionally. Apply MUST NOT reinterpret the same facts through a second ownership planner. Every approved unmanaged replacement is hash-checked again immediately before execution, and a multi-path failure uses compensating rollback. |
| Take over | First Apply to an unmanaged Target. It establishes ownership after previewing existing content. |
| Create from Target | Read a Target's portable environment into a new saved Profile and import reusable resources into Library without changing or taking over the Target. |
| Stop managing | End AgentEnv ownership through an explicit keep-current or restore-pre-takeover path. |
| Remove from Profile | Remove a reference from the Profile draft. It does not delete Library content. |
| Remove from Library | Delete canonical Library content only after references are resolved; managed installs are included explicitly. |
| Ignore | Leave a discovered unmanaged Skill outside Library management. It remains visible and can still conflict with Apply. |
| Roll back | Restore one Backup and its associated deployment state after preview. |
| Delete Profile | Delete only the saved recipe. It MUST NOT silently alter deployed Targets. |

## 7. Profile Lifecycle

The Profile editor MUST distinguish these states:

| State | Meaning | Primary action |
| --- | --- | --- |
| Clean | Draft equals saved Profile. | Edit or choose Target. |
| Dirty | Draft differs from saved Profile. | Save. |
| Saving | Whole Profile is being persisted. | Wait; duplicate Save is blocked. |
| Save failed | Draft is preserved and persistence failed. | Retry Save. |
| Saved, never applied | Profile is valid but has no deployment on selected Target. | Preview Apply. |
| Saved, changes pending | Selected Target has an older Profile or Library version. | Preview Apply. |
| Applied | Saved Profile, referenced Library versions, and managed Target files match. | No Apply action. |
| Validation blocked | Saved Profile resources need correction before Apply. | Fix the named row or open the owning product area. |
| Drifted | Managed Target files changed outside AgentEnv. | Apply to create a fresh preview. |
| Recovery required | Target history requires intervention before normal Apply. | Open Recovery. |

Rules:

- Save MUST persist the complete Profile, not an individual accordion section.
- Save MUST expose local working feedback immediately. Once persistence succeeds, the editor becomes clean and Apply availability is recalculated from the returned saved Profile without waiting for Target discovery, inventory scanning, update checks, usage aggregation, or a full-page refresh.
- Save, Apply, and Target selection MUST appear as one compact action group in the selected Profile context. The Profile-scoped destination selector sits immediately before Apply, with Save in the same compact group. Page creation controls MUST NOT separate these lifecycle commands.
- Save and Apply MUST keep stable labels and positions. A dirty Profile highlights Save and disables Apply; after Save, Save is disabled and Apply becomes the primary action.
- Readiness text describes the current state; it is not a second workflow. Only a condition that requires another product area exposes an inline remediation link: unavailable Target opens Agents and required recovery opens Recovery. Resource validation stays beside the affected Instructions, Skill, or MCP row. Preview blockers and drift do not expose a separate Review command because Apply already creates the authoritative fresh preview.
- Readiness remediation links MUST show a visible verb and object. Icon-only arrows and backend phase labels such as `Review preview` are not executable product intents and MUST NOT appear as commands.
- When no Target is selected, the visible Target selector remains the single selection entry point. When the Profile is dirty, the visible Save button remains the single persistence action.
- Edit, Duplicate, Delete, Save, Target selection, and Apply are selected-Profile commands and MUST remain inside the selected Profile surface. The Profiles page header owns only page creation.
- Every Profile row MUST list all Targets currently using that Profile, even when legacy deployment state has no application timestamp. Each Target is visibly distinguished as current, pending, or needing attention.
- The Profile list is always ordered by persisted creation time, newest first. Selection, the chosen Apply Target, deployment state, Save, and Apply MUST NOT reorder it.
- Selected-Target lifecycle status belongs beside Save and Apply inside the selected Profile surface. It MUST NOT be repeated as a separate page-level summary strip.
- Unsaved changes MUST block Preview and Apply.
- Switching Profile, Target, workspace, or closing the window with a dirty draft MUST offer Save, Discard, or Cancel.
- Failed validation or Save MUST preserve all draft input.
- Applying a Profile MUST NOT rewrite Agent-native configuration outside explicitly managed MCP activation fields.
- When exactly one installed Target is available, Profiles MUST show it as stable context instead of an option menu. When multiple installed Targets are available, Target selection remains available.
- Target selection is scoped to the selected Profile rather than the Profiles page. During an app session, each Profile remembers its own selected Target; otherwise the most recent active Target for that Profile is preferred, followed by its persisted preferred Target. Choosing a Target for one Profile MUST NOT change another Profile's destination context.
- An empty managed Instructions value is a valid complete Profile state. Preview MUST describe it as clearing the managed instruction file rather than blocking Apply.
- On entry, Profiles SHOULD select the chosen Target's active Profile and open its Skills section for the common single-Target workflow. Selection MUST NOT add a redundant `Current` badge or pin and reorder the row; the row's Target deployment badges remain the source of application state.
- Profile name, description, and icon changes auto-save as identity metadata. They MUST preserve any unsaved environment draft and MUST NOT enable the environment Save button by themselves.
- Profile Skills MUST expose enabled and disabled Library references in one compact list. Each row shows its display name, Library path, exact Library content revision, source kind, install name when different, and current state without forcing a details dialog. When the selected Target currently runs that Profile, the row also shows its applied content revision; a mismatch, missing install, or pending removal is `Apply pending`. Ownership, update-source policy, source-check result, Profile availability, and Target deployment are separate dimensions: the action-state column shows only exceptional or currently actionable states, while routine ownership and revisions remain metadata. `Not tracked` MUST NOT be presented as an ownership or management state. Check checks only enabled tracked references in that Profile; Add opens a searchable Library-only picker that identifies source, revision, and path and omits already attached or globally disabled Skills; Remove detaches a reference from the Profile without deleting Library content. A missing reference disables its availability control and offers Relink or Remove. Row menus MUST fit their longest localized command at the minimum viewport.
- Updating from Profile Skills still updates the global Library copy. The update confirmation MUST disclose how many Profiles reference it and whether Copy or Live link mode changes installed Targets immediately.

Status: v2 whole-Profile Save, dirty protection, per-Target applied hashes, active-Profile focus, Profile-scoped Skill enablement, and per-Target MCP policy are `Implemented`. Compatible live Instructions can be adopted. Native configuration, Agent definitions, hooks, environment variables, credentials, and MCP definitions remain Target-owned.

## 8. Target Lifecycle

Target lifecycle MUST be represented as an explicit state, not inferred only from `managed`, hashes, or error counts.

```text
Missing
  -> Unmanaged          executable becomes available

Unmanaged
  -> Preview ready      valid saved Profile selected
  -> Applying           Take over confirmed

Applying
  -> Applied            transaction succeeds
  -> Apply failed       writes fail and automatic restore succeeds
  -> Recovery required  writes and automatic restore both fail

Applied
  -> Changes pending    Profile or referenced Library version changes
  -> Drifted            managed Target content changes externally
  -> Unmanaged          Stop managing completes

Drifted
  -> Applied            external changes are adopted or replaced successfully
  -> Unmanaged          Stop managing and keep current files
  -> Recovery required  recovery fails
```

Canonical states:

| State | Definition |
| --- | --- |
| Missing | Target executable is not discoverable. |
| Unmanaged | Target is installed but has no AgentEnv deployment state. |
| Preview ready | Saved Profile can be previewed for this Target. |
| Applying | A deployment transaction is running. |
| Applied | Target-specific Profile hash, Library versions, and managed resources match. |
| Changes pending | Saved Profile or referenced Library content differs from deployed versions. |
| Drifted | One or more managed Target resources differ from their applied snapshot. |
| Apply failed | Apply failed and the automatic restore succeeded. |
| Recovery required | Apply or rollback failed and AgentEnv cannot prove a consistent state. |

Status: canonical persisted lifecycle derivation, operation locking, and `Recovery required` blocking are `Implemented`. Short-lived working and restored-failure feedback remains renderer state.

## 9. Cross-Target Compatibility

Every adapter MUST declare capabilities. Cross-Target behavior MUST follow this matrix rather than renderer conditionals.

| Profile resource | Selected Target | Another compatible Target | Preview requirement |
| --- | --- | --- | --- |
| Instructions | Serialize to native instruction path. | Reuse content and serialize to destination instruction path. | Show destination file and diff. |
| Library Skill | Install through destination Skill capability. | Portable when destination supports Skills. | Show install, replace, remove, or conflict. |
| Native MCP activation | Apply only the destination Target's own policy when its adapter supports safe activation control. | Policies for other Targets are irrelevant. | Show On, Off, Agent controlled, or blocking missing definition. |
| Unmanaged local resource | Never becomes Profile content automatically. | Preserve unless it conflicts with a desired managed path. | Show preserved warning or blocking conflict. |

Rules:

- Unsupported portable content MUST block Apply with remediation. It MUST NOT be silently coerced.
- Cross-Target Preview MUST calculate an effective payload from the managed Instructions file, enabled Library Skills, and only the selected Target's MCP policy. Empty Instructions still represent one explicit managed file state, and Off still represents one managed MCP switch.
- Cross-Target Preview MUST show the final destination representation, not only the source Profile.
- Adding a Target MUST require a single adapter plus contract tests for capabilities, paths, serialization, preview, Apply, drift, and rollback.
- An adapter MUST NOT receive arbitrary native configuration from a Profile.

Status: adapter capability declaration, effective-payload review, cross-Target Instructions and Skills, and Target-specific native MCP activation are `Implemented`.

## 10. Preview Contract

Preview is the sole write gate for Profile deployment.

Preview MUST:

1. Use the latest saved Profile.
2. Resolve current canonical Skill Library versions and, only for a managed destination policy, the selected native MCP definitions.
3. Read current Target files and deployment state.
4. Describe every managed text and resource change.
5. Group changes as add, replace, remove, preserve, omit, warning, or blocking conflict.
6. Include destination paths and human-readable resource identities.
7. Indicate whether the Target is being taken over or switched.
8. Leave the Target unchanged.

Preview hierarchy MUST put concrete resource identities and actions before secondary filesystem detail. Preserve counts stay in the summary; long preserved paths live in a compact expandable detail section. Resource paths remain available through selectable overflow detail rather than dominating the primary scan path. A resource list that overflows MUST show its total count, a persistent scrollbar, and an explicit remaining-item cue; the default viewport shows at least three complete resource rows without moving the Apply actions out of view. Configuration changes are an explicit summary action that opens and focuses the first collapsed file diff; long diff lines scroll only inside the diff surface and MUST NOT widen the dialog.

A Preview becomes stale when any of these changes:

- Saved Profile content.
- Referenced enabled Library Skill content or a native MCP definition inspected by the selected Target's managed policy.
- Any live file or resource included in the plan.
- Deployment state.
- Selected Target.

Apply MUST reject a stale Preview and require a fresh one.

No-op contract:

- A Preview with no changes MUST produce the `Applied` state.
- The confirmation action MUST be unavailable.
- No Backup, history record, or timestamp update is created.
- Identical managed Skills MUST NOT be reported as replace operations.

Status: stale checks and no-op detection are `Implemented`.

## 11. Apply And Takeover Contract

Apply means complete replacement of the AgentEnv-managed portion of one Target with one saved Profile.

Instructions and dedicated Skill deployments may be fully AgentEnv-owned paths. Agent native configuration remains shared and Agent-owned except for explicit sparse MCP activation fields. OpenCode may patch only `mcp.<name>.enabled`; Codex may patch only `mcp_servers.<name>.enabled`; Trae CLI may patch only an existing user MCP's `disabled` field in its current user YAML or JSON source. Claude Code, Antigravity, and any adapter without a verified activation field MUST NOT write MCP configuration.

When the selected Target's MCP policy is `Leave unchanged`, Apply MUST preserve its configuration byte-for-byte, omit the path from Preview freshness and Backup, and clear prior MCP ownership metadata. When the policy is managed, the adapter parses the current file, patches only named existing activation fields, preserves every definition and unknown field, and includes that file in freshness and Backup only when a semantic change is planned. Configuration files MUST NOT be recorded as whole-file AgentEnv-managed resources.

It MUST:

1. Revalidate Preview freshness immediately before writing.
2. Create a Backup of every affected live path and deployment state.
3. Write all planned text resources.
4. Install, replace, or remove all planned managed resources.
5. Preserve unrelated unmanaged resources.
6. Write deployment state only after all resource writes succeed.
7. Record one history entry only after success.
8. Refresh visible Profile and Target state after completion.

Switching Profiles MUST remove managed external resources owned by the previously active Profile when they are absent or disabled in the new Profile. MCP choices absent from the new sparse policy remain Agent-owned and unchanged. Unmanaged resources MUST remain untouched unless they occupy a required destination. A fresh Preview MAY offer `Back up and replace` for an exact unmanaged Skill destination required by the Profile; without that explicit acknowledgement Apply remains blocked.

An unmanaged same-name Skill replacement MUST be scoped to exact paths named by the fresh Preview,
included in the operation Backup, and installed atomically as an AgentEnv-owned resource. A Skill
owned by another manager, protected by an Ignore rule, or not named by that Preview remains a hard
conflict and MUST NOT be admitted by the replacement acknowledgement.

Takeover is the first Apply to an unmanaged Target. Preview MUST disclose:

- Existing content that will be replaced.
- Existing unmanaged content that will be preserved.
- Conflicts that prevent takeover.
- Backup availability.

Status: transactional backup, replacement, unmanaged preservation, and automatic restore are `Implemented`.

## 12. Failure And Atomicity Contract

Apply is a single transactional user operation even when it writes multiple resource types. It is not a filesystem-atomic operation across paths.

- If any write fails, AgentEnv MUST attempt to restore all affected paths and prior deployment state.
- If restore succeeds, the result is `Apply failed`; the previous environment remains active.
- If restore fails, the result is `Recovery required`; normal Apply is blocked until recovery is resolved.
- Partial success MUST name what was written, what failed, and which recovery action remains.
- Retrying MUST start from a fresh Preview.
- Concurrent Apply operations to the same Target MUST be serialized.
- Successful writes MUST be verified against the planned hashes before deployment state is committed.

Status: automatic restore, post-write verification, explicit `Recovery required` state, and same-Target operation locking are `Implemented`.

## 13. Drift Contract

Drift means an AgentEnv-managed path differs from its last successful applied snapshot.

Drift detection SHOULD run:

- At app startup.
- When the app regains focus.
- When the user refreshes Targets.
- Before Preview and Apply.

A drifted Target MUST NOT appear Applied. The user MUST be offered these explicit outcomes where the resource type permits them:

| Action | Result |
| --- | --- |
| Inspect | Show applied content, live content, and saved Profile content. |
| Adopt into Profile | Save selected live changes back into the native Profile, then require a new Preview. |
| Back up and replace | Preserve live drift in a Backup, then deploy the saved Profile. |
| Restore previous deployment | Restore the most recent known-good AgentEnv deployment. |
| Stop managing and keep current | Detach ownership while preserving current files. |
| Ignore for now | Keep the Target visibly Drifted and block ordinary Apply. |

One drifted path MUST produce one ownership problem. If an external tool replaces a previously managed Skill or agent and removes its ownership marker, Preview MUST report the managed drift instead of also reporting a generic unmanaged-destination collision. `Back up and replace` MAY bypass ownership validation only for the exact drifted paths recorded by the fresh Preview; unrelated unmanaged destinations remain blocking conflicts.

Drift adoption MAY update portable Instructions and the existing sparse MCP selections for that same Target. It MUST NOT adopt arbitrary native configuration, create MCP definitions, or add Target-owned Skills automatically.

Status: detection, diff inspection, explicit overwrite with Backup, compatible Instructions and managed MCP activation adoption, and detach choices are `Implemented`. Target-owned Skills, native configuration, excluded credentials, and MCP definitions remain intentionally non-adoptable.

## 14. Stop Managing Contract

Stopping management is distinct from deleting a Profile.

Two paths are required:

### Keep current environment

- Back up current managed resources and state.
- Materialize AgentEnv-managed Skill links as independent copies where possible.
- Remove AgentEnv ownership markers and deployment state.
- Keep current Target behavior unchanged.
- Mark Target `Unmanaged`.

### Restore pre-takeover environment

- Preview restoration of the takeover Backup.
- Restore all takeover-affected paths and prior state.
- Remove resources introduced only by AgentEnv takeover.
- Mark Target `Unmanaged` after success.

Deleting an active Profile MUST require the user to apply another Profile or stop managing each affected Target. It MUST NOT silently detach or delete deployed files.

Status: active Profile deletion is blocked; both Stop Managing paths, safety backup, link materialization, and ownership removal are `Implemented`.

## 15. Rollback And Backup Contract

- Every mutating Apply, takeover, cleanup, Library deletion with installs, and Stop Managing action MUST have a recoverable Backup when feasible.
- Rollback MUST be previewed before it writes.
- Rollback MUST restore files, directories, links, ownership markers, and deployment state consistently.
- Rollback MUST detect live changes made after the Backup and require explicit confirmation before replacing them.
- A Rollback Preview becomes stale when any affected live path changes after Preview. Rollback MUST reject the stale plan without writing and require a fresh Preview.
- A successful rollback MUST refresh Target lifecycle and active Profile metadata.
- Backups MUST be retained until explicitly removed by the user or a documented retention policy.
- Settings owns the global managed-backup inventory, storage usage, retention policy, explicit deletion, and policy cleanup entry points. Contextual Target and Skill surfaces continue to own Restore.
- Automatic retention applies only to managed Target recovery and Skill cleanup Backups. `Never`, `7 days`, `30 days`, and `90 days` are the supported policies.
- A Backup referenced by `Recovery required` and the earliest Apply Backup for every currently managed Target are required recovery state and MUST NOT be deleted manually or automatically.
- The latest Target recovery point MUST be retained from automatic cleanup, but MAY be explicitly deleted after impact confirmation when it is not otherwise required.
- Changing the retention policy saves future cleanup behavior and MUST NOT silently delete data in the same interaction. `Clean up now` previews the eligible count and size before deletion.
- Deleting or cleaning Backups MUST NOT modify Profiles, Library resources, current Target files, or external Data Exports. Partial cleanup reports both deleted and failed items.
- Backup storage measurement and deletion MUST NOT follow symbolic links outside managed backup roots.
- A failed rollback enters `Recovery required`.

Status: Apply and cleanup rollback, stale rollback conflict handling, managed storage inventory, explicit deletion, protected recovery points, and retention cleanup are `Implemented`.

## 16. Skill Library Contract

### 16.1 Import

- Import from a local folder copies canonical content into the Library.
- Import presents `Local folder` and `Repository` as mutually exclusive source modes. Only the active mode is rendered, and the footer exposes one primary action for that mode; a second import workflow MUST NOT compete inside the same dialog body.
- When the selected local folder is an adapter-declared Target Skill location, Import MUST back it up and replace it with a managed link or copy in the same transaction. A successfully managed source MUST NOT remain in Needs attention as a duplicate.
- Local folders outside supported Target locations remain independent provenance sources and are not modified.
- Normal use MUST continue if the original folder is later deleted.
- The original local path is retained as provenance, but local imports default to the `Untracked` update policy.
- A user MAY explicitly track a stable local folder as an update source.
- Repository import MUST store the sanitized repository locator, explicit ref, directory, resolved commit, and Skill-subtree revision. GitHub API imports remain `sourceType: github`; System Git imports use `sourceType: git`.
- Repository imports default to the `Tracked` update policy. The selected source transport is durable metadata and MUST NOT switch silently during a later background check.
- A GitHub Web URL MAY identify a Skill directory, a containing directory, or a repository. A generic Git clone locator uses separate optional Ref and Directory fields; unknown hosting providers' Web URL layouts MUST NOT be guessed. Containing-directory and repository imports MUST scan recursively for valid top-level Skill roots before any Library write.
- `github.com` Web URLs use the GitHub API by default. SSH, SCP-like, non-`github.com`, and explicitly selected System Git locators use the packaged application's discovered system `git` executable and the user's existing SSH Agent or Git credential helper. AgentEnv MUST NOT store Git passwords, access tokens, private keys, or credential-helper output.
- A GitHub API failure MUST NOT silently retry through System Git. The user MAY explicitly choose `Try with System Git`, after which that source remains a Git source.
- Scan results MUST appear in a confirmation dialog, select all importable candidates by default, allow individual candidates to be excluded, and identify already-imported or duplicate candidates without selecting them. The bulk-selection control MUST expose all, mixed, and none states while keeping its label and selected count aligned without overlap at the minimum supported viewport.
- A batch import MUST process selected candidates sequentially in the same dialog. Each candidate advances through distinct queued, reviewing, writing, completed, failed, or skipped states; only the current candidate may open the conditional duplicate review.
- A candidate becomes completed only after its canonical Library write has returned successfully. Completed candidates remain visible and preserved when a later candidate fails or is skipped.
- After the final candidate, the dialog MUST show one aggregate success or partial-failure result and remain open until the user explicitly closes it. A batch import MUST report each failure against its source.
- Every Skill has an independent `Tracked` or `Untracked` update policy. `Untracked` excludes that Skill from manual, startup, and scheduled checks without reading its local source, Repository Cache, or remote.
- A Skill row overflow is a compact command menu. Update source and tracking fields live in a focused `Update settings` dialog and MUST NOT turn the row menu into a scrolling form.
- The UI status for this durable policy is `Not tracked`; temporary wording such as `Checks off` and source-type wording such as `Fixed copy` MUST NOT substitute for the policy.
- The global auto-check setting controls scheduling only; it never overrides a per-Skill `Untracked` policy.
- Legacy metadata without an explicit policy defaults to `Untracked` for local sources and `Tracked` for GitHub API and System Git Repository sources.
- Import validates `SKILL.md` and rejects unsafe or ambiguous directory layouts.
- Skill version metadata is normalized from either ClawHub's top-level `version` field or Agent Skills' `metadata.version` field. String and numeric scalar versions are accepted. Conflicting values declared in both locations are rejected rather than silently prioritized.
- Library identity is the stable `id`; duplicate detection uses the normalized frontmatter `name` and also guards storage-ID collisions. Import MUST NOT silently create a suffixed ID when a same-name Skill exists.
- A same-name import opens one conditional review step before any write. It compares declared version, full content hash, `SKILL.md`, and every changed file against each matching Library entry. Identical content is labelled explicitly and can only reuse the existing entry. Different content requires an explicit choice between replacing a selected Library entry or saving under a validated unique ID.
- Import comparison treats trackable online provenance as part of the Skill's useful state. When content is identical but an incoming Repository source differs from or improves on the existing local provenance, the review labels `Source available` and offers `Update source`. This operation preserves every Skill file and stable Library ID while updating source, revision, upstream, transport, and `Tracked` policy metadata. Different local paths alone do not create a source conflict, and a local import never silently downgrades an existing online source.
- Replacing preserves the selected Library ID so Profile references remain valid, preserves Library-only presentation and availability metadata, backs up the current content, and atomically installs the reviewed source. Saving another copy makes the duplicate IDs visible in the Skill list so intentionally same-name entries remain distinguishable.
- Import commit MUST verify the reviewed incoming content hash. A local or remote source that changes after review is rejected without modifying Library.
- Local import MUST distinguish a non-destructive `Import copy` from `Import & manage` for a folder already inside a Target. Before `Import & manage`, the UI discloses that AgentEnv will back up the Target copy, import it to Library, and replace that location with a managed installation.
- A selected Target folder that is already managed or ignored MUST block generic import. A same-name Library conflict stays inside the Import intent and uses the shared duplicate-review workflow; it MUST NOT redirect the user to Scan local.
- A failed local or external import MUST preserve the selected source and keep its dialog open so the user can retry or inspect the global error.
- The Library Skill icon defaults to its source type and MAY be replaced by a built-in icon. The selected icon is presentation metadata and MUST survive content updates.
- `SKILL.md` frontmatter MUST be parsed as YAML rather than with line-oriented string matching. Folded, quoted, and multiline values remain valid.
- System Git uses one disposable Bare Repository Cache per sanitized locator. The Cache lives under the operating system cache root rather than AgentEnv data storage, is excluded from Data Backup, and MAY be deleted or rebuilt without changing Library, Profiles, or Targets.
- A Repository scan or fetch failure MUST leave existing Library content available and MUST NOT block Profile Save or Apply. Repository operations never modify or pull a user's existing checkout.
- Cancel, Escape, window close, and application quit MUST terminate active System Git processes without disposing the Repository service for later operations. GitHub API operations are not silently converted into System Git operations when cancelled or failed.

### 16.1.1 Refresh

- `Refresh` rescans canonical Library content and local install state; it does not contact tracked update sources.
- `Check updates` is the separate command that contacts tracked sources.
- `Cmd/Ctrl+R` in Library/Skills invokes the same in-place Refresh command and MUST NOT reload the renderer.
- Refresh MUST preserve the current search, filters, scroll context, and rendered Skill list until replacement data is ready. It MUST NOT flash a temporary empty state.
- Update and install-repair commands MUST appear in their semantic `Updates` and `Installs` columns. The `Actions` column is reserved for the overflow menu and MUST NOT compete with labelled row actions for width.
- Row actions and their secondary revision or install state MUST occupy independent vertical tracks. A control's rendered height MUST fit inside its track, with at least `4px` clear space before secondary text; child overflow MUST NOT be used to compress the row.

### 16.1.2 Merge Same-Name Skills

- `Merge duplicates` appears only for a Library name represented by two or more stable Library IDs. It is a row overflow command, not a page-level mode or automatic cleanup side effect.
- Preview includes every same-name Library entry and compares all files, declared versions, content hashes, sources, Profile usage, and managed-install counts. Identical content is stated explicitly; differences use the standard formatted diff viewer.
- The user independently chooses `Keep Skill` and `Keep update source`. `Keep Skill` owns the surviving Library ID, canonical content, icon, and global availability. `Keep update source` owns source type, locator, revision metadata, provenance, and tracked/untracked policy; choosing a source MUST NOT silently choose that entry's content.
- Confirming Merge verifies the reviewed member set and every reviewed content hash. A new duplicate, removed entry, or changed content makes the preview stale and blocks mutation.
- Merge migrates every Profile reference from removed IDs to the surviving ID. If a Profile already references the surviving ID, that existing reference and its target name and enabled state win, and references to removed IDs are dropped. Otherwise target names and enabled states are preserved while only the Library ID changes; references that collapse onto the same target name become one reference and remain enabled when any original reference was enabled.
- Every AgentEnv-managed install derived from a removed ID is relinked or recopied to the surviving Library entry without waiting for another Apply. Unmanaged and externally managed copies are untouched.
- Merge is one transaction covering all selected Library entries, affected Profile directories, managed installs, and ownership markers. Failure restores every backed-up path; success creates one History entry that can restore the pre-merge entries and references.
- The completion message names the surviving ID and reports updated Profile and managed-install counts. Success follows the global transient-feedback policy; failure remains dismissible and actionable.

### 16.2 Scan And Cleanup

Scan MUST inspect every adapter-declared Skill location and group results by canonical Skill identity and content.

Runtime identity, Library identity, and deployment identity are distinct:

- `runtimeName` comes from `SKILL.md` frontmatter and is the identity used by an Agent to resolve duplicate Skills. A missing name falls back to the deployment directory only with an explicit inferred-confidence warning.
- `libraryId` is AgentEnv's stable canonical record ID. It MUST NOT be silently rewritten merely because a runtime name or install directory differs.
- `deploymentName` is the directory name inside a Target Skill root. It is a path concern, not the primary duplicate or compatibility key.
- Scan and Apply MUST detect duplicate desired `runtimeName` values even when the Library IDs and deployment directories differ.
- Adapter-declared scan depth is authoritative. Recursive Agents are scanned recursively with realpath cycle protection; direct-child Agents are not assigned nested Skills they do not load.

The Local Skill Cleanup surface owns unresolved local-state counts and group details; Library/Skills MUST NOT duplicate a `Needs attention` summary above the table. While the cleanup surface is open, `Refresh` MUST run a new filesystem scan in place, retain the surface, and expose its working and completion states.

Scan MAY read supported versions of `$XDG_STATE_HOME/skills/.skill-lock.json` and `~/.agents/.skill-lock.json` to identify Skills CLI ownership and recover upstream provenance. Unsupported or corrupt lock data MUST degrade to ordinary filesystem scanning and MUST NOT block unrelated Skills.

The surface owns only filesystem-copy normalization into Library. It does not edit Profiles or orchestrate Apply. Each row exposes one current action; read-only details, ignore, shared retention, and restore-to-review controls live in the overflow menu.

User-facing state and action contract:

- Row status badges use a compact, non-truncating vocabulary: `Managed`, `Unmanaged`, `Duplicate`, `Conflict`, `Changed`, `External`, `Shared`, `Ready`, `Kept`, and `Ignored`. The selectable hover/focus detail carries the complete explanation; a badge MUST NOT clip or ellipsize its visible label.
- Cleanup rows reserve stable identity, status, and action columns. Every status badge starts at the same left-aligned position regardless of Skill-name length or whether the row has a current action; the action column remains reserved when only the overflow command is available.
- Library is the canonical Skill source; a Cleanup row marked `Managed` represents one or more physical Target installations derived from that Library entry, not another Library record. Library-bound rows expose the neutral relationship `Library / <id>` and managed-install count without duplicating Library update or deletion commands inside Cleanup.
- A Skill absent from Library is `Unmanaged`, `Duplicate`, or `Conflict`; its current action is always `Add to Library`.
- Version selection is a conditional field inside `Add to Library`, never a separate `Choose version` action. It appears only when detected contents differ.
- A Skill already in Library uses `Unmanaged` / `Manage copies`, `Conflict` / `Review`, or `Changed` / `Review`.
- External ownership uses `External` / `Review`. Internal states such as `Auto-ready`, `Take over`, and `Resolve conflict` MUST NOT be presented as user actions.
- `Add to Library`, `Manage copies`, and every review action open a preview dialog before mutation. Row actions use lightweight styling; filled emphasis is reserved for the dialog commit and an intentional bulk command.
- `Review ready` is a stable Cleanup command rather than a conditionally disappearing feature. It is enabled only when at least one group has one unambiguous canonical version, otherwise it remains visible and disabled with an unavailable explanation. It opens `Review ready skills`, a bulk confirmation listing every eligible Skill and the independent-backup behavior before `Clean up N skills` starts. A failure in one Skill does not roll back completed independent Skills, and the result reports both completed and remaining groups.
- The main process MUST rescan and compare the reviewed content hashes immediately before mutation. Stale previews fail without modifying Library or local copies.
- Every mutating cleanup backs up all affected locations first. A failure after mutation begins attempts to restore Library and every affected location independently; one failed restore MUST NOT prevent later paths from being restored. The error distinguishes a completed rollback from an incomplete rollback, and the renderer rescans disk before presenting the remaining group state.
- After successful cleanup, selected Target-specific copies rescan as current and `Managed`; the group MUST NOT retain a duplicate or pending action.
- AgentEnv ownership is attached to the physical managed installation. A shared compatibility path scanned by multiple Targets MUST appear as one managed location rather than a duplicate caused by Target-specific scanning.
- A physical location scanned by multiple Target adapters MUST appear once instead of presenting the Target names as separate copies. It is labelled `Shared` only when no adapter declares that path as its own non-shared runtime; a preferred or alternate Target runtime takes precedence over another adapter's compatibility declaration, and its owning Target is the primary location owner.
- One confirmed cleanup MUST include every reviewed physical location in the group. A successful rescan MUST NOT leave a conflict or duplicate that requires the user to repeat the same cleanup for the remaining Target paths.

Shared compatibility migration contract:

- A shared Skill not yet in Library follows the same `Add to Library` intent as every other local Skill. If multiple versions exist, the dialog adds a version choice.
- Adding a shared Skill to Library is one transaction: back up all copies, create the Library canonical copy, keep exactly one shared compatibility copy active, and remove redundant Target-specific copies. The shared copy MUST NOT receive a Target ownership marker.
- Once Library is ready, Cleanup shows the compact `Shared` badge and states that consumer Targets still load the compatibility copy independently of Profile references. `Review shared copy` presents the two valid outcomes in one workflow: open Profiles so each affected Target can receive its intended Profile, or `Keep shared copy`. A Profile that omits the Skill is a valid explicit decision to remove it for that Target. Cleanup MUST NOT show per-Target `Needs Apply` chips, expose internal preparation or migration phases as commands, or pretend Profile Apply is a Cleanup step.
- An installed Target that still reads the compatibility location remains a consumer even when AgentEnv does not manage its Profile. AgentEnv MUST preserve the shared copy and block replacement until that Target records an explicit applied decision. `Keep shared copy` is the non-takeover outcome; skills-only Target ownership is not currently supported and MUST NOT be implied by the UI.
- After every affected Target has an explicit current decision, the row shows `Ready` / `Replace shared copy`; the confirmation remains the mutation boundary.
- Profiles independently save and apply each Target's install-or-omit decision. Apply Preview describes the final outcome as `After cleanup: install as <name>` or `After cleanup: remove from this Target`; it MUST NOT expose preparation records or migration decisions. Preparation MUST leave the shared path active and MUST NOT create a same-name Target-specific duplicate.
- `Replace shared copy` requires confirmation that lists each prepared Target's final `Install as <name>` or `Do not install` decision. It executes one cross-Target transaction: back up all shared, destination, and state paths; remove the shared source; deploy or omit per prepared Profile; verify every destination; then clear preparations. Any failed step restores all paths and states.
- Cleanup history exposes the completed `Shared copy replacement` as one restorable operation. Restore returns shared paths, Target paths, and preparation state to their pre-replacement state.
- `Keep shared copy` records a path-scoped decision and resolves the group without changing files. `Review again` removes only that decision.
- Shared compatibility groups MUST NOT participate in generic Target-copy bulk cleanup.

Cleanup review contract:

- If the Skill is not yet in Library, the user chooses the local version whose content will be preserved as the Library source of truth.
- The chosen source location is always included in the cleanup and cannot be deselected accidentally.
- If the Skill already exists in Library, `Review differences` first asks whether to keep the current Library version or use a reviewed local version. Local version selection appears only after the latter choice. Replacing Library content backs up the previous canonical copy and changes its provenance to local/untracked.
- Every truncated Skill name, description, path, and history detail in the cleanup workflow exposes its full value on pointer hover and keyboard focus. The detail layer remains open while the pointer moves into it, and its text is selectable so paths and errors can be copied directly.
- Cleanup identity and compact cleanup state occupy explicit non-overlapping regions. Identity, description, path, and state detail may expose selectable overflow detail; the visible status badge itself never truncates.
- Cleanup groups and Cleanup history use the same main-content/action-column hierarchy and control scale. History does not add a redundant `Backup` badge when its section and metadata already establish that scope.
- Cleanup history is a secondary group inside the Local Skill Cleanup surface, not a separate framed panel.

Ignore contract:

- Ignored Skills remain visible in cleanup results.
- A group with both ignored and active locations is classified by its active locations; it MUST NOT appear wholly ignored.
- Mixed groups offer restoration of ignored locations without showing contradictory ignore and unignore controls together.
- Ignore does not grant ownership to AgentEnv.
- Apply preserves ignored Skills that do not conflict.
- An ignored Skill occupying a desired managed destination blocks Apply.
- Ignore rules can be removed without rescanning data loss.

External ownership contract:

- Skills tracked by a supported Skills CLI lock are classified as `External`, not `Unmanaged`.
- Adapter-declared native containers, including Claude Code plugins, are also classified as `External`. The UI names the actual owner and MUST NOT present an import or takeover command when that source is not independently importable.
- Directory symlinks and broken tracked symlinks remain visible in Scan results.
- `Import copy` copies a selected healthy external installation into Library, preserves verified upstream metadata, and leaves the external files and lock unchanged.
- `Import copy` is idempotent. Matching Library content is reused; an occupied ID with different content requires the shared duplicate-import decision instead of failing or silently suffixing. After rescan, an external installation with matching Library content remains labelled `External`, shows its Library relationship, and retains a `Review` entry. Review offers `Update source` when online provenance can improve tracking, otherwise it confirms reuse; it MUST NOT create a duplicate Library copy.
- External installations MUST NOT enter the ordinary cleanup transaction that replaces selected locations with AgentEnv-managed copies.
- A desired Profile Skill occupying an externally managed Target path blocks Apply with the manager, path, and required recovery action identified.

### 16.3 Update

- Check compares only against an explicit update source.
- A tracked online source MUST expose its complete address on hover and keyboard focus and provide a clearly identified command that opens the address in the system browser.
- GitHub rate limiting MUST provide a GitHub sign-in remediation.
- GitHub Device Flow polling MUST respect the server-provided minimum interval. `slow_down` extends every later poll by at least five seconds, remains a waiting state rather than a user-facing failure, and MUST NOT end automatic polling.
- Window focus and manual status checks MUST NOT create overlapping or early token requests. A completed authorization immediately refreshes the visible account and rate-limit state without requiring navigation or restart.
- System Git authentication, host trust, VPN, ref, and timeout failures MUST provide Repository-specific diagnostics and MUST NOT suggest GitHub sign-in.
- Update Preview MUST show changed files and validation errors.
- Update Preview MUST bind one immutable materialized candidate, the current Library content hash, and the current update metadata. Confirm applies that exact candidate; it MUST NOT fetch the source again. If Library content or metadata changes after Preview, Update fails stale and requires a new review.
- Update Preview MUST derive impact from persisted Profiles and observed managed installs. It names referencing Profiles and distinguishes live links, which change immediately, from copied installs, which remain pending.
- Applying a Library update changes canonical content only after Preview, Backup, validation, and atomic replacement. A check never modifies Library.
- A Repository update changes neither a Profile nor a Target directly. Related Profiles and copied Target installs become `Changes pending` and require the normal Save/Apply lifecycle.
- In optional Copy mode, Profiles remain saved and their deployed Targets become `Changes pending`; copied installs require explicit synchronization or Profile Apply.
- In default Live link mode, linked Target content changes immediately. The UI MUST disclose this behavior and MUST NOT represent the linked deployment as an immutable applied snapshot.
- Live link installs link the complete Target Skill directory to the canonical Library directory. They MUST NOT construct a shadow directory made from per-file links. The ownership marker lives beside the directory link so Library contents remain clean and replacing or removing the link cannot touch the canonical directory.
- Local imports without an explicit tracked source MUST NOT produce repeated update failures.
- A Profile-scoped Check MUST inspect only enabled tracked Skills referenced by that Profile. Disabled, missing, and untracked references remain visible but MUST NOT trigger network or filesystem checks.

### 16.4 Delete

- A Skill referenced by any Profile MUST NOT be deleted.
- The user is directed to affected Profiles.
- Deleting an unreferenced Skill explicitly includes or excludes its managed Target installs.
- Unmanaged copies are never deleted.
- Deletion with managed installs creates an undoable Backup.

Status: local, recursive GitHub, and System Git Repository import/update; in-place Refresh; per-Skill update policy; YAML frontmatter runtime identity; direct and recursive Agent scanning; read-only Skills CLI and Claude plugin ownership detection; external copy import where safe; scan; cleanup; ignore; icon metadata; duplicate runtime-name blocking; reference blocking; managed-install removal; and undo are `Implemented`.

## 17. Native MCP Contract

- Each Agent is the source of truth for MCP definitions, installation, sign-in, authentication, and credentials.
- AgentEnv discovers only user/global MCP names, activation state, transport hint, source path, and control capability. Project, plugin, workspace, and policy-managed MCPs MAY be observed but MUST NOT be adopted or mutated.
- Discovery MUST include credential-bearing definitions such as `computer-use` and `node_repl`; secret values MUST NOT enter Profile data, renderer payloads, logs, or diagnostics.
- A Profile stores a policy per Target. `Leave unchanged` opts that Target entirely out of MCP management. Managed mode stores sparse three-state rows: an absent or `Use Agent setting` row performs no mutation, while `On` and `Off` update only a verified native activation field.
- Codex, OpenCode, and Trae CLI activation control are `Implemented`. Claude Code and Antigravity are read-only until an official, reliable user-scope activation mechanism is verified.
- Apply MUST preserve command, URL, arguments, headers, environment, OAuth state, and every unknown definition field byte-for-byte or semantically unchanged.
- A managed `On` selection missing from the Target is `Setup required` and blocks Apply because AgentEnv cannot create definitions. A managed `Off` selection missing from the Target is equivalent to Off and is a no-op.
- A new native MCP added outside AgentEnv remains valid. Whole-file drift MUST NOT block it or remove it.
- If activation already matches the saved Profile, Preview is a no-op: no write, Backup, history event, or timestamp update.
- Create from Target captures discovered connections as Target-specific activation selections only when that adapter supports safe activation. Read-only Targets capture `Leave unchanged` and import no MCP definition into Library.
- Profile v2 has no MCP Library store or IPC. Legacy MCP definitions survive only inside the external one-time migration backup and report; runtime MUST NOT read, mutate, or delete that old file.
- MCP interaction exists only inside a selected Profile as native Agent discovery and activation choice.

Status: native discovery across all five Agents, per-Target opt-in and sparse editing, Codex, OpenCode, and Trae CLI activation, read-only Claude Code and Antigravity visibility, blocking missing-On remediation, no-op, definition preservation, and one-time legacy reference migration are `Implemented`.

## 18. Create From Target Contract

Create from Target gives an existing native environment a reusable Profile representation before the user decides whether AgentEnv should manage it.

- Capture MUST read only paths declared by the selected Target adapter.
- A Target-row capture command MUST keep the invoking Targets workspace visible until the user confirms. Cancel and Escape return focus to that exact command without changing workspace.
- Target-row command hierarchy follows lifecycle state: an unmanaged Target presents `Capture` as the primary action and `Choose Profile` as secondary; a managed Target presents `Open Profile` as the primary action and Capture as secondary. Both commands remain available without competing primary emphasis.
- Profiles may offer a general `From Target` entry, but a Target-row entry MUST bind the source Target directly and MUST NOT ask the user to choose Blank versus From Target again.
- Capture uses two explicit steps: setup and capture review. Review provides Back without losing the Profile name or selected Target.
- Preview MUST list portable resources to include or reuse, new Skill Library imports, discovered native MCP activation choices, excluded resources, and conflicts.
- Capture review MUST summarize Profile resources, Library imports, and zero source changes before the detailed resource list.
- Capture resource outcomes such as `Import to Library` and `Use Library copy` are neutral status badges, not link-colored commands.
- Blocking errors and excluded-resource advisories MUST appear before long resource details. Repeated warnings MUST be aggregated with expandable details.
- Review and Save expose local working and error states. Review MUST enter a visible animated busy state immediately, keep the action geometry stable, expose `aria-busy`, and block duplicate submission until the preview resolves. A stale or failed review remains in the dialog and offers `Refresh review`.
- Instructions become portable Profile text. Reusable Skills become Library references. MCP definitions and every other native setting remain in the source Agent; only safe Target-specific activation state is captured when supported.
- Existing Library Skill content is reused only when its comparable content hash matches exactly.
- If a captured Skill has the same normalized name or requested ID as an existing Library Skill, Capture MUST resolve it during Preview rather than failing during Save. Matching content reuses the existing Library identity. Different content is previewed as an explicit unique Library ID while the existing same-name entry remains unchanged.
- Sensitive values, credentials, caches, history, runtime state, and unsupported native fields MUST remain Target-owned and MUST be named as excluded.
- Ignored Skills remain in place and are excluded from the new Profile.
- Skills identified as owned by an external manager remain in place and are excluded from the captured Profile. Capture review MUST name the external manager; later Apply MUST NOT unexpectedly turn that external installation into a blocking desired resource.
- An existing Profile reference that resolves to an externally managed Skill with exactly matching Library content is preserved as external during Apply and MUST NOT block or be replaced. Different content remains a blocking ownership conflict.
- Duplicate active runtime copies with identical content MAY be represented by one Library reference, but every source copy remains unchanged. Same-name copies with different content block capture because the canonical content is ambiguous.
- When a captured Skill has identical shared-compatibility and Agent-private copies, the first takeover Apply MAY replace only the matching private copy with an AgentEnv-managed deployment. The shared copy remains untouched until the separate reviewed cleanup workflow. A changed private copy, ignored copy, or externally managed copy MUST still block automatic takeover.
- Preview becomes stale when any captured source path changes before confirmation.
- Saving a captured Profile MUST NOT invoke Apply, create a Target Backup or deployment state, add ownership markers, delete a source path, or write Target history.
- A successful capture opens the new Profile in `Saved, never applied` state. The user may inspect or edit it before using the standard Preview and Apply contract.
- Takeover, backup, Target-specific deployment, and managed-resource replacement occur only during the later explicit Apply. Local duplicate cleanup remains an explicit Scan local workflow.
- Failure while saving MUST remove the partially created Profile and newly imported Library resources while leaving the Target unchanged.

Status: OpenCode, Codex, Claude Code, Antigravity, and Trae CLI adapter capture, reviewed Skill Library import, native MCP activation capture, stale protection, source preservation, and saved-never-applied handoff are `Implemented`.

## 19. Profile Deletion Contract

- Delete removes the saved Profile recipe only.
- Delete is blocked while the Profile is active on any Target.
- The blocking dialog MUST list all affected Targets, not only the first one.
- The user MUST be able to navigate to each Target and choose Apply another Profile or Stop Managing.
- Backups and history remain available after Profile deletion and retain the deleted display name as historical metadata.

Status: deletion blocking, complete affected-Target disclosure, and navigation to Target resolution are `Implemented`.

## 20. Feedback Contract

Every command follows:

```text
Idle -> Pressed -> Working -> Success | Warning | Error | Partial failure
```

- Press feedback is immediate.
- Local commands report progress near their control or affected region.
- Cross-page or background operations use the shared global feedback region.
- Workspace-owned completion feedback remains scoped to its originating workspace and disappears when the user navigates away. When a command intentionally navigates to the object it created, that result workspace inherits the completion feedback. Errors remain globally visible because they may require recovery outside the origin surface.
- Success feedback expires after approximately five seconds.
- Errors persist until dismissed or resolved.
- A newer warning or error replaces stale success feedback.
- Completion updates visible persisted state, not only a message.
- No visible command may appear to do nothing.
- Profile edits update the in-memory draft without filesystem scans. Save, Preview, and Apply each expose control-local working state for their complete asynchronous lifetime.
- Profile identity metadata auto-save exposes immediate working and completion feedback while preserving any dirty environment draft.
- One Preview request MUST reuse one normalized Library and local-inventory snapshot rather than recursively scanning or hashing the same resource roots once per validation stage.
- Repeated background Target reads MAY reuse recent executable discovery. The explicit Target `Refresh` command MUST bypass that cache.
- Apply completion MUST update the visible verified Target state immediately; nonessential history, usage, and enrichment refreshes continue without holding the primary action in a working state.
- Global feedback MUST NOT block unrelated workspace controls. Only actions owned by the feedback surface, such as Dismiss or Connect GitHub, receive pointer input.

Status: shared transient success, persistent error, background progress, GitHub remediation, and non-blocking global feedback are `Implemented`.

## 21. Desktop Interaction Contract

- Supported minimum content viewport is `920 x 620` at 100% scale.
- Default content viewport is `1180 x 728`.
- No supported viewport has page-level horizontal scrolling.
- Layout verification MUST measure document and owned scroll-region overflow, child containment, text fit, sibling control overlap, and floating-layer stacking; successful clicks alone do not satisfy this contract.
- The Electron compositor, document root, and application shell MUST paint the complete content viewport with the page background; short pages and navigation transitions MUST NOT expose an unpainted window background.
- Electron MUST NOT expose an empty renderer frame during cold start. Its compositor background matches the application surface, and the HTML shell provides a branded, reduced-motion-aware launch state before React mounts without delaying foreground renderer scheduling.
- Startup loads Library Skills independently from Target discovery. Local core data for Skills, Profiles, Targets, and Settings becomes usable before GitHub update checks, native MCP discovery, local inventory scans, and derived Profile usage finish; those background enrichments MUST merge into the visible UI without replacing it with an empty state.
- Switching Profiles keeps the selected Profile surface painted while the next Profile loads. The list may show the pending selection, but the editor MUST render a stable named loading surface with unchanged bounds and MUST NOT flash `No profile selected`.
- Renderer startup MUST NOT synchronously open duplicate browser-side persistence. Locale begins from the operating system and then adopts the authoritative local Settings value during core loading.
- Packaged macOS PNG and ICNS assets MUST preserve transparent corners around the app-icon silhouette so Finder volumes and Dock icons do not render an opaque square frame.
- macOS uses an inset hidden title bar with the native traffic-light controls. AgentEnv MUST NOT recreate window controls in renderer content; the sidebar and primary content share one top safe inset, the complete empty top strip on both sides plus page-heading whitespace provide draggable regions, and every interactive descendant remains clickable through explicit no-drag regions.
- Primary commands and lifecycle state remain visible.
- Switching workspaces MUST NOT resize or reposition global chrome. Sidebar, brand lockup, navigation rows, status card, page gutter, first-level page titles, and page-header control height use shared geometry at a given viewport.
- Sidebar navigation icons and labels MUST share the vertical center of their fixed selection surface. Padding, icon slots, and text line boxes MUST fit inside that height rather than enlarging or overflowing it.
- The sidebar Agent summary shows at most three Agent icons inline. Additional Agents collapse into a `+N` disclosure whose hover and keyboard-focus popover shows every hidden Agent's icon, name, and current status without becoming a second navigation entry.
- Agent summary icons and the `+N` disclosure use the shared `28px` square geometry and render as optical circles. Flex pressure, localized text, focus, hover, and an open popover MUST NOT change either axis or the circular silhouette.
- Workspace-specific content MAY use its own density only inside the stable page content region.
- Page-level creation and import commands remain in the page header. A resource list MUST NOT repeat the page title and primary command inside a nested header.
- First-level pages use the shared page-header anatomy: one title, optional concise context or help, then one right-aligned command group. Page titles use the same type scale and left origin across workspaces.
- Reusable resources use one reading order: `identity -> metadata -> lifecycle state -> contextual actions`. Identity includes a fixed `32px` icon box, name, and at most one visible supporting line; longer content remains available through the selectable overflow tooltip.
- Standard resource rows use the shared `52px`, `60px`, or `68px` density tokens. A page MAY choose a denser table only when comparison across named columns is the primary task, as in Skills Library.
- A lifecycle state owns a stable lane and MUST NOT move into the action lane when another value is absent. State labels MUST fit without ellipsis; long explanations belong in a tooltip or focused review surface.
- Resource rows expose at most one direct contextual command plus a trailing overflow menu. Destructive, settings, and infrequent commands belong in that menu. Inline icon commands use shared `32px` hit targets and always have accessible names and tooltips.
- Accent fill identifies only the current page-level primary command or the next commit action. Lists MUST NOT contain repeated primary-filled actions unless each row is an independent queued workflow.
- A populated Profiles workspace keeps `New Profile` neutral because Save or Apply owns the commit emphasis; an empty Profiles workspace MAY promote `New Profile` to the primary action. Available Skill updates use a neutral compact review action, while the update confirmation dialog owns the filled commit action.
- The Library page uses `Skills` as its interactive page title; `Library` is neutral scope text and MUST NOT resemble a clickable breadcrumb.
- Skills Library uses one stable five-lane reading order at every supported width: `Skill -> Source -> Usage -> Status -> Actions`. Source includes version metadata, Usage combines Profile references with Agent installs, and Status exposes only the highest-priority current maintenance action while retaining complete details in selectable overflow help.
- Skills quick tabs are limited to `All`, `Updates`, and `Disabled`. Source, Usage, and Agent-install filters live in one on-demand filter region, while `Update all` is rendered only when an update can actually be reviewed.
- Disabled Skills remain readable and use one neutral row treatment plus the explicit `Disabled` status. They MUST NOT accumulate decorative grayscale, inset rules, badges, and opacity effects, and they are excluded from Updates and non-All Usage filters.
- Profile MCP rows use `name -> native source/status -> activation choice`. Definition editing and deletion are intentionally absent because those actions belong to the source Agent.
- Profile Composer resource triggers remain `52px` high before, during, and after expansion. Expanding one resource MUST NOT compress, hide metadata from, or reposition its sibling triggers. The expanded trigger and editor surface MUST be visually distinguishable from ordinary collapsed rows without turning the editor into a nested card.
- Profile Skills with zero or one item fit their content without stretching empty list space. Larger collections grow only within the available editor region and keep the Skill list as the scroll owner.
- Agents use one continuous ordered management list at every supported width, with ordinary healthy state rendered as quiet metadata rather than a filled badge or separate card. Diagnostics expands to the full width of its owning Agent, shifts only later rows, leaves no peer-column void, and opening a second Diagnostics region closes the first.
- Settings renders ordinary preferences as stable `name and explanation -> control` rows. Labels are never detached into a separate alignment scheme, and toggles, selects, read-only values, and numeric inputs share one right-hand control lane.
- At narrow widths, Profile readiness is read before its Save and Apply command group. Secondary Profile commands MUST NOT duplicate a direct command already visible beside the selected Profile name, and expanded Skills and MCP resources share one flat list hierarchy rather than introducing resource-specific nested cards.
- Comparable actions in one command group use the same control height; Profile Save and Apply also reserve the same width so lifecycle state changes do not shift surrounding content.
- A related command group MAY move below its heading at narrower supported widths, but its individual controls MUST remain together rather than orphan-wrapping one control onto another line.
- Profile rows keep one stable hierarchy at default and minimum sizes: name, one-line description, resource counts, and optional deployment state. Responsive rules MAY truncate long values but MUST NOT remove these semantic layers.
- Every Profile row shares fixed icon and content columns. Selection, dirty/current badges, hover, and long-name truncation MUST NOT move the icon, name, description, counts, or deployment text origin.
- Profile list icons use one consistent compact slot and icon family. Decorative per-row icon colors MUST NOT imply unsupported categories or state.
- Profile icons MAY use the shared built-in task-oriented icon set. Changing a Profile icon auto-saves identity metadata, preserves any unsaved environment draft, and MUST NOT enable or bypass whole-Profile Save.
- Icon pickers MUST use one shared component, expose the selected state without color alone, remain topmost inside the viewport, and close on selection, Escape, or safe outside click.
- Lists and expanded editors own intentional internal scrolling. In Library/Skills, page chrome, metrics, tabs, filters, and table header stay fixed; only the Skill table body scrolls, with no document or editor-panel scrolling.
- Visual verification pairs the same viewport and data immediately before and after an interaction. Numeric containment and computed geometry are necessary evidence, but optical shape, hierarchy, emphasis, and layout stability also require inspection of the rendered pixels. Zero, one, and many-resource captures MUST use the same build artifact as the corresponding Electron E2E.
- Expanding a Profile Composer section MUST expose a practically editable panel at the minimum viewport; presence of a clipped panel alone does not satisfy the interaction contract.
- Collapsed Profile Composer rows stay content-sized and compact; they MUST NOT expand merely to fill unused editor height. The resource rows themselves provide sufficient context, so the Composer MUST NOT add a redundant visible title block above them.
- Target recovery history is a low-frequency safety workflow. Targets exposes it through a page-level Recovery command and a focused modal, rather than permanently consuming the primary Target list viewport.
- Profile Save and Apply remain visible while the selected Profile's Composer owns internal scrolling.
- The selected Profile header separates object identity from commit controls at widths where they cannot coexist without truncation. Save, Apply, Agent selection, and overflow remain one unbroken command group; readiness text receives its own line instead of shrinking into an unreadable fragment.
- Local Skill Cleanup is a review list, not a secondary resource library. Its rows show Skill identity, one compact state, the current safe next action, and overflow. Full paths, duplicate details, and alternate versions belong in Details or Review; History is an integrated list section rather than a visually unrelated card.
- Buttons do not wrap at supported desktop widths.
- Text line boxes, icon boxes, and control padding MUST fit inside their controls without vertical clipping.
- A framed work surface has one edge owner painted above its scrolling children. Toolbars, rows, backgrounds, and scroll regions MUST stay inside that edge and MUST NOT redraw, cover, or visually interrupt any side or corner.
- Composite icon-and-input controls draw one border on the parent control. Their transparent borderless input remains inside the parent's content box and MUST NOT cover the parent edge at any supported width.
- Apply Preview keeps its header and footer stable. The modal owns the primary vertical scroll; large resource plans remain bounded, and long diff lines own only their horizontal overflow.
- Create from Target keeps its step header and action footer visible at both supported viewports. Only the dialog body scrolls; resource groups MUST NOT introduce a second nested scroll region.
- Menus, tooltips, and dialogs remain above rows and inside the visible viewport.
- Context menus use one surface, `220px` width, shared item height, icon alignment, and danger treatment. Selection grids such as icon pickers are the only intentional menu-layout exception.
- Focused dialogs use one stable header/body/footer anatomy. The header identifies the task, the body owns scrolling, and the footer keeps neutral cancellation beside one primary continuation or destructive confirmation.
- Peer actions with equal consequence use the same neutral treatment. Accent fill is reserved for the current primary commit or flow-advance action; Target `Capture` and `Profiles` are neutral peers.
- Settings switches sit beside the setting label they control, with supporting copy on the following line; they MUST NOT float as visually detached controls at the far edge of a wide row.
- Hover/focus tooltips are mutually exclusive. Long-text tooltips allow pointer entry and native text selection for copying, then close after the pointer leaves both trigger and tooltip.
- Modal dialogs trap keyboard focus until they close.
- Escape closes dismissible layers; safe outside click closes them; focus returns to the trigger or the next logical surviving control.
- Primary workflows work with keyboard only.
- Status is never communicated through color alone.
- Dynamic visible copy and accessible labels use the active locale. Truncated Profile descriptions use the shared selectable overflow detail instead of native browser title tooltips.
- Renderer styling follows one ordered cascade contract: accessibility, tokens, base, frozen legacy, primitives, shell, pages, and overlays.
- New page behavior MUST be owned by its page stylesheet or a shared primitive; the frozen legacy stylesheet MUST NOT grow and the retired product-level override file MUST NOT return.
- Skills and Profiles respond to their actual content containers, not only the outer window width.

Status: supported viewport containment, topmost overlays, modal focus trapping, Escape and outside-click dismissal, and focus restoration are `Implemented`.

## 22. Security And Privacy Contract

- All data remains local unless the user explicitly accesses GitHub or opens an external URL.
- Renderer-requested external links MUST be validated by the main process and limited to `http` and `https` URLs.
- GitHub OAuth tokens are stored using the operating system's secure credential facility when available.
- Secrets MUST NOT appear in renderer logs, main-process logs, Preview diff, screenshots, or global feedback.
- Profile Save MUST reject literal credentials detected in Instructions and direct the user to environment references. Legacy native content is excluded during v2 migration, and every Preview is redacted before crossing the preload boundary.
- Preview redaction MUST replace sensitive before/after values and regenerate the rendered diff from those redacted values while the main process retains the original internal plan only for the guarded Apply operation.
- Managed Backup roots and individual Backup directories MUST be enforced as owner-only (`0700`) storage.
- File writes use validated IDs and paths and MUST prevent path traversal.
- Symlink operations MUST not escape approved Library and Target roots.
- AgentEnv MUST never modify agent authentication files such as Codex `auth.json`.
- Real Target writes require authoritative installation evidence and a writable destination; missing directories MAY be created only inside adapter-declared roots.

## 23. Target Adapter Contract

A new Target adapter MUST define:

- Stable Target ID and display metadata.
- Platform-aware installation discovery with one or more authoritative evidence probes.
- All managed and scanned instruction and Skill paths.
- A default v2 Profile representation.
- Instructions read, preview, and write behavior.
- Skill capability and install methods.
- A read-only Skill runtime driver declaring roots, scan depth, scope, runtime identity, native disable facts, and external ownership markers.
- Native MCP discovery scope and safe activation capability.
- An exact allowlist for any MCP activation field the adapter may patch; no generic native-config payload is accepted.
- Preview generation.
- Managed-resource ownership markers.
- Backup path enumeration.
- Apply, drift, and rollback behavior.
- Cross-Target capability declarations.

Registration MUST occur in the Target registry. Renderer components MUST NOT require Target-specific branches for ordinary lifecycle behavior.

Target Skill drivers report facts only. They MUST NOT import Library content, mutate Profile state, deploy files, remove legacy paths, or create backups. The core owns Save, Preview, Backup, atomic Apply, post-write verification, and Rollback through one Agent-neutral operation model. Agent-specific behavior belongs behind the adapter; Agent-specific buttons and Target ID branches do not belong in the renderer.

Runtime snapshots are the single source for Skill discovery, runtime identity, availability, location role, and runtime issues. Library inventory MAY enrich those observations with Library relationships, ignore rules, content hashes, and external-manager evidence, but MUST NOT independently reinterpret Agent runtime behavior. Broken links and unreadable Skill manifests remain visible as unavailable, review-only inventory and MUST NOT enter automatic import, cleanup, replacement, or deletion flows.

Legacy migration eligibility is both path- and Target-owned. A shared copy carrying another Target's AgentEnv ownership marker is observable but MUST NOT be removed, replaced, or claimed by the current Target.

Antigravity's implemented global scope manages `~/.gemini/GEMINI.md` and
`~/.gemini/antigravity-cli/skills`. It observes `~/.gemini/skills` as a shared compatibility
location and treats the former `~/.gemini/config/skills` destination as legacy. Apply previews,
backs up, removes, verifies, and can roll back only AgentEnv-owned legacy copies; unowned legacy
content remains untouched. Antigravity CLI readiness requires authoritative `agy` command evidence;
the Antigravity desktop application is a separate product and is not sufficient. AgentEnv discovers
MCP names from `~/.gemini/config/mcp_config.json` without mutating that file. Secret-bearing headers, OAuth configuration, literal
environment values, and all other MCP definition fields remain Agent-owned.

Trae CLI's implemented global scope manages `~/.trae/AGENTS.md` and
`~/.trae/skills`. It observes the documented user aliases `~/.coco/skills` and
`~/.trae-cn/skills` without deploying into them; additional `AGENTS.md` aliases under
`~/.coco`, `~/.trae-cn`, and `~/.agents` remain Agent-owned and are disclosed during
Capture and Preview. Readiness accepts the unambiguous official command aliases `traecli`,
`trae-cli`, and `trae-agent`; the short `ta` alias is not authoritative because of collision risk.
AgentEnv discovers user MCP definitions from the current CLI file `~/.trae/trae_cli.yaml`
and `~/.trae/mcp.json`. A unique selected server MAY change only its `disabled` scalar.
The documented alternate `~/.trae/traecli.yaml` is read-only. A same-name server in more
than one user source is Agent-controlled and blocks a persisted Profile switch until the user
keeps one definition or chooses `Use Agent setting`. MCP command, URL, headers, environment,
credentials, unknown fields, project sources, plugins, and built-ins remain Agent-owned.

## 23.1 AgentEnv Data Lifecycle

- AgentEnv data has an explicit format version. Runtime Profile reads accept only v2.
- A v1 or unversioned non-empty data root MUST be fully copied to an external sibling migration-backup directory before conversion. Profile conversion writes only the three canonical v2 files atomically; legacy Profile-owned Skills become self-contained Library copies; native configuration and unsupported resources remain only in the backup and migration report.
- Migration MUST write the v2 root manifest last. An unsafe path, unsupported future version, backup failure, or global conversion failure leaves the old version marker intact so startup fails closed or can retry without interpreting partial data as v2. A malformed individual Profile or Target state remains byte-for-byte intact, is recorded in the migration report, and enters the normal repair/recovery state without blocking valid data from moving to v2.
- Partially completed conversion steps MUST be idempotent: already converted Profiles and Target states are accepted on retry, and imported Skills are reused by comparable content hash.
- The application MUST NOT retain an active v1 execution path after successful migration.
- The user can create a private directory backup from Settings.
- Backups include a manifest with format version and creation time.
- GitHub credentials remain encrypted for the originating Mac and MUST NOT be presented as portable plaintext.
- Corrupt or unsupported future data MUST fail closed with recovery guidance rather than being partially loaded.
- A restore/import flow MUST deeply validate Profiles, Skills, Settings, and deployment state before mutation; create a safety backup before replacing current canonical data; reject unsafe links or unsupported formats; validate the active data again after replacement; automatically restore the safety backup if that validation fails; and refresh all visible canonical state after success. Unknown legacy files remain inert and are preserved by whole-data backups.
- One malformed Profile MUST remain visible as needing repair without hiding usable Profiles or blocking creation of a valid first Profile. It MUST NOT be silently interpreted as an empty Profile.
- Malformed deployment state MUST surface `Recovery required` and block Preview, Apply, rollback, and ownership changes until repaired. It MUST NOT be treated as an unmanaged Target.
- Malformed native Skill or MCP state MUST surface an inspection error and block unsafe mutation. It MUST NOT be rendered or planned as a confirmed empty state.
- AgentEnv permits only one application instance and one data-root mutation at a time. A lock outside the replaceable data root protects startup migration, writes, backup cleanup, and restore; dead owner locks MAY be recovered explicitly.
- Canonical JSON/text writes use same-directory temporary files and atomic rename. Directory replacement prepares a complete sibling staging path, records a recovery journal, preserves the previous path until the swap succeeds, and repairs interrupted swaps at startup.
- Private data directories use owner-only permissions where the platform supports them; canonical text and credential files are written with owner-only permissions by default.
- Profile deletion moves the Profile into AgentEnv's private trash area rather than permanently removing it immediately. Skill cleanup, update, and deletion retain restorable backup data.
- Backup manifests and IDs are validated before restore, and restore paths are limited to adapter-declared Target locations and AgentEnv-owned canonical locations. A malformed or tampered backup fails closed before any destination is modified.
- A clean application window closes without waiting for renderer acknowledgement. Only an unsaved Profile draft enables the close guard; Cancel keeps the window and draft intact, while Save or Discard completes the pending close explicitly.

## 23.2 First-Run Workflow

The first useful journey is:

1. Detect installed Targets.
2. Scan existing local Skills.
3. Consolidate, ignore, or leave discovered Skills unmanaged.
4. Create or select a Profile.
5. Choose a deployment Target.
6. Review the effective payload, conflicts, ownership changes, and takeover impact.
7. Apply and verify the persisted Target result.

The product MAY use contextual empty states for this journey; it MUST NOT require a marketing-style onboarding page.

## 23.3 Localization Contract

AgentEnv Manager supports English (`en`), Simplified Chinese (`zh_CN`), and Traditional Chinese (`zh_TW`).

- A new or migrated installation MUST default to the system language. Unsupported system languages fall back to English.
- `zh-Hant`, `zh-TW`, `zh-HK`, and `zh-MO` system locales resolve to Traditional Chinese; other Chinese locales resolve to Simplified Chinese.
- Settings MUST expose a persistent choice between System default and each supported language. Changing it updates the interface immediately without restarting the application.
- Navigation, commands, lifecycle states, validation, feedback, dialogs, tooltips, empty states, and accessibility labels MUST use the selected interface language.
- User-authored names, descriptions, instructions, paths, source URLs, command output, and third-party error details MUST remain unchanged.
- Dates and numbers MUST use the resolved locale. Product identity, Target names, protocol names, file names, and code tokens MAY remain untranslated.
- Missing translations MUST fall back to the English source message and MUST NOT render an empty label or localization key.
- Every statically discoverable renderer message MUST have a Simplified Chinese entry with the same interpolation placeholders. The translation audit is a release gate; Traditional Chinese continues to derive from that complete dictionary plus explicit terminology overrides.
- Packaged builds MUST retain only the Electron locale bundles required by the supported interface languages.

## 24. Required Acceptance Matrix

Every release that changes Profile, Library, Target, or Apply behavior MUST verify these scenarios:

### Profile and Agent

- First launch enables every currently supported Agent and persists the explicit scope.
- Turning one Agent off removes only that Agent from navigation, Profile destinations, discovery, Capture, Apply, lifecycle state, and Agent-specific Skill scans; its files and saved state remain byte-for-byte unchanged.
- Turning every Agent off leaves Library and Profiles usable while hiding Agent-only navigation and deployment commands.
- A disabled Agent rejects direct IPC Preview, Apply, Capture, rollback, and stop-management requests.
- Reload preserves the enabled Agent scope; re-enabling an Agent performs fresh discovery and restores its controls.
- A managed Agent requires confirmation before being turned off, and an Agent requiring recovery cannot be turned off.
- One v2 Profile applied to each compatible Target; preferred Target changes default context only.
- One Profile active on multiple Targets.
- Different Profiles active on different Targets.
- Switching active Profile removes only previous managed resources.
- Identical second Preview produces no changes and no Apply action.
- Dirty Profile blocks Preview and preserves draft.
- Active Profile is selected for the chosen Target without changing persisted creation-time ordering; a single installed Target is static context.
- Disabling a Skill in Library preserves its content and every existing Profile reference, hides it from every Add Skill picker, excludes it from update checks and effective Apply payloads, and leaves it visible but locked in Profiles until globally enabled again.
- Library status views are mutually exclusive. `Updates` includes only enabled, tracked Skills with a confirmed available update; `Referenced` and `Unreferenced` describe only enabled Skills and Profile references without claiming deployment state; globally disabled Skills appear only in `All` and `Disabled`. Disabled rows MUST differ from active rows through surface, edge, icon treatment, and state text rather than a badge alone.
- Enabling or disabling a Library Skill MUST expose row-local working feedback, lock duplicate availability commands, and update both the visible row and persisted metadata before reporting success.
- A globally disabled Skill is removed from managed Target installs on the next Apply of each affected Profile; global disable itself MUST NOT silently rewrite Target environments.
- Disabling a referenced Library Skill in a Profile is a normal Profile edit: it preserves the reference, marks the whole Profile dirty, and MUST require the same Save, Preview, and Apply flow as adding or removing a Skill.
- Applying a disabled Profile Skill previews and removes only its managed Target copy; re-enabling previews and restores it. The switch MUST NOT write to a Target before Apply succeeds.
- Profile-scoped update Check excludes disabled and untracked references while a Library update discloses cross-Profile and Copy versus Live link impact.
- Missing executable and missing directory are distinguished.
- Copy mode keeps Library updates pending; Live link mode visibly propagates them immediately.
- Create from Target captures portable resources, reuses exact Library matches, and leaves Target files and deployment state unchanged.
- Create from Target MUST retain AgentEnv-owned legacy Skills as migration inputs so the first Apply cannot remove a legacy copy without installing the captured Skill into its current runtime location.
- Ignored resources and unsupported native data remain Target-owned after Create from Target.
- Applying the same Library Skill to OpenCode, Codex, Claude Code, Antigravity, and Trae CLI creates isolated Target-specific runtime copies.
- Create from Target followed by first Apply isolates a Target Skills root that aliases a shared directory, preserves the shared destination byte-for-byte, installs Target-owned child references, and restores the original root link through Rollback.
- Create from Target followed by first Apply adopts an exact Agent-private duplicate transactionally even when an identical shared compatibility copy remains active; Rollback restores the original unowned private copy and shared content byte-for-byte.
- The machine-local Capture receipt is consumed after that first successful Apply. Missing, malformed, stale, or content-mismatched evidence never expands replacement authority.
- Any Skill inventory fact used by Preview changing before Apply invalidates the whole deployment plan. An approved unmanaged copy is checked against its Preview content hash again inside the Adapter immediately before replacement.
- Shared compatibility copies remain unchanged during capture; later removal requires the explicit reviewed Scan local cleanup workflow.
- Adding a shared compatibility Skill to Library keeps one shared runtime copy active and removes redundant Target-specific copies. Apply prepares each installed consumer without creating duplicate runtime copies; Replace shared copy then performs one backed-up, verified cross-Target switch without deleting Library content.

### Cross-Target

- Instructions and Library Skills serialize correctly; native MCP policies remain Target-specific.
- Preferred Target and created-from provenance never restrict compatible deployment.
- Empty Instructions and all-Off resource choices remain valid complete replacement states and Preview their removals or disable operations explicitly.
- Unsupported portable resources block with remediation.
- `Leave unchanged` performs no MCP read, hash, diff, Backup, write, or ownership retention and ignores retained editor selections in the Profile hash.
- Native MCP discovery includes credential-bearing entries without copying secrets; Codex, OpenCode, and Trae CLI change only verified activation state; Claude Code and Antigravity remain Agent-controlled.
- Managed MCP On/present, On/missing, Off/present, Off/missing, and absent-selection cases follow the sparse policy matrix.
- Codex native disabled Skill detection accepts both runtime-name and manifest-path entries; either form blocks a Profile that expects the disabled Skill to run.
- Source Target remains unchanged.

### Drift and stale data

- External edits to Instructions, managed Skill, managed MCP activation fields, and ownership state are detected. Shared configuration files expose managed-field changes through Preview without treating unrelated Agent-owned edits as drift.
- Preview becomes stale after Profile, Library, Target, or state changes.
- Explicit overwrite backs up drift.
- Rollback restores both content and lifecycle state.

### Library

- Local import survives deletion of original folder.
- GitHub direct-Skill, containing-directory, and repository scan; candidate selection; partial import; rate limit; sign-in remediation; update check; Preview; and update.
- GitHub Device Flow pending, focus return, `slow_down`, expiry, denial, and successful account-state refresh without overlapping network polls.
- System Git repository, directory, and direct-Skill scan; HTTPS/SSH/local transport; ref selection; partial import; cancellation; subtree update detection; Preview; backup; cache rebuild; credential redaction; and packaged-app Git discovery.
- Local and GitHub per-Skill update policies, legacy defaults, disabled-source isolation, and persistence.
- Library global disable persistence, update-check exclusion, Add Skill picker filtering, existing-reference visibility, and Apply-time managed-copy removal.
- In-place toolbar and `Cmd/Ctrl+R` Refresh preserve current Skill view state and do not contact update sources.
- Skill source-default and custom icons persist across refresh and content update; Profile icon changes auto-save independently without clearing or committing a dirty environment draft.
- Skills CLI v3 lock detection, corrupt and unsupported lock fallback, directory and broken symlink discovery, independent external import, lock preservation, and external Apply conflicts.
- Update marks affected deployments pending without deploying.
- Duplicate, conflict, ignored, linked, copied, and stale-copy states.
- Referenced resource deletion is blocked.
- Managed-install deletion is undoable; unmanaged copies remain.

### Failure and recovery

- Failure before writes.
- Failure after text write but before asset completion.
- Successful automatic restore.
- Failed automatic restore enters Recovery required.
- Permission denied, source missing, target missing, offline GitHub, and partial bulk update.

### UI and accessibility

- Empty, one-item, long-content, 50, 100, and 500-item cases where relevant.
- Default and minimum viewport without document overflow.
- Skill table headers and every data row MUST share one column contract; contextual actions MUST NOT resize preceding columns. Compact width uses a visible grouped header and retains Skill, source, version, Profile usage, update, install, and action information rather than hiding columns.
- Version, update, usage, and install metadata MUST use aligned first- and second-line tracks, including empty states and truncated values.
- The Profile Target selector uses the selected Target name as its visible label without a redundant `Target:` prefix; its accessible name retains the full command meaning.
- First and last row menus are topmost and in viewport.
- Escape, outside click, keyboard focus, and focus restoration.
- Working, success, warning, error, no-op, drift, destructive, and recovery states are inspected visually.
- Profile Skill toggles respond from the in-memory draft without a data reload; Save immediately shows working feedback and enables Apply after persistence; Preview immediately shows working feedback and opens without duplicate inventory scans.
- System locale detection, explicit `en`/`zh_CN`/`zh_TW` switching, persisted reload, and unsupported-locale fallback.
- Default and minimum viewport containment in all supported interface languages, including long Traditional Chinese labels.
- Profile switching at the minimum viewport preserves editor geometry through loading and never exposes a false empty state.

E2E assertions MUST verify persisted files and state, not only successful clicks.

## 25. Production Release Gate

AgentEnv Manager is production-ready only when all of these are true:

- No ambiguous destructive behavior.
- Apply Preview covers every affected resource type.
- No-op, stale, drift, failure, and rollback paths are verified.
- Active Profile deletion has a complete resolution path.
- Stop Managing is available and recoverable.
- Recovery required state exists for failed automatic restoration.
- MCP secrets are masked and protected.
- All supported Targets pass native and cross-Target contract tests.
- Default and minimum desktop viewports pass containment and overlay checks.
- Packaged Electron application passes a real startup and primary-workflow smoke test.
- The packaged Agent discovery smoke runs with a Finder-style minimal `PATH` and proves fallback discovery for OpenCode, Claude Code, Codex, Antigravity CLI, and Trae CLI.

Current verdict: **Needs refinement**. Core Skill Library, v2 Profile, Preview, transactional Apply, backup, retention, rollback, stale rollback protection, no-op, cross-Target Instructions and Skills, Create from Target, Target-specific Skill deployment, compatibility-copy consolidation, canonical Target lifecycle, data backup and restore, active-Profile deletion recovery, Stop Managing workflows, and sparse native MCP activation are functional. Broader Skill identity edge coverage and signed/notarized distribution remain release work.

### 25.1 Verification Snapshot

The current machine-readable totals, source commit, dirty state, viewport list, capture count, audit results, and packaged-smoke status are generated by `npm run verify:product` in [`verification-snapshot.json`](verification-snapshot.json). Run `npm run verify:product -- --packaged` for a release candidate so the same snapshot also records the packaged workflow.

- The automated suite covers preferred-Target and cross-Target use, Create from Target, real Electron UI, progressive startup, localization persistence and completeness, stable Profile loading, scoped feedback, stale Preview, rollback, recovery, MCP ownership release, and externally replaced managed-Skill recovery scenarios.
- The CSS architecture gate passed with fourteen named container queries, no numeric `z-index` declarations, and no `!important` outside the reduced-motion contract.
- Fixed-state visual captures are regenerated through the Electron compositor at the supported default and minimum viewports, including the stable Profile loading state, sidebar Agent overflow, Profile icon selection, Profile Skill selection and applied revisions, native MCP Profile states, available-update rows, disabled, empty, Chinese locale, source-specific Import, shared-Skill management guidance, Agent Diagnostics, and focused update-setting states.
- Skills, Profiles, Agents, and Settings passed shared chrome and control-geometry checks at `1180 x 728` and `920 x 620` without document overflow.
- The macOS inset hidden title bar, native-control safe area, full-width draggable top chrome, draggable page headings, and no-drag interactive controls passed main-process configuration and real Electron geometry assertions.
- Shared page headers, vertically centered navigation rows, uninterrupted work-surface edges, contained composite search fields, `32px` resource identities, compact/default row heights, Profile commit controls, MCP rows, Cleanup state/action lanes, `220px` context menus, and Apply resource rows passed cross-workspace geometry and overflow assertions.
- Dirty Profile navigation passed persisted Save, Discard, and Cancel outcomes; Stop Managing passed persisted file-retention and ownership-detachment checks.
- System-picker data backup and restore, pre-takeover restoration, read-only and missing Targets, missing Skill sources, offline and rate-limited GitHub checks, and partial bulk updates passed Electron E2E coverage.
- First-row and floating layers, modal Escape, outside click, focus trapping, and focus restoration passed Electron E2E coverage.
- Target-row capture preserves the Targets workspace until confirmation; setup, Back, local failure recovery, grouped capture review, and a 30-resource minimum-viewport stress case keep the action footer visible with one scrolling body.
- Library deletion isolates the selected Skill from invalid neighboring content, and global feedback provides a non-blocking copy action.
- Local imports remain usable after their original path is removed; per-Skill update-check defaults, opt-out persistence, and GitHub re-enable flows passed Store and Electron E2E coverage.
- In-place Skill Refresh, sequential GitHub directory import with per-item progress and partial failure, source-default Skill icons, custom Skill icon persistence, and independently auto-saved Profile identity metadata passed Store, renderer, and Electron E2E coverage.
- Skill Import source modes, compact row command menus, focused update settings, compact MCP rows, overflow-only MCP deletion, resource-first Apply Preview, and neutral Capture outcomes passed renderer, Electron E2E, and visual capture coverage.
- Library Skill disable, picker exclusion, update-check isolation, re-enable, and Apply-time Target removal and restoration passed Store, renderer, and Electron E2E coverage; Profile Skill switches use the same Save and Apply contract as Add and Remove.
- Skill table headers, compact grouped headers, retained version metadata, mixed-action rows, aligned metadata, empty install states, update labels, action-to-detail clearance, compact non-truncating Cleanup badges, equal-width Cleanup actions, and status-tooltip clearance passed coordinate, overlap, and overflow assertions at both supported viewports.
- Target-local import now creates a transactional managed install, shared managed paths deduplicate across Target scans, and auto-ready cleanup groups pass single, bulk, conflict-exclusion, persistence, backup, and responsive-layout coverage.
- Codex Capture now reuses identical Library Skills and previews a stable alternate ID for different same-name content instead of failing during Save. Unmanaged same-name OpenCode and Claude Code Skill destinations remain blocked until an exact fresh Preview is acknowledged, then pass Backup, atomic replacement, ownership, and recovery assertions; Skills CLI-owned paths remain protected.
- Local Skill cleanup distinguishes Library-managed, external, retained, and conflict states; consolidation remains transactional, preserves backup history, and never treats a cleanup choice as a Profile Apply omission.
- Native MCP discovery includes all configured names without copying credential values. OpenCode, Codex, and Trae CLI Apply change only native activation fields, preserve definitions added outside AgentEnv, block an enabled missing definition, treat a disabled missing definition as a no-op, and produce a real no-op when states already match. Trae CLI additionally blocks ambiguous same-name definitions across its user files.
- Claude Code and Antigravity expose Agent-owned MCPs read-only. Antigravity CLI requires `agy`, applies and rolls back `GEMINI.md` and dedicated CLI Skills, transactionally migrates AgentEnv-owned legacy Skill copies, and leaves `mcp_config.json` unchanged.
- All five built-in adapters expose the same read-only Skill runtime contract. Tests cover direct and recursive discovery, symlink-cycle safety, frontmatter runtime identity, duplicate declarations, Claude plugin ownership, duplicate desired runtime names, Antigravity legacy migration with rollback, and Trae CLI primary and alias runtime locations. Profile Skill On/Off is represented only by managed install presence, never by an Agent configuration switch.
- GitHub Device Flow respects server polling intervals, absorbs `slow_down` as a longer pending interval, blocks overlapping token requests, and refreshes connected account state after browser authorization.
- Apply Preview summary cards contain long warning paths at both supported viewports without overlapping adjacent cards; Configuration changes is a keyboard-focusable review action that opens the first collapsed diff without widening the dialog.
- Profile list icon and content columns remain aligned at the minimum viewport, and a deliberately long truncated Profile name keeps the same text origin before and after selection.
- JSON/JSONC, TOML, YAML, assignment-style, token-prefix, and private-key detection reject new literal credentials; legacy Preview before/after/diff payloads are redacted before reaching the renderer.
- Drift recovery adopts compatible Instructions and existing managed MCP activation choices into a backed-up Profile while naming excluded native configuration and unmapped items.
- Production dependency audit reported zero known vulnerabilities.
- The packaged arm64 macOS application completed an isolated OpenCode Profile takeover at `1180 x 728` without document overflow or writes to the real Agent environment.
- The signed release entry point requires a Developer ID Application identity and Apple notarization credentials, then verifies `codesign`, Gatekeeper assessment, and the stapled DMG. Signed and notarized artifact verification remains outstanding until those external credentials are available; the local packaged primary-workflow smoke uses an unsigned `.app`.

## 26. Current Priority Gaps

1. Validate the one-time v1-to-v2 migration against an anonymized production-shaped data export and a packaged startup.
2. Extend the conditional duplicate review with more uncommon intentionally distinct same-name Skill fixtures.
3. Sign and notarize macOS distribution, then repeat packaged primary-workflow verification on a clean Mac.
