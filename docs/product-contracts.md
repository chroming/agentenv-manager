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
- Live link mode is an explicit advanced policy: Library updates immediately affect linked Target Skills and therefore do not provide an Apply-gated snapshot.

Source of truth: `~/.config/agentenv-manager` or the configured AgentEnv data root.

### 4.2 Profile

A Profile is a saved environment recipe. It owns:

- Instructions.
- References to Library Skills.
- References to Library MCP servers.
- Optional Profile-owned Skills.
- Optional native Advanced configuration.
- Optional native Target-specific resources such as Agents or disabled Skill paths.

A Profile has one **native Target format** used to edit and validate native Advanced data. It MAY be applied to any supported Target. Native Target does not mean exclusive deployment Target.

Source of truth: the saved Profile directory in AgentEnv data.

### 4.3 Target

A Target is a detected local agent tool and its deployment locations. OpenCode, Codex, and Claude Code are Targets.

- Target files are deployed copies, links, or serialized output.
- Target files are never the canonical Library source.
- A Target can have at most one active Profile at a time.
- One Profile can be active on multiple Targets simultaneously.
- A Target can be modified by AgentEnv Manager, the agent itself, or another local process.

### 4.4 Backup

A Backup is an immutable pre-operation snapshot used for recovery.

- Backup belongs to one operation and records its Profile and Target when applicable.
- Backup is not a Profile and MUST NOT silently become canonical content.
- A no-op MUST NOT create a Backup.

### 4.5 Deployment State

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
- Unsaved changes MUST block Preview and Apply.
- Switching Profile, Target, workspace, or closing the window with a dirty draft MUST offer Save, Discard, or Cancel.
- Failed validation or Save MUST preserve all draft input.
- Applying a Profile MUST NOT change its native Target format.

Status: whole-Profile Save, dirty protection, and per-Target applied hashes are `Implemented`. Adopting native live Instructions is `Implemented`; adoption of other compatible surfaces is `Partial`.

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
- A successful rollback MUST refresh Target lifecycle and active Profile metadata.
- Backups MUST be retained until explicitly removed by the user or a documented retention policy.
- A failed rollback enters `Recovery required`.

Status: Apply and cleanup rollback plus stale rollback conflict handling are `Implemented`; retention controls are `Required`.

## 16. Skill Library Contract

### 16.1 Import

- Import from a local folder copies canonical content into the Library.
- Normal use MUST continue if the original folder is later deleted.
- The original local path is provenance, not an automatic update source.
- A user MAY explicitly track a stable local folder as an update source.
- GitHub import MUST store repository, ref, directory, and resolved revision.
- Import validates `SKILL.md` and rejects unsafe or ambiguous directory layouts.

### 16.2 Scan And Cleanup

Scan MUST inspect every adapter-declared Skill location and group results by canonical Skill identity and content.

Each group can be:

- Consolidated into the Library.
- Linked or copied back to selected Targets.
- Left unmanaged.
- Ignored.

Ignore contract:

- Ignored Skills remain visible in cleanup results.
- Ignore does not grant ownership to AgentEnv.
- Apply preserves ignored Skills that do not conflict.
- An ignored Skill occupying a desired managed destination blocks Apply.
- Ignore rules can be removed without rescanning data loss.

### 16.3 Update

- Check compares only against an explicit update source.
- GitHub rate limiting MUST provide a GitHub sign-in remediation.
- Update Preview MUST show changed files and validation errors.
- Applying a Library update changes canonical content.
- In the default Copy mode, Profiles remain saved and their deployed Targets become `Changes pending`; copied installs require explicit synchronization or Profile Apply.
- In advanced Live link mode, linked Target content changes immediately. The UI MUST disclose this before enabling the mode and MUST NOT represent the linked deployment as an immutable applied snapshot.
- Local imports without an explicit tracked source MUST NOT produce repeated update failures.

### 16.4 Delete

- A Skill referenced by any Profile MUST NOT be deleted.
- The user is directed to affected Profiles.
- Deleting an unreferenced Skill explicitly includes or excludes its managed Target installs.
- Unmanaged copies are never deleted.
- Deletion with managed installs creates an undoable Backup.

Status: import, scan, cleanup, ignore, GitHub update, reference blocking, managed-install removal, and undo are `Implemented`; identity edge cases need broader contract tests.

## 17. MCP Library Contract

- MCP definitions are global reusable resources.
- A Profile stores references and optional Target names.
- Target adapters serialize supported transports and fields.
- Unsupported transport or fields block Apply unless omission is explicitly accepted.
- Updating an MCP definition marks affected deployments `Changes pending` but does not deploy.
- An MCP used by any Profile MUST NOT be deleted.
- Environment values that appear secret MUST be masked in UI, Preview, logs, and diagnostics.
- Backups containing secrets MUST remain local and use restrictive filesystem permissions.

Status: reusable references and deletion protection are `Implemented`; capability validation and secret handling are `Partial`.

## 18. Profile Deletion Contract

