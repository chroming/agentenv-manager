# AgentEnv Manager Product Contract

Date: 2026-07-12  
Status: Authoritative product contract  
Audience: Product, design, engineering, QA, and target-adapter contributors

## 1. Purpose

AgentEnv Manager is a local-first desktop application for cleaning reusable agent resources, composing them into Profiles, and safely deploying a complete Profile to local agent tools.

The product succeeds when a user can answer all of these questions without inspecting implementation files:

1. Which resources are canonical and reusable?
2. What does this Profile contain?
3. Which Target will receive it?
4. What exactly will be added, replaced, removed, or preserved?
5. Is the deployed Target still identical to the saved Profile?
6. How can the user recover or stop AgentEnv management?

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
- Implying that a Profile can only be used by its native Target.
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

The Library is global to AgentEnv Manager and contains canonical reusable resources.

- Skill Library owns canonical Skill content and update metadata.
- MCP Library owns reusable MCP definitions.
- Library content MUST NOT be duplicated into every Profile.
- A Profile stores references to Library resources, not private copies of them.
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
- A compatibility copy is switched only through an explicit Scan local migration action after every installed consumer Target has applied a current preparation; Capture never removes it as a side effect.
- Completing migration MUST create one restorable backup for the shared paths, every affected Target path, and every affected Target state. It removes the shared paths first, deploys or omits the Skill according to each prepared Profile, verifies the result, and restores the whole transaction on any failure.
- AgentEnv MUST NOT edit per-Agent configuration to suppress duplicate discovery during this migration.
- `Keep shared` is a path-scoped migration decision. It MUST NOT ignore or alter same-name copies in Target-specific directories.
- A compatibility copy with conflicting content blocks automatic consolidation.
- External manager metadata, including Skills CLI lock files, is read-only evidence. AgentEnv MUST NOT silently edit or delete another manager's lock data.
- Importing an externally managed Skill creates an independent Library copy and MUST NOT imply that AgentEnv has taken ownership of the external installation.

### 4.3 Profile

A Profile is a saved environment recipe. It owns:

- Instructions.
- References to Library Skills.
- References to Library MCP servers.
- Optional Profile-owned Skills.
- Optional native Advanced configuration.
- Optional native Target-specific resources such as Agents or disabled Skill paths.

A Profile has one **native Target format** used to edit and validate native Advanced data. It MAY be applied to any supported Target. Native Target does not mean exclusive deployment Target.

Source of truth: the saved Profile directory in AgentEnv data.

Each Library Skill reference has a Profile-scoped enabled state. Missing legacy state means enabled.

- Turning a Skill off MUST preserve the reference and its Library content; it removes the Skill only from that Profile's effective payload.
- Turning a Skill back on MUST restore the same reference without another Library import or picker flow.
- A disabled Skill MUST NOT be deployed, validated as a desired Target resource, counted as an effective resource, or recorded in applied Library versions.
- Enable and disable are Profile edits: they become durable on Save and affect a Target only after Preview and Apply.

### 4.4 Target

A Target is a detected local agent tool and its deployment locations. OpenCode, Codex, and Claude Code are Targets.

- Target files are deployed copies, links, or serialized output.
- Target files are never the canonical Library source.
- A Target can have at most one active Profile at a time.
- One Profile can be active on multiple Targets simultaneously.
- A Target can be modified by AgentEnv Manager, the agent itself, or another local process.

### 4.5 Backup

A Backup is an immutable pre-operation snapshot used for recovery.

- Backup belongs to one operation and records its Profile and Target when applicable.
- Backup is not a Profile and MUST NOT silently become canonical content.
- A no-op MUST NOT create a Backup.

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

### 5.3 MCP Identity

- MCP Library ID is the canonical identity used by Profile references.
- MCP Library ID is immutable after creation. Renaming changes the display name, not the ID.
- Creating an MCP definition with an existing ID MUST fail visibly and MUST NOT overwrite it.
- A Profile MAY map a Library MCP ID to a Target-specific name.
- Two MCP resources resolving to the same Target name MUST block Apply unless they are semantically identical and explicitly deduplicated.

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
| Preview | Compute a fresh, complete deployment plan against current Profile, Library, and Target state. It does not write. |
| Apply | Transactionally replace the AgentEnv-managed Target environment with the selected saved Profile after Preview, using compensating rollback when a multi-path write fails. |
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
| Drifted | Managed Target files changed outside AgentEnv. | Review drift. |

Rules:

- Save MUST persist the complete Profile, not an individual accordion section.
- Save and Apply MUST appear as one ordered action group in the selected Profile context: Save first, then Apply. Page creation and Target selection controls MUST NOT separate these two lifecycle commands.
- Save and Apply MUST keep stable labels and positions. A dirty Profile highlights Save and disables Apply; after Save, Save is disabled and Apply becomes the primary action.
- Edit, Duplicate, Delete, Save, and Apply are selected-Profile commands and MUST remain inside the selected Profile surface. The Profiles page header owns only page creation and Target context.
- Every Profile row MUST list all Targets currently using that Profile, even when legacy deployment state has no application timestamp. Each Target is visibly distinguished as current, pending, or needing attention.
- Selected-Target lifecycle status belongs beside Save and Apply inside the selected Profile surface. It MUST NOT be repeated as a separate page-level summary strip.
- Unsaved changes MUST block Preview and Apply.
- Switching Profile, Target, workspace, or closing the window with a dirty draft MUST offer Save, Discard, or Cancel.
- Failed validation or Save MUST preserve all draft input.
- Applying a Profile MUST NOT change its native Target format.
- When exactly one installed Target is available, Profiles MUST show it as stable context instead of an option menu. When multiple installed Targets are available, Target selection remains available.
- On entry, Profiles SHOULD select the chosen Target's active Profile, pin it first in the list, mark it Current, and open its Skills section for the common single-Target workflow.
- Profile Skills MUST expose enabled and disabled Library references in one compact list. Check checks only enabled tracked references in that Profile; Add selects Library references; Remove detaches a reference from the Profile without deleting Library content.
- Updating from Profile Skills still updates the global Library copy. The update confirmation MUST disclose how many Profiles reference it and whether Copy or Live link mode changes installed Targets immediately.

Status: whole-Profile Save, dirty protection, per-Target applied hashes, active-Profile focus, and Profile-scoped Skill enablement are `Implemented`. Adopting native live Instructions is `Implemented`; adoption of other compatible surfaces is `Partial`.

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

| Profile resource | Native Target | Different Target | Preview requirement |
| --- | --- | --- | --- |
| Instructions | Serialize to native instruction path. | Reuse content and serialize to destination instruction path. | Show destination file and diff. |
| Library Skill | Install through destination Skill capability. | Portable when destination supports Skills. | Show install, replace, remove, or conflict. |
| Profile-owned Skill | Install through destination Skill capability. | Portable when its format is generic and destination supports Skills. | Show source and destination. |
| Library MCP | Serialize through destination MCP capability. | Portable when transport and fields are supported. | Show resulting MCP entry and unsupported fields. |
| Raw Advanced config | Apply only to native Target. | Omit. | Warning naming source, destination, and omitted surface. |
| Target-specific Agent | Apply only when destination adapter declares compatible Agent format. | Omit by default. | Warning with omitted count and names. |
| Disabled Skill paths | Apply only when destination supports equivalent semantics. | Omit by default. | Warning with omitted setting. |
| Unmanaged local resource | Never becomes Profile content automatically. | Preserve unless it conflicts with a desired managed path. | Show preserved warning or blocking conflict. |

Rules:

- Unsupported portable content MUST either block Apply or be explicitly omitted with a warning. It MUST NOT be silently coerced.
- Cross-Target Preview MUST calculate an effective payload. A zero-payload deployment is blocked, and material omissions require explicit acknowledgement.
- Cross-Target Preview MUST show the final destination representation, not only the source Profile.
- Adding a Target MUST require a single adapter plus contract tests for capabilities, paths, serialization, preview, Apply, drift, and rollback.
- An adapter MUST NOT receive raw Advanced configuration from another Target.

Status: adapter capability declaration, effective-payload review, omission acknowledgement, and safe cross-Target Instructions, Skills, and MCP deployment are `Implemented`.

## 10. Preview Contract

Preview is the sole write gate for Profile deployment.

Preview MUST:

1. Use the latest saved Profile.
2. Resolve current canonical Library versions.
3. Read current Target files and deployment state.
4. Describe every managed text and resource change.
5. Group changes as add, replace, remove, preserve, omit, warning, or blocking conflict.
6. Include destination paths and human-readable resource identities.
7. Indicate whether the Target is being taken over or switched.
8. Leave the Target unchanged.

A Preview becomes stale when any of these changes:

- Saved Profile content.
- Referenced Library content or definition.
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

It MUST:

1. Revalidate Preview freshness immediately before writing.
2. Create a Backup of every affected live path and deployment state.
3. Write all planned text resources.
4. Install, replace, or remove all planned managed resources.
5. Preserve unrelated unmanaged resources.
6. Write deployment state only after all resource writes succeed.
7. Record one history entry only after success.
8. Refresh visible Profile and Target state after completion.

Switching Profiles MUST remove resources owned by the previously active Profile when they are absent from the new Profile. Unmanaged resources MUST remain untouched unless they occupy a required destination, in which case Apply is blocked.

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

Cross-Target deployments MUST NOT adopt native Advanced data into a Profile of another format automatically.

Status: detection, diff inspection, explicit overwrite with Backup, native Instructions adoption, and detach choices are `Implemented`. Selective adoption of other native resource types is `Partial`.

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
- A failed rollback enters `Recovery required`.

Status: Apply and cleanup rollback plus stale rollback conflict handling are `Implemented`; retention controls are `Required`.

## 16. Skill Library Contract

### 16.1 Import