- Delete removes the saved Profile recipe only.
- Delete is blocked while the Profile is active on any Target.
- The blocking dialog MUST list all affected Targets, not only the first one.
- The user MUST be able to navigate to each Target and choose Apply another Profile or Stop Managing.
- Backups and history remain available after Profile deletion and retain the deleted display name as historical metadata.

Status: deletion blocking, complete affected-Target disclosure, and navigation to Target resolution are `Implemented`.

## 19. Feedback Contract

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

## 20. Desktop Interaction Contract

- Supported minimum content viewport is `920 x 620` at 100% scale.
- Default content viewport is `1180 x 728`.
- No supported viewport has page-level horizontal scrolling.
- Primary commands and lifecycle state remain visible.
- Lists and expanded editors own intentional internal scrolling.
- Buttons do not wrap at supported desktop widths.
- Menus, tooltips, and dialogs remain above rows and inside the visible viewport.
- Escape closes dismissible layers; safe outside click closes them; focus returns to the trigger.
- Primary workflows work with keyboard only.
- Status is never communicated through color alone.

## 21. Security And Privacy Contract

- All data remains local unless the user explicitly accesses GitHub or opens an external URL.
- GitHub OAuth tokens are stored using the operating system's secure credential facility when available.
- Secrets MUST NOT appear in renderer logs, main-process logs, Preview diff, screenshots, or global feedback.
- File writes use validated IDs and paths and MUST prevent path traversal.
- Symlink operations MUST not escape approved Library and Target roots.
- AgentEnv MUST never modify agent authentication files such as Codex `auth.json`.
- Real Target writes require an installed executable and writable destination; missing directories MAY be created only inside adapter-declared roots.

## 22. Target Adapter Contract

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

## 22.1 AgentEnv Data Lifecycle

- AgentEnv data has an explicit format version and migration path.
- Legacy storage migration MUST preserve Profiles, Library content, deployment state, Settings, and Backups.
- The user can create a private directory backup from Settings.
- Backups include a manifest with format version and creation time.
- GitHub credentials remain encrypted for the originating Mac and MUST NOT be presented as portable plaintext.
- Corrupt or unsupported future data MUST fail closed with recovery guidance rather than being partially loaded.
- A restore/import flow MUST create a safety backup before replacing current canonical data, reject unsafe links or unsupported formats, and refresh all visible canonical state after success.

## 22.2 First-Run Workflow

The first useful journey is:

1. Detect installed Targets.
2. Scan existing local Skills.
3. Consolidate, ignore, or leave discovered Skills unmanaged.
4. Create or select a Profile.
5. Choose a deployment Target.
6. Review effective payload, omissions, conflicts, and takeover impact.
7. Apply and verify the persisted Target result.

The product MAY use contextual empty states for this journey; it MUST NOT require a marketing-style onboarding page.

## 23. Required Acceptance Matrix

Every release that changes Profile, Library, Target, or Apply behavior MUST verify these scenarios:

### Profile and Target

- Native Profile applied to each compatible Target.
- One Profile active on multiple Targets.
- Different Profiles active on different Targets.
- Switching active Profile removes only previous managed resources.
- Identical second Preview produces no changes and no Apply action.
- Dirty Profile blocks Preview and preserves draft.
- Missing executable and missing directory are distinguished.
- Copy mode keeps Library updates pending; Live link mode visibly propagates them immediately.

### Cross-Target

- Instructions, Library Skills, Profile-owned Skills, and MCP serialize correctly.
- Native Advanced config, incompatible Agents, and disabled paths are omitted with named warnings.
- Zero effective payload is blocked and material omissions require confirmation.
- Unsupported portable resources block with remediation.
- Source Target remains unchanged.

### Drift and stale data

- External edits to Instructions, config, Skill, Agent, and ownership state are detected.
- Preview becomes stale after Profile, Library, Target, or state changes.
- Explicit overwrite backs up drift.
- Rollback restores both content and lifecycle state.

### Library

- Local import survives deletion of original folder.
- GitHub import, rate limit, sign-in remediation, update check, Preview, and update.
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
- First and last row menus are topmost and in viewport.
- Escape, outside click, keyboard focus, and focus restoration.
- Working, success, warning, error, no-op, drift, destructive, and recovery states are inspected visually.

E2E assertions MUST verify persisted files and state, not only successful clicks.

## 24. Production Release Gate

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

Current verdict: **Needs refinement**. Core Library, Profile, Preview, transactional Apply, backup, rollback, stale rollback protection, no-op, cross-Target payload review, canonical Target lifecycle, data backup and restore, native Instructions adoption, active-Profile deletion recovery, and Stop Managing workflows are functional. Complete MCP secret handling and broader drift adoption remain release requirements.

## 25. Current Priority Gaps

1. Complete MCP secret masking and backup permission guarantees.
2. Add explicit Backup retention controls.
3. Extend Adopt into Profile beyond native Instructions where the adapter can map changes safely.
4. Migrate persisted Profile terminology from `targetId` to `nativeTargetId` with backward compatibility.