- Import from a local folder copies canonical content into the Library.
- When the selected local folder is an adapter-declared Target Skill location, Import MUST back it up and replace it with a managed link or copy in the same transaction. A successfully managed source MUST NOT remain in Needs attention as a duplicate.
- Local folders outside supported Target locations remain independent provenance sources and are not modified.
- Normal use MUST continue if the original folder is later deleted.
- The original local path is retained as provenance, but local imports default to the `Untracked` update policy.
- A user MAY explicitly track a stable local folder as an update source.
- GitHub import MUST store repository, ref, directory, and resolved revision.
- GitHub imports default to the `Tracked` update policy.
- A GitHub URL MAY identify a Skill directory, a containing directory, or a repository. Containing-directory and repository imports MUST scan recursively for valid top-level Skill roots before any Library write.
- Scan results MUST appear in a confirmation dialog, select all importable candidates by default, allow individual candidates to be excluded, and identify already-imported or duplicate candidates without selecting them. The bulk-selection control MUST expose all, mixed, and none states while keeping its label and selected count aligned without overlap at the minimum supported viewport.
- A batch import MUST preserve successful candidates when another candidate fails and MUST report each failure against its source.
- Every Skill has an independent `Tracked` or `Untracked` update policy. `Untracked` excludes that Skill from manual, startup, and scheduled checks without reading its local source or contacting GitHub.
- The UI status for this durable policy is `Not tracked`; temporary wording such as `Checks off` and source-type wording such as `Fixed copy` MUST NOT substitute for the policy.
- The global auto-check setting controls scheduling only; it never overrides a per-Skill `Untracked` policy.
- Legacy metadata without an explicit policy defaults to `Untracked` for local sources and `Tracked` for GitHub sources.
- Import validates `SKILL.md` and rejects unsafe or ambiguous directory layouts.
- Local import MUST distinguish a non-destructive `Import copy` from `Import & manage` for a folder already inside a Target. Before `Import & manage`, the UI discloses that AgentEnv will back up the Target copy, import it to Library, and replace that location with a managed installation.
- A selected Target folder that is already managed, ignored, or conflicts with an existing Library version MUST block generic import and direct the user to Scan local for the appropriate resolution.
- A failed local or external import MUST preserve the selected source and keep its dialog open so the user can retry or inspect the global error.
- The Library Skill icon defaults to its source type and MAY be replaced by a built-in icon. The selected icon is presentation metadata and MUST survive content updates.
- `SKILL.md` frontmatter MUST be parsed as YAML rather than with line-oriented string matching. Folded, quoted, and multiline values remain valid.

### 16.1.1 Refresh

- `Refresh` rescans canonical Library content and local install state; it does not contact tracked update sources.
- `Check updates` is the separate command that contacts tracked sources.
- `Cmd/Ctrl+R` in Library/Skills invokes the same in-place Refresh command and MUST NOT reload the renderer.
- Refresh MUST preserve the current search, filters, scroll context, and rendered Skill list until replacement data is ready. It MUST NOT flash a temporary empty state.
- Update and install-repair commands MUST appear in their semantic `Updates` and `Installs` columns. The `Actions` column is reserved for the overflow menu and MUST NOT compete with labelled row actions for width.

### 16.2 Scan And Cleanup

Scan MUST inspect every adapter-declared Skill location and group results by canonical Skill identity and content.

The Local Skill Cleanup surface owns unresolved local-state counts and group details; Library/Skills MUST NOT duplicate a `Needs attention` summary above the table. While the cleanup surface is open, `Refresh` MUST run a new filesystem scan in place, retain the surface, and expose its working and completion states.

Scan MAY read supported versions of `$XDG_STATE_HOME/skills/.skill-lock.json` and `~/.agents/.skill-lock.json` to identify Skills CLI ownership and recover upstream provenance. Unsupported or corrupt lock data MUST degrade to ordinary filesystem scanning and MUST NOT block unrelated Skills.

Each group can be:

- Consolidated into the Library.
- Linked or copied back to selected Targets.
- Left unmanaged.
- Ignored.

Resolution contract:

- Groups are classified as `Auto-ready`, `Review`, or resolved. Needs attention counts unresolved groups, not raw paths, and excludes managed and ignored groups.
- A single unmanaged copy, identical unmanaged duplicates, a local copy that exactly matches Library, and stale managed copies MAY be handled automatically because no content choice is required.
- Differing content, a local copy that differs from an existing Library version, external-manager ownership, and missing Target identity MUST remain in manual Review.
- `Take over` is an immediate, mutating action for Target-specific locations: it backs up the affected locations, creates or reuses the Library copy, and replaces every eligible detected copy with an AgentEnv-owned installation. It MUST NOT replace a shared compatibility location. `Review` opens a decision dialog and MUST NOT mutate files by itself. `Details` is read-only and remains available for every group.
- `Take over all` backs up and processes every currently auto-ready group. A failure in one group MUST NOT undo successful independent groups, and the result MUST report both completed and remaining groups.
- `Take over all` is shown only when at least one group is currently eligible. While it is running, the initiating control exposes a local working state and conflicting cleanup actions are disabled until the refreshed result is available.
- After a successful takeover, every selected location MUST rescan as current and `Managed`; the group MUST NOT retain `Duplicate`, `Auto-ready`, or another takeover action. A managed group may remain visible for inspection through `Details`, but it is not pending work.
- AgentEnv ownership is attached to the physical managed installation. A shared compatibility path scanned by multiple Targets MUST appear as one managed location rather than a duplicate caused by Target-specific scanning.
- A physical location shared by multiple Target adapters MUST be labelled as shared in cleanup review instead of presenting the Target names as separate copies.

Shared compatibility migration contract:

- A shared compatibility group has one of six explicit states: `Shared source`, `Preparing Targets`, `Ready to switch`, `Kept shared`, `External`, or `Conflict`.
- The group shows Library import status and every installed consumer Target as either `Needs Apply` or `Prepared`.
- Every `Needs Apply` Target is an action, not a passive badge. It MUST open Profiles with that Target selected and, when the Target has an active Profile, open that Profile's Skills section so the required migration decision can be saved and applied.
- `Import copy` is non-destructive: it copies the selected shared content into Library and leaves the shared path untouched.
- `Preparing Targets` remains until every installed adapter-declared consumer has applied a current Profile that records whether the Skill will be installed or omitted after cutover. Preparation MUST leave the shared path active and MUST NOT create a same-name Target-specific duplicate.
- `Ready to switch` requires an exact Library copy and a non-stale preparation for every installed consumer. Current Profile hashes and Library versions MUST be revalidated in the main process, not only by renderer state.
- `Complete migration` requires confirmation that lists each prepared Target's final `Install as <name>` or `Do not install` decision. It executes one cross-Target transaction: back up all shared, destination, and state paths; remove the shared source; deploy or omit per prepared Profile; verify every destination; then clear preparations. Any failed step restores all paths and states.
- Cleanup history exposes the completed shared migration as one restorable operation. Restore returns shared paths, Target paths, and preparation state to their pre-migration state.
- `Keep shared` records a path-scoped decision and resolves the group without changing files. `Review again` removes only that decision.
- Shared compatibility groups MUST NOT participate in `Take over all` or generic duplicate cleanup.

Cleanup review contract:

- If the Skill is not yet in Library, the user chooses the local version whose content will be preserved as the Library source of truth.
- The chosen source location is always included in the cleanup and cannot be deselected accidentally.
- If the Skill already exists in Library, cleanup MUST state that the existing Library version remains authoritative and MUST NOT ask for a meaningless local canonical choice.
- Every truncated Skill name, description, path, and history detail in the cleanup workflow exposes its full value on pointer hover and keyboard focus.
- Cleanup groups and Cleanup history use the same row hierarchy, control scale, overflow behavior, and restore vocabulary.
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
- Directory symlinks and broken tracked symlinks remain visible in Scan results.
- `Import copy` copies a selected healthy external installation into Library, preserves verified upstream metadata, and leaves the external files and lock unchanged.
- External installations MUST NOT enter the ordinary cleanup transaction that replaces selected locations with AgentEnv-managed copies.
- A desired Profile Skill occupying an externally managed Target path blocks Apply with the manager, path, and required recovery action identified.

### 16.3 Update

- Check compares only against an explicit update source.
- A tracked online source MUST expose its complete address on hover and keyboard focus and provide a clearly identified command that opens the address in the system browser.
- GitHub rate limiting MUST provide a GitHub sign-in remediation.
- Update Preview MUST show changed files and validation errors.
- Applying a Library update changes canonical content.
- In optional Copy mode, Profiles remain saved and their deployed Targets become `Changes pending`; copied installs require explicit synchronization or Profile Apply.
- In default Live link mode, linked Target content changes immediately. The UI MUST disclose this behavior and MUST NOT represent the linked deployment as an immutable applied snapshot.
- Local imports without an explicit tracked source MUST NOT produce repeated update failures.
- A Profile-scoped Check MUST inspect only enabled tracked Skills referenced by that Profile. Disabled, missing, and untracked references remain visible but MUST NOT trigger network or filesystem checks.

### 16.4 Delete

- A Skill referenced by any Profile MUST NOT be deleted.
- The user is directed to affected Profiles.
- Deleting an unreferenced Skill explicitly includes or excludes its managed Target installs.
- Unmanaged copies are never deleted.
- Deletion with managed installs creates an undoable Backup.

Status: local and recursive GitHub import, in-place Refresh, per-Skill update policy, YAML frontmatter, read-only Skills CLI detection, external copy import, scan, cleanup, ignore, GitHub update, icon metadata, reference blocking, managed-install removal, and undo are `Implemented`; external-manager takeover and identity edge cases need broader contract tests.

## 17. MCP Library Contract

- MCP definitions are global reusable resources.
- A Profile stores references and optional Target names.
- Creation and editing are distinct modes. Editing MUST keep the referenced MCP ID fixed.
- Target adapters serialize supported transports and fields.
- Remote MCP URLs MUST use `http` or `https`.
- Stdio credentials are represented only as validated environment variable names, never values. OpenCode receives environment substitutions, Claude Code receives variable expansion references, and Codex receives parent-environment forwarding.
- Remote credentials are not stored as generic environment fields. Authentication unsupported by the Library model remains configured in the destination Target.
- Unsupported transport or fields block Apply unless omission is explicitly accepted.
- Updating an MCP definition marks affected deployments `Changes pending` but does not deploy.
- An MCP used by any Profile MUST NOT be deleted.
- Environment values that appear secret MUST be masked in UI, Preview, logs, and diagnostics.
- Backups containing secrets MUST remain local and use restrictive filesystem permissions.

Status: reusable references, immutable identity, deletion protection, portable stdio environment references, and remote URL validation are `Implemented`; richer remote authentication and broad secret masking are `Partial`.

## 18. Create From Target Contract

Create from Target gives an existing native environment a reusable Profile representation before the user decides whether AgentEnv should manage it.

- Capture MUST read only paths declared by the selected Target adapter.
- A Target-row capture command MUST keep the invoking Targets workspace visible until the user confirms. Cancel and Escape return focus to that exact command without changing workspace.
- Target-row command hierarchy follows lifecycle state: an unmanaged Target presents `Capture` as the primary action and Profiles as secondary; a managed Target presents `Open Profile` as the primary action and Capture as secondary. Both commands remain available without competing primary emphasis.
- Profiles may offer a general `From Target` entry, but a Target-row entry MUST bind the source Target directly and MUST NOT ask the user to choose Blank versus From Target again.
- Capture uses two explicit steps: setup and capture review. Review provides Back without losing the Profile name or selected Target.
- Preview MUST list portable resources to include or reuse, new Library imports, excluded resources, and conflicts.
- Capture review MUST summarize Profile resources, Library imports, and zero source changes before the detailed resource list.
- Blocking errors and excluded-resource advisories MUST appear before long resource details. Repeated warnings MUST be aggregated with expandable details.
- Review and Save expose local working and error states. Review MUST enter a visible animated busy state immediately, keep the action geometry stable, expose `aria-busy`, and block duplicate submission until the preview resolves. A stale or failed review remains in the dialog and offers `Refresh review`.
- Profile Instructions and Advanced configuration remain in the source Target's native format. Reusable Skills and supported MCP definitions become Library references.
- Existing Library content is reused only when its comparable content hash or semantic MCP definition matches exactly.
- Sensitive values, credentials, caches, history, runtime state, and unsupported native fields MUST remain Target-owned and MUST be named as excluded.
- Ignored Skills remain in place and are excluded from the new Profile.
- Duplicate active runtime copies with identical content MAY be represented by one Library reference, but every source copy remains unchanged. Same-name copies with different content block capture because the canonical content is ambiguous.
- Preview becomes stale when any captured source path changes before confirmation.
- Saving a captured Profile MUST NOT invoke Apply, create a Target Backup or deployment state, add ownership markers, delete a source path, or write Target history.
- A successful capture opens the new Profile in `Saved, never applied` state. The user may inspect or edit it before using the standard Preview and Apply contract.
- Takeover, backup, Target-specific deployment, and managed-resource replacement occur only during the later explicit Apply. Local duplicate cleanup remains an explicit Scan local workflow.
- Failure while saving MUST remove the partially created Profile and newly imported Library resources while leaving the Target unchanged.

Status: OpenCode, Codex, and Claude Code adapter capture, reviewed Library import, stale protection, source preservation, and saved-never-applied handoff are `Implemented`.

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
- Success feedback expires after approximately five seconds.
- Errors persist until dismissed or resolved.
- A newer warning or error replaces stale success feedback.
- Completion updates visible persisted state, not only a message.
- No visible command may appear to do nothing.
- Global feedback MUST NOT block unrelated workspace controls. Only actions owned by the feedback surface, such as Dismiss or Connect GitHub, receive pointer input.

Status: shared transient success, persistent error, background progress, GitHub remediation, and non-blocking global feedback are `Implemented`.

## 21. Desktop Interaction Contract

- Supported minimum content viewport is `920 x 620` at 100% scale.
- Default content viewport is `1180 x 728`.
- No supported viewport has page-level horizontal scrolling.
- Layout verification MUST measure document and owned scroll-region overflow, child containment, text fit, sibling control overlap, and floating-layer stacking; successful clicks alone do not satisfy this contract.
- The Electron compositor, document root, and application shell MUST paint the complete content viewport with the page background; short pages and navigation transitions MUST NOT expose an unpainted window background.
- Electron MUST NOT expose an empty renderer frame during cold start. Its compositor background matches the application surface, and the HTML shell provides a branded, reduced-motion-aware launch state before React mounts without delaying foreground renderer scheduling.
- Startup loads Library Skills independently from Target discovery. Local core data for Skills, MCP Servers, Profiles, Targets, and Settings becomes usable before GitHub update checks, local inventory scans, and derived Profile usage finish; those background enrichments MUST merge into the visible UI without replacing it with an empty state.
- Renderer startup MUST NOT synchronously open duplicate browser-side persistence. Locale begins from the operating system and then adopts the authoritative local Settings value during core loading.
- Packaged macOS PNG and ICNS assets MUST preserve transparent corners around the app-icon silhouette so Finder volumes and Dock icons do not render an opaque square frame.
- Primary commands and lifecycle state remain visible.
- Switching workspaces MUST NOT resize or reposition global chrome. Sidebar, brand lockup, navigation rows, status card, page gutter, first-level page titles, and page-header control height use shared geometry at a given viewport.
- Workspace-specific content MAY use its own density only inside the stable page content region.
- Page-level creation and import commands remain in the page header. A resource list MUST NOT repeat the page title and primary command inside a nested header.
- Comparable actions in one command group use the same control height; Profile Save and Apply also reserve the same width so lifecycle state changes do not shift surrounding content.
- A related command group MAY move below its heading at narrower supported widths, but its individual controls MUST remain together rather than orphan-wrapping one control onto another line.
- Profile rows keep one stable hierarchy at default and minimum sizes: name, one-line description, resource counts, and optional deployment state. Responsive rules MAY truncate long values but MUST NOT remove these semantic layers.
- Profile list icons use one consistent compact slot and icon family. Decorative per-row icon colors MUST NOT imply unsupported categories or state.
- Profile icons MAY use the shared built-in icon set. Changing a Profile icon modifies the Profile draft, follows dirty-navigation protection, and is persisted only by whole-Profile Save.
- Icon pickers MUST use one shared component, expose the selected state without color alone, remain topmost inside the viewport, and close on selection, Escape, or safe outside click.
- Lists and expanded editors own intentional internal scrolling.
- Expanding a Profile Composer section MUST expose a practically editable panel at the minimum viewport; presence of a clipped panel alone does not satisfy the interaction contract.
- Collapsed Profile Composer rows stay content-sized and compact; they MUST NOT expand merely to fill unused editor height. The resource rows themselves provide sufficient context, so the Composer MUST NOT add a redundant visible title block above them.
- Target recovery history is a low-frequency safety workflow. Targets exposes it through a page-level Recovery command and a focused modal, rather than permanently consuming the primary Target list viewport.
- Profile Save and Apply remain visible while the selected Profile's Composer owns internal scrolling.
- Buttons do not wrap at supported desktop widths.
- Text line boxes, icon boxes, and control padding MUST fit inside their controls without vertical clipping.
- Apply Preview keeps its header and footer stable while summary, resources, and diffs own bounded internal scrolling.
- Create from Target keeps its step header and action footer visible at both supported viewports. Only the dialog body scrolls; resource groups MUST NOT introduce a second nested scroll region.
- Menus, tooltips, and dialogs remain above rows and inside the visible viewport.
- Modal dialogs trap keyboard focus until they close.
- Escape closes dismissible layers; safe outside click closes them; focus returns to the trigger or the next logical surviving control.
- Primary workflows work with keyboard only.
- Status is never communicated through color alone.
- Renderer styling follows one ordered cascade contract: accessibility, tokens, base, frozen legacy, primitives, shell, pages, and overlays.
- New page behavior MUST be owned by its page stylesheet or a shared primitive; the frozen legacy stylesheet MUST NOT grow and the retired product-level override file MUST NOT return.
- Skills and Profiles respond to their actual content containers, not only the outer window width.

Status: supported viewport containment, topmost overlays, modal focus trapping, Escape and outside-click dismissal, and focus restoration are `Implemented`.

## 22. Security And Privacy Contract

- All data remains local unless the user explicitly accesses GitHub or opens an external URL.
- Renderer-requested external links MUST be validated by the main process and limited to `http` and `https` URLs.
- GitHub OAuth tokens are stored using the operating system's secure credential facility when available.
- Secrets MUST NOT appear in renderer logs, main-process logs, Preview diff, screenshots, or global feedback.
- File writes use validated IDs and paths and MUST prevent path traversal.
- Symlink operations MUST not escape approved Library and Target roots.
- AgentEnv MUST never modify agent authentication files such as Codex `auth.json`.
- Real Target writes require an installed executable and writable destination; missing directories MAY be created only inside adapter-declared roots.

## 23. Target Adapter Contract

A new Target adapter MUST define:

- Stable Target ID and display metadata.
- Executable discovery.
- All managed and scanned paths.
- Default native Profile representation.
- Read/write and validation behavior.
- Instructions capability.
- Skill capability and install methods.
- MCP transports and field mapping.
- Agent capability, if any.
- Native Advanced configuration ownership.
- Preview generation.
- Managed-resource ownership markers.
- Backup path enumeration.
- Apply, drift, and rollback behavior.
- Cross-Target capability declarations.

Registration MUST occur in the Target registry. Renderer components MUST NOT require Target-specific branches for ordinary lifecycle behavior.

## 23.1 AgentEnv Data Lifecycle

- AgentEnv data has an explicit format version and migration path.
- Legacy storage migration MUST preserve Profiles, Library content, deployment state, Settings, and Backups.
- The user can create a private directory backup from Settings.
- Backups include a manifest with format version and creation time.
- GitHub credentials remain encrypted for the originating Mac and MUST NOT be presented as portable plaintext.
- Corrupt or unsupported future data MUST fail closed with recovery guidance rather than being partially loaded.
- A restore/import flow MUST create a safety backup before replacing current canonical data, reject unsafe links or unsupported formats, and refresh all visible canonical state after success.

## 23.2 First-Run Workflow

The first useful journey is:

1. Detect installed Targets.
2. Scan existing local Skills.
3. Consolidate, ignore, or leave discovered Skills unmanaged.
4. Create or select a Profile.
5. Choose a deployment Target.
6. Review effective payload, omissions, conflicts, and takeover impact.
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
- Packaged builds MUST retain only the Electron locale bundles required by the supported interface languages.

## 24. Required Acceptance Matrix

Every release that changes Profile, Library, Target, or Apply behavior MUST verify these scenarios:

### Profile and Target

- Native Profile applied to each compatible Target.
- One Profile active on multiple Targets.
- Different Profiles active on different Targets.
- Switching active Profile removes only previous managed resources.
- Identical second Preview produces no changes and no Apply action.
- Dirty Profile blocks Preview and preserves draft.
- Active Profile is selected and pinned for the chosen Target; a single installed Target is static context.
- Disabling a Skill in Library preserves its content and every existing Profile reference, hides it from every Add Skill picker, excludes it from update checks and effective Apply payloads, and leaves it visible but locked in Profiles until globally enabled again.
- Library status views are mutually exclusive. `Updates` includes only enabled, tracked Skills with a confirmed available update; `Referenced` and `Unreferenced` describe Profile references without claiming deployment state; `Disabled` is the durable management entry for globally unavailable Skills.
- Enabling or disabling a Library Skill MUST expose row-local working feedback, lock duplicate availability commands, and update both the visible row and persisted metadata before reporting success.
- A globally disabled Skill is removed from managed Target installs on the next Apply of each affected Profile; global disable itself MUST NOT silently rewrite Target environments.
- Disabling a referenced Library Skill in a Profile is a normal Profile edit: it preserves the reference, marks the whole Profile dirty, and MUST require the same Save, Preview, and Apply flow as adding or removing a Skill.
- Applying a disabled Profile Skill previews and removes only its managed Target copy; re-enabling previews and restores it. The switch MUST NOT write to a Target before Apply succeeds.
- Profile-scoped update Check excludes disabled and untracked references while a Library update discloses cross-Profile and Copy versus Live link impact.
- Missing executable and missing directory are distinguished.
- Copy mode keeps Library updates pending; Live link mode visibly propagates them immediately.
- Create from Target captures portable resources, reuses exact Library matches, and leaves Target files and deployment state unchanged.
- Ignored resources and unsupported native data remain Target-owned after Create from Target.
- Applying the same Library Skill to OpenCode, Codex, and Claude Code creates isolated Target-specific runtime copies.
- Shared compatibility copies remain unchanged during capture; later removal requires the explicit reviewed Scan local cleanup workflow.
- Importing a shared compatibility Skill leaves the source untouched. Apply prepares each installed consumer without creating duplicate runtime copies; Complete migration then performs one backed-up, verified cross-Target switch without deleting Library content.

### Cross-Target

- Instructions, Library Skills, Profile-owned Skills, and MCP serialize correctly.
- Native Advanced config, incompatible Agents, and disabled paths are omitted with named warnings.
- Zero effective payload is blocked and material omissions require confirmation.
- Unsupported portable resources block with remediation.
- MCP duplicate IDs, immutable edit identity, remote URL validation, and Target-specific environment-reference serialization.
- Source Target remains unchanged.

### Drift and stale data

- External edits to Instructions, config, Skill, Agent, and ownership state are detected.
- Preview becomes stale after Profile, Library, Target, or state changes.
- Explicit overwrite backs up drift.
- Rollback restores both content and lifecycle state.

### Library

- Local import survives deletion of original folder.
- GitHub direct-Skill, containing-directory, and repository scan; candidate selection; partial import; rate limit; sign-in remediation; update check; Preview; and update.
- Local and GitHub per-Skill update policies, legacy defaults, disabled-source isolation, and persistence.
- Library global disable persistence, update-check exclusion, Add Skill picker filtering, existing-reference visibility, and Apply-time managed-copy removal.
- In-place toolbar and `Cmd/Ctrl+R` Refresh preserve current Skill view state and do not contact update sources.
- Skill source-default and custom icons persist across refresh and content update; Profile icon changes remain dirty until whole-Profile Save.
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
- Skill table headers and every data row MUST share one column contract; contextual actions MUST NOT resize preceding columns.
- Version, update, usage, and install metadata MUST use aligned first- and second-line tracks, including empty states and truncated values.
- The Profile Target selector uses the selected Target name as its visible label without a redundant `Target:` prefix; its accessible name retains the full command meaning.
- First and last row menus are topmost and in viewport.
- Escape, outside click, keyboard focus, and focus restoration.
- Working, success, warning, error, no-op, drift, destructive, and recovery states are inspected visually.
- System locale detection, explicit `en`/`zh_CN`/`zh_TW` switching, persisted reload, and unsupported-locale fallback.
- Default and minimum viewport containment in all supported interface languages, including long Traditional Chinese labels.

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

Current verdict: **Needs refinement**. Core Library, Profile, Preview, transactional Apply, backup, rollback, stale rollback protection, no-op, cross-Target payload review, Create from Target, Target-specific Skill deployment, compatibility-copy consolidation, canonical Target lifecycle, data backup and restore, native Instructions adoption, active-Profile deletion recovery, Stop Managing workflows, and portable MCP environment references are functional. Richer remote MCP authentication, complete secret handling, and broader drift adoption remain release requirements.

### 25.1 Verification Snapshot

Last verified: 2026-07-15 against the current `main` tree at the time of this snapshot.

- `366` automated tests passed across `48` test files; the `72`-test Electron UI suite and `79` total E2E tests cover native Target, cross-Target, Create from Target, real Electron UI, progressive startup, localization persistence, stale Preview, rollback, and recovery scenarios.
- The CSS architecture gate passed with two named container queries, no numeric `z-index` declarations, and no `!important` outside the reduced-motion contract.
- All `39` fixed-state visual captures were regenerated through the Electron compositor and reviewed at the supported default and minimum viewports.
- Skills, MCP Servers, Profiles, Targets, and Settings passed shared chrome and control-geometry checks at `1180 x 728` and `920 x 620` without document overflow.
- Dirty Profile navigation passed persisted Save, Discard, and Cancel outcomes; Stop Managing passed persisted file-retention and ownership-detachment checks.
- System-picker data backup and restore, pre-takeover restoration, read-only and missing Targets, missing Skill sources, offline and rate-limited GitHub checks, and partial bulk updates passed Electron E2E coverage.
- First-row and floating layers, modal Escape, outside click, focus trapping, and focus restoration passed Electron E2E coverage.
- Target-row capture preserves the Targets workspace until confirmation; setup, Back, local failure recovery, grouped capture review, and a 30-resource minimum-viewport stress case keep the action footer visible with one scrolling body.
- Library deletion isolates the selected Skill from invalid neighboring content, and global feedback provides a non-blocking copy action.
- Local imports remain usable after their original path is removed; per-Skill update-check defaults, opt-out persistence, and GitHub re-enable flows passed Store and Electron E2E coverage.
- In-place Skill Refresh, GitHub directory candidate selection, partial batch import behavior, source-default Skill icons, custom Skill icon persistence, and draft-gated Profile icons passed Store, renderer, and Electron E2E coverage.
- Library Skill disable, picker exclusion, update-check isolation, re-enable, and Apply-time Target removal and restoration passed Store, renderer, and Electron E2E coverage; Profile Skill switches use the same Save and Apply contract as Add and Remove.
- Skill table headers, mixed-action rows, two-line metadata, empty install states, and update labels passed coordinate and overflow assertions at both supported viewports.
- Target-local import now creates a transactional managed install, shared managed paths deduplicate across Target scans, and auto-ready cleanup groups pass single, bulk, conflict-exclusion, persistence, backup, and responsive-layout coverage.
- Shared compatibility migration now distinguishes imported, preparing, ready, retained, external, and conflict states; Apply records per-Target install or omit intent without duplicate runtime copies, and Electron E2E verifies early-switch blocking, transactional cutover, backup history, and full restore.
- MCP creation blocks duplicate IDs, editing preserves reference identity, stdio environment references serialize without secret values for OpenCode, Claude Code, and Codex, and remote URLs reject unsafe protocols.
- Apply Preview summary cards contain long warning paths at both supported viewports without overlapping adjacent cards.
- Production dependency audit reported zero known vulnerabilities.
- The packaged arm64 macOS application completed an isolated OpenCode Profile takeover at `1180 x 728` without document overflow or writes to the real Agent environment.
- Signed and notarized distribution verification remains outstanding; the local packaged primary-workflow smoke uses an unsigned `.app`.

## 26. Current Priority Gaps

1. Add richer remote MCP authentication, complete secret masking, and backup permission guarantees.
2. Add explicit Backup retention controls.
3. Extend Adopt into Profile beyond native Instructions where the adapter can map changes safely.
4. Migrate persisted Profile terminology from `targetId` to `nativeTargetId` with backward compatibility.
5. Broaden Skill identity contract tests for same-ID conflicts and different-ID identical-content candidates.
