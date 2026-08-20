# AgentEnv Manager Product Contract

Date: 2026-07-23
Status: Authoritative product contract  
Audience: Product, design, engineering, QA, and target-adapter contributors

## 1. Purpose

AgentEnv Manager is a local-first desktop application for saving reusable agent environments as Profiles and safely deploying a complete Profile to local agent tools. Local Skill cleanup is an on-demand recovery and migration workflow, not a prerequisite for ordinary Profile use.

The product succeeds when a user can answer all of these questions without inspecting implementation files:

1. Which resources are canonical and reusable?
2. What does this Profile contain?
3. Which Agent will receive it?
4. What exactly will be added, replaced, removed, or preserved?
5. Is the deployed Agent still identical to the saved Profile?
6. How can the user recover or stop AgentEnv management?

User-facing product language uses **Agent** for a local coding tool such as OpenCode, Codex,
Claude Code, Antigravity, Trae CLI, or Pi. The implementation keeps `Target`, `TargetAdapter`, and `targetId` as stable internal
architecture terms. Internal names MUST NOT leak into navigation, commands, status, confirmation,
or recovery copy.

This document defines the behavior those answers require. Existing code and tests must conform to this contract. A feature is not complete merely because its happy-path control works.

## 2. Product Read

- Primary user: a developer who uses multiple local coding agents and wants reliable, reusable environments.
- Core job: capture or compose an environment once, preview its exact effect, and safely deploy or switch it across supported Agents. Local Skill cleanup appears only when the affected environment needs it or when the user explicitly chooses whole-device cleanup.
- Platform: local macOS, Windows, and Linux desktop application, with filesystem and CLI integration.
- Primary constraint: operations modify files used by other tools, so ownership, preview, atomicity, drift detection, and recovery matter more than visual novelty.

Product ratings:

| Dimension | Rating | Consequence |
| --- | ---: | --- |
| Operation risk | 8/10 | Every destructive deployment requires impact preview and recovery. |
| Task frequency | 6/10 | Common checks and switches should remain compact. |
| Information density | 7/10 | Lists must scan well without hiding lifecycle state. |
| Visual expression | 3/10 | Use a restrained operational desktop language. |
| Motion intensity | 2/10 | Motion is limited to feedback and spatial continuity. |

### 2.1 Platform Contract

- Product semantics, Profile data, Library identity, Preview, Apply, Backup, and recovery MUST remain platform-neutral. Operating-system branching belongs in main-process platform owners, never in Renderer workflows or Target-specific business rules.
- macOS preserves the established `~/.config/agentenv-manager` data root. Linux follows `XDG_CONFIG_HOME` with the standard `~/.config` fallback. Windows stores product data under Electron userData. `AGENTENV_DATA_ROOT` remains the explicit development and recovery override everywhere.
- Executable discovery MUST understand each platform's path delimiter and executable rules. Windows discovery includes `PATHEXT` plus common npm, pnpm, Scoop, Chocolatey, Volta, Bun, WindowsApps, and system locations; POSIX desktop launches may use a bounded login-shell fallback.
- The Windows desktop application manages Windows-native Agent commands and Windows user data. WSL distributions are separate execution and filesystem domains and are not currently Target runtimes; finding `wsl.exe` or configuring a wrapper MUST NOT be presented as WSL support.
- `copy` is the default Skill deployment strategy on every platform. Agent copies change only through Apply or an explicitly confirmed Library update that includes Agent copies.
- `symlink` is an explicit advanced live-link strategy. It MUST disclose that later Library changes can affect a running Agent without another Apply.
- `auto` is a legacy persisted value only. On read it migrates to `copy` and MUST NOT appear as a product choice or select links automatically.
- Ordinary file writes use a same-directory temporary file, file sync, atomic
  rename, and bounded Windows lock retry; the previous file remains intact if
  replacement fails. Directory and whole-resource replacements use a
  recoverable replacement journal. Windows directory handles are not fsynced,
  and no whole-resource replacement may delete the previous path before a
  staged replacement and recovery record exist.
- Backup manifests store symbolic-link targets and link types as data. Creating a Backup MUST NOT require permission to create another symbolic link, and Restore MUST recreate the recorded file, directory link, or junction type.
- Portable Profile IDs, Skill IDs, Target names, and synced Skill trees MUST reject Windows reserved names, unsupported filename characters, trailing dots/spaces, and case-insensitive sibling collisions before publication or import.
- System Git runs without a shell, with terminal prompts disabled, credentials redacted, `core.autocrlf=false`, and `core.filemode=false`. Cancellation terminates the complete child process tree using the platform-native mechanism.
- Conversation launch uses a private temporary POSIX shell script on macOS/Linux and a private PowerShell script on Windows. Terminal preference MUST expose only choices supported by the current platform.
- macOS uses its integrated hidden title bar. Windows and Linux retain native title bars and conventional File/Edit/View/Window/Help menu placement.
- A platform is release-verified only after its native runner builds the installer target and passes the packaged six-Agent Apply, restart, sparse-PATH discovery, Repository import, persistence, and viewport smoke. Pure policy tests and a package built on another operating system are insufficient.

Avoid:

- Treating Target file layouts as the user's primary mental model.
- Implying that a Profile can only be used by its preferred or created-from Target.
- Silent writes, ambiguous replacement, and success-only feedback.
- Destructive actions without affected-object counts or recovery.
- Inferring major lifecycle states from unrelated counters or prose.
- Adding a new Target through conditionals spread across the application.

### 2.2 Agent Compatibility Contract

Agent compatibility is capability-based, not one binary supported/unsupported claim.

- Installation discovery, resource management, Conversation history, native resume, and Profile Compare are independent capabilities. Detecting one capability MUST NOT imply another.
- Every built-in Agent declares an ordered executable candidate list. The first candidate is the normal display command; aliases remain Agent-owned knowledge inside its integration.
- A device-local command override MAY be a safe executable basename or absolute path. It affects command detection and command-dependent capabilities only. It MUST NOT expand AgentEnv's file ownership, resource paths, or Apply authority, and it is not portable Workspace Sync data.
- Command detection reports `found`, `missing`, or `unknown`. `Unknown` means the probe could not complete safely and MUST NOT be presented as proof that the Agent is absent.
- A macOS desktop application that participates in Agent discovery MUST be verified by Bundle ID after discovery; a matching filename or Spotlight result alone is not installation evidence.
- A desktop application MAY prove that an Agent is installed while its CLI remains unavailable. Resource workflows may use the verified application installation contract; Conversation resume and Compare remain unavailable until an executable resolves.
- A verified desktop application MAY provide a bundled Agent runtime. Runtime resolution uses device-local override, PATH command, then verified bundled runtime. The bundled executable MUST pass an executable and bounded version probe before command-dependent capabilities become available. This runtime choice does not expand the Target's managed file paths or Apply authority.
- ChatGPT's Codex view and the legacy Codex desktop application remain one `codex` Target. Chat and Work are outside AgentEnv's ownership; diagnostics expose whether Codex was detected through a shell command, ChatGPT application, or bundled runtime without creating a second Agent.
- Agent-specific launch and resume behavior returns structured executable, argument, working-directory, and environment data. Shared code MUST NOT infer resume syntax from the Agent name or concatenate an untrusted shell command.
- Adding an Agent requires registry contract coverage for executable candidates and every declared optional capability. Platform-specific command behavior requires synthetic platform tests plus packaged verification on that platform.

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
- Managed copy is the default deployment policy. Existing byte-equivalent ordinary directories are adopted without an Agent-path write; missing or changed Skills are deployed as ordinary folders after confirmation.
- Updating the Library MUST NOT silently deploy changes to copied Target Skills. Update Preview offers one default-off `Also update Agent copies` choice when clean managed copies exist. When selected, Library and copies share one Backup, stale check, verification, and rollback transaction. When not selected, copied installs become Apply-pending. Drifted copies are never overwritten by this convenience option.
- Live link is an explicit advanced policy. A confirmed Library update immediately affects linked Target Skills, so Settings and Update Preview MUST disclose that another Apply Preview is bypassed.
- Deployment policy is uniform for newly written Skills. Changing it never rewrites a Target from Settings; each affected Agent becomes Apply-pending, and the next Preview names every copy-to-link or link-to-copy topology conversion. Legacy `auto` settings migrate to Managed copy.
- New Agent and Workspace deployments MUST NOT create ownership markers, sidecars, or AgentEnv support files beside user resources. Device-local Target state is the ownership source of truth. Legacy ownership markers are read-only migration evidence and MAY be removed only by an explicit backed-up Apply or Stop Managing operation after an equivalent central receipt is ready.
- If an exact destination already has content equivalent to the requested Library Skill, Apply adopts that directory in place. Adoption writes only AgentEnv Target state, preserves the Agent resource bytes and timestamps, and records whether the result is adopted, linked, or copied. A topology-only change from a managed link to an equivalent regular directory refreshes the central receipt without rebuilding the directory.

Source of truth: `~/.config/agentenv-manager` or the configured AgentEnv data root.

The active data root is a startup-owned location, not an ordinary live preference. Settings shows the exact active path and opens it, but MUST NOT present a fake editable control. Moving data uses the validated Backup/Restore path until an atomic migration-and-restart workflow exists.

### 4.2 Shared Runtime Locations

`~/.agents/skills` and other cross-tool compatibility paths MAY be consumed by supported and unsupported Agents at the same time. They are device-local runtime locations, never canonical Library storage. AgentEnv observes them without claiming ownership until the user chooses a stable folder policy or explicitly migrates them into Profile deployments.

- Shared runtime locations are first-class registered objects. The registry owns their stable identity, path resolution, discovery depth, scope, and mutation authority. Target adapters declare only which registered locations they consume; they MUST NOT redefine the same physical path as `managed`, `observed`, or `legacy` independently.
- `~/.agents/skills` has the stable identity `agents-skills` and `shared-runtime` authority. Runtime inventory carries that identity through scanning, deduplication, Capture evidence, and Apply freshness fingerprints. Generic Target deployment and generic target-copy consolidation MUST NOT write it; only a reviewed shared-location operation may cross that boundary.
- A registered shared location is scanned through each installed consumer only to preserve Agent-specific runtime availability, then merged into one physical inventory entry with an explicit consumer list. Adapter order MUST NOT change its role or mutation authority.
- Canonical Skill content MUST remain under AgentEnv data. A managed shared copy is a device-local runtime materialization of that Library content, not a second canonical copy.
- The shared area presents one current-behavior summary and one `Change…` action. Its two non-destructive outcomes remain `Leave as-is` and `Manage shared Skills`; Profile control is a separate warning-level migration, not a third symmetric setting. Internally, `Leave as-is` is the implicit read-only `keep` mode and creates no management receipt. `Manage shared Skills` is the `managed` mode: it imports or reuses Library content, preserves the shared path and topology, records ownership only in AgentEnv data, and does not edit Profiles or create Agent-private copies. `Move shared Skills to Profile control` is the reviewed `profiles-only` migration: it prepares supported Agents from their saved Profiles, verifies every destination, and removes shared copies last.
- Shared review MUST NOT outrank first Agent setup. An unclaimed or `Leave unchanged` shared directory may appear as quiet supporting status and remains available in Local Skills Manager, but it does not create a startup action. AgentEnv escalates it only after the user chooses `Manage shared Skills` or `Move shared Skills to Profile control`, or when an Apply result needs a concrete shared-path decision.
- The selected area intent and per-path management receipts are device-local state. They MUST NOT be written beside a Skill, synced to another device, or inferred from a same-name directory alone.
- An unambiguous shared Skill can participate in the ordinary `Manage eligible` workflow. The transaction backs up every selected physical copy, creates or reuses Library content, preserves one shared runtime copy, removes reviewed redundant Agent-specific copies, removes legacy AgentEnv sidecars, records the central shared receipt, and rolls the whole operation back on failure.
- Apply normally deploys Skills to the selected Agent's dedicated managed directory. While a shared copy is active, Apply MUST preserve its runtime effect without creating a same-name Agent-private duplicate.
- Applying an OpenCode Profile MUST NOT change Codex or Claude Code Skill directories, and equivalent isolation applies to every Target pair.
- Profiles persist portable Library references and resource intent only. Concrete Agent paths are live device evidence and MUST NOT be written into Profile data or reused when another Target is selected.
- When an Agent declares ordered Skill roots, an equivalent or conflicting same-name copy in a lower-priority compatibility root is `shadowed`, not active. A shadowed copy remains visible in Local Skills inventory, but it MUST NOT create Profile pending state, duplicate-runtime blocking, or a shared-location migration prompt for that Agent. Same-priority active copies remain a real ambiguity and still require review.
- Compatibility copies MAY be captured into a Profile. Capture and Profile editing remain read-only with respect to the shared directory.
- A plain import creates an independent Library copy and does not claim the source. Confirming `Manage in place` additionally records the reviewed shared path as a managed runtime copy.
- An exact Target-specific copy that already exists beside a compatibility copy MAY be adopted during Take over or a later Apply when its current canonical Skill hash matches the current Library hash. Preview binds that hash and Apply revalidates it immediately before recording the device-local deployment receipt. Adoption does not replace or back up the resource itself and MUST remain a no-op on the next Preview while shared migration is still pending.
- `Move shared Skills to Profile control` MUST be explicit and warning-level wherever it appears. Profile editing remains available while a shared runtime is active, but it edits only the intended post-migration state; rows show the actual shared runtime effect, never false `Apply pending`, and the Profile and Apply Preview expose the same direct migration route. Migration Preview lists supported consumers, Profile outcomes, exact shared paths, unsupported-Agent risk, and every destination. The transaction creates one restorable backup for the shared state, shared paths, affected Agent paths, and Agent state; prepares destinations first, removes only the listed shared entries last, verifies the result, and restores the whole transaction on any failure. Linked source folders and the shared parent directory are never removed. After migration the surface shows `Controlled by Profiles` and a direct route to its restore points; changing a compact setting MUST NOT pretend to recreate removed shared copies.
- Unknown or unsupported consumers cannot be proven absent. They produce a clear warning that removing the shared copy may stop those tools from loading the Skill, but that warning alone MUST NOT create an impossible permanent block.
- AgentEnv MUST NOT edit per-Agent configuration to suppress duplicate discovery during this migration.
- `Leave shared copy unmanaged` is a path-scoped exception. It MUST NOT ignore or alter same-name copies in Agent-specific directories. The global `Leave unchanged` policy suppresses per-row takeover actions until the user changes the area policy.
- A compatibility copy with conflicting content remains a version decision; it MUST NOT be overwritten by bulk management.
- Manager-related metadata, including Skills CLI lock files, is read-only evidence. It does not prove ownership, and AgentEnv MUST NOT silently edit or delete it.
- Importing a readable Skill path creates an independent Library copy and MUST NOT imply that AgentEnv has taken over the source installation. Lock files, symlinks, and adapter metadata are evidence about provenance, not proof that another tool owns the destination path.
- A Target-specific Skills root MAY itself be a symbolic link to a shared or external directory. Capture MAY read that linked content, but Apply MUST treat the root link as one filesystem boundary: Preview names the link and resolved destination, Apply backs up and atomically replaces only the root link with a real Target-owned directory before installing child resources, and the linked destination remains untouched.
- A broken or cyclic Target Skills root link is still a recoverable filesystem boundary: Preview MUST identify it as a reviewed root replacement, Backup MUST preserve the link itself without traversing it, and Apply MAY replace only that link with a Target-owned directory. A non-link file occupying the Skills root remains blocking. Rollback after root isolation MUST restore the exact original link and remove only the Target-owned directory created by AgentEnv.
- A legacy installation that stored Library originals in `~/.agents/skills` is migrated once during startup. AgentEnv builds the complete destination in staging and atomically replaces the canonical Library directory; the shared source remains byte-for-byte untouched. Legacy sidecars remain migration evidence until a reviewed manage or Profiles-only transaction can replace them with central receipts and include their removal in rollback.

### 4.2.1 Device-local Skill Management Boundaries

A Profile stores portable Skill intent: install or omit a Library Skill for one Agent. A
machine-specific decision not to let AgentEnv mutate an existing Skill path is a separate
device-local management boundary. It MUST NOT be encoded into the Profile or inferred from a
content hash.

- A management boundary is identified by normalized physical path, optional Target identity,
  and `exact` or `collection` coverage. Skill name and content hash are observations, not policy
  identity. Editing content at the same protected path MUST NOT silently revoke the boundary.
- `Leave unmanaged` creates or retains that boundary without writing the Agent path. `Manage with
  AgentEnv` removes only the selected boundary; the next fresh Preview determines whether adoption,
  replacement, or removal is required.
- A boundary means only that AgentEnv will not mutate its covered location. It does not claim that
  another manager exists, that the content matches Library, or that the Agent is guaranteed to load
  it.
- A collection's version choice is a separate member decision. Choosing the Library copy for one
  collection member MUST NOT grant mutation authority over the collection path.
- Apply reconciliation combines saved Profile intent, the current runtime observation, and the
  current management boundary. `install + external + unmanaged` produces `External active`;
  `omit + external + unmanaged` produces `External still active`. Both are stable local overrides,
  not pending deployment work.
- A successful Apply persists a Target-local reconciliation receipt for the observed outcome. The
  receipt records what Apply proved; it is not the policy authority. The management-boundary store
  remains the sole authority and a fresh Preview always recomputes from current facts.
- A stable local override produces the Target lifecycle `Applied with local overrides`. It MUST NOT
  become `Pending` merely because external content changes at the protected path. AgentEnv-owned
  resource drift remains a separate lifecycle condition.
- Legacy mixed path-policy and cleanup-ignore files are migrated only after their decisions can be
  mapped to concrete paths. AgentEnv writes and validates both new stores before archiving a fully
  migrated legacy file. Unresolved legacy rules remain available for a later scan. Migration MUST
  NOT modify any Agent Skill path.

### 4.2.2 Device Sync

Device Sync reuses portable Profile and Library intent across the user's devices through a user-owned private Git repository. It is implemented by the internal Workspace Sync subsystem, but it is not project Workspace management or Target deployment and MUST NOT automatically Apply a Profile.

Local Skills Manager is always a device-wide inventory. Profile and Agent entry points MAY open it with return context or focus a relevant row, but MUST NOT expose or persist a narrower inventory scope. Shared compatibility review is a conditional subflow, not a selectable scope.

Managed copy is the default for new installations. Deployment preference and management-format migration are independent: an existing explicit Live link preference MUST remain Live link, and a legacy `auto` preference normalizes to Managed copy without being treated as proof of old Agent ownership. `skillManagementFormatVersion` identifies the settings schema only. The application determines actionable legacy state exclusively from validated `.agentenv-owner.json` files whose Target and resource kind match the observed path; a link or copy without that evidence is never classified as old merely because of its topology.

Validated legacy ownership files appear as `Legacy records` in Local Skills Manager, never as an update or upgrade. If none exist, migration is silent. The reviewed operation backs up the Skill path, marker, and Target state; records the current bytes, content hash, and existing link/copy materialization in private Target state; removes only the marker; verifies the result; and rolls everything back on failure. It MUST preserve Skill content, timestamps, and topology. A normal Profile Apply MAY perform the same migration for Skills in its exact plan. Invalid, ambiguous, or content-conflicting markers provide no ownership authority and return to ordinary Local Skills review.

- The portable snapshot includes complete Profile v2 data, canonical Skill
  paths and bytes, portable Skill update metadata, global Skill availability,
  and the Skill source registry. Executable bits are device-local because
  Windows checkouts cannot represent them consistently; they MUST NOT affect
  snapshot identity.
- Complete portable Profiles sync independently of which Agents are installed or enabled on a
  device. A missing Agent leaves its Profile policy dormant on that device; it MUST NOT make the
  Profile invalid, create pending deployment work, or alter the device's Agent selection. Target
  availability, active-Profile assignment, deployment receipts, and Apply state remain local.
- Target states, credentials, GitHub tokens, settings, backups, trash, history, observations, caches, absolute local paths, and manager-evidence lock paths MUST NOT enter a snapshot.
- Device-local Skill source records excluded from the portable snapshot remain untouched when this device receives remote source-registry changes. Exclusion from Sync MUST NOT delete local-only source intent.
- Snapshot output MUST be deterministic. A workspace with unchanged portable content produces the same content hash and no Git commit.
- The application MAY check the remote repository in the background, but MUST NOT automatically update this device, publish, merge, or Apply.
- Background Check MUST use Sync-local serialization and MUST NOT hold the application-wide mutation lock while waiting on Git or the network. Update, Publish, recovery, connection changes, and disconnection remain globally serialized mutations.
- Update and Publish require a fresh remote revision. Non-fast-forward changes and rewritten history MUST stop the operation; AgentEnv MUST NOT force-push.
- Comparison is three-way against the last accepted base. Changes to different Profile or Skill sections MAY combine automatically. Concurrent changes to the same section, and delete-versus-modify, require an explicit local or remote choice.
- Updating this device validates the complete candidate, creates one Workspace recovery backup, writes Profile, Library, and source registry data under the global mutation lock, verifies the result, and automatically restores all three on failure.
- If portable content is written but the accepted base or Sync state cannot be committed, AgentEnv MUST restore the Workspace recovery backup before reporting failure. A failed restore remains `Recovery required`.
- An interrupted or failed restore enters `Recovery required`. The referenced recovery backup MUST NOT be removed by retention or manual backup cleanup.
- Remote symlinks, path traversal, duplicate ids, broken references, unsupported future formats, embedded URL credentials, private keys, high-confidence tokens, and resource or total size-limit violations MUST be rejected before local mutation.
- System Git authentication belongs to the operating system SSH Agent or credential helper. AgentEnv MUST NOT store repository passwords, tokens, or private keys, modify global Git configuration, run repository hooks, sign commits, or prompt through a hidden terminal.
- Ordinary non-AgentEnv files in the repository remain untouched. Only `agentenv-sync.json` and `workspace/` are managed.
- A remote Skill content change that affects a currently linked deployment has immediate runtime impact. Review MUST identify that impact and require separate confirmation. Copy deployments and Profile-only changes remain pending until ordinary Profile Apply.
- Immediate linked-Skill impact is calculated only for Agents currently enabled in Settings.
- Connect treats a new repository and branch as a candidate. It MUST validate access, remote format, workspace identity, and the initial comparison before replacing an existing connection. Candidate failure preserves the previous connection, accepted base, status, Profiles, and Library. Reconnecting the same repository and branch is an ordinary Check.
- A successful connection change starts a new three-way base unless local and remote portable snapshots are identical. Disconnect removes only device-local Sync state and cache; it MUST NOT change Profile, Library, Target, remote repository, or operating-system Git credentials.

Device Sync states are `Not connected`, `Up to date`, `Changes to publish`, `Changes to receive`, `Review required`, `Could not check`, and `Recovery required`. `Checking`, `Publishing`, and `Updating` are temporary activity states, not persisted outcomes. The pending primary command names the user outcome rather than the preview stage: local-only changes use `Publish`, remote-only changes use `Update this device`, and bidirectional or conflicting changes use `Resolve changes`; each command still opens the required review before mutation.

### Skill evidence and asynchronous feedback

- Repository source groups expand from the non-interactive area of the complete row. Links, rename, selection, and row actions retain their own effects and MUST NOT also toggle disclosure.
- Source-group multi-selection is a temporary Merge prerequisite, not persistent list chrome. Checkboxes appear only after `Merge`; `Escape` or the exit control clears the temporary selection.
- Every asynchronous command MUST acknowledge work on the initiating control immediately. Loading icons use the shared motion primitive rather than page-local animation rules.
- Whenever AgentEnv can read a trustworthy upstream commit time, Library metadata update time, or local `SKILL.md` modification time, version-choice and conflict-review surfaces MUST present it alongside version and content hash. Missing or unreadable timestamps remain omitted or explicitly unknown; timestamps never replace content comparison.

### 4.2.3 Global Quick Open

Quick Open is a navigation accelerator, not a second command model.

- `Cmd/Ctrl+K` opens one global search across Profiles, Library Skills, Agents, indexed Conversations, workspaces, and safe navigation actions.
- Profiles, Skills, Agents, workspaces, and actions remain synchronous in-memory results. A query of at least two characters MAY add a bounded asynchronous Conversations group after a short debounce. That search reads only the existing device-local index: opening Quick Open MUST NOT scan Agent histories, refresh the index, or block local navigation results.
- Conversation results show the authoritative title, Agent, workspace when available, update time, and one bounded matching excerpt. Title matches rank ahead of body-only matches. Results from an older query MUST be discarded without moving the active local result; choosing a Conversation closes Quick Open and opens that exact indexed task in Conversations.
- Results inherit the same visibility and availability rules as their owning workspace. Quick Open MUST NOT bypass dirty-Profile confirmation, destructive confirmation, disabled-resource rules, or Target ownership checks.
- Search, active selection, and result list use the standard combobox/listbox accessibility model. Arrow keys move one result, Home and End move to the first and last result, Enter opens the active result, and Escape restores focus to the invoking surface.
- The active result MUST remain visible while keyboard navigation moves through a longer result list. Opening an item closes Quick Open before navigation so focus and feedback belong to the destination workspace.

### 4.2.4 Workspaces

A Workspace is a device-local reference to a real working directory. It is not an
AgentEnv-owned copy of the folder and does not require Git.

- AgentEnv persists only the Workspace ID, canonical root path, display name, creation and
  last-opened times, and last-used Agent. Workspace resources remain canonical in the selected
  directory. Removing a Workspace removes only this reference and MUST NOT remove, move, rewrite,
  or traverse the referenced directory.
- Workspaces never bind or automatically Apply a Profile. Opening a Workspace uses the selected
  Agent's current real global setup. The active AgentEnv Profile may be shown as provenance
  for managed global resources, but it is not a Workspace relationship.
- A Conversation belongs to a Workspace only when its recorded workspace resolves to that Workspace's
  canonical directory. This relationship is derived, never persisted as a second binding. The
  Conversation workspace filter groups canonical Workspace matches separately from other folders,
  and a matching Conversation may navigate to that exact Workspace reference.
- Workspace detail lists actual Instructions, Skills, and MCP files through adapter-declared paths.
  A shared Workspace path consumed by several Agents appears once. Its row shows a compact consumer
  count and exposes every known consumer in hover detail instead of placing an Agent-name chain in the
  primary state lane. An
  unsupported resource kind is labelled unsupported rather than rendered as an empty managed list.
- Loaded resource details are for one selected Agent and start with a fresh read. They
  keep Workspace-local, Agent-global, AgentEnv-managed, and external sources separate; show exact paths;
  identifies same-name conflicts; and names every excluded or unreadable source. It may state load
  precedence only when the adapter can prove it. Otherwise it reports `Load order unknown` and the
  result is `Partial`.
- Workspace Open uses an adapter-generated absolute executable, argument array, and the canonical
  Workspace root as `cwd`. The primary action uses the last-used installed Agent and its adjacent menu
  offers other installed Agents with launch capability. Open does not Save or Apply a Profile and
  does not mutate Workspace resources.
- Profile and Workspace use one Agent-context selector contract. Each surface supplies only the
  Agents eligible for its current task; the shared selector is disabled for zero candidates, shows
  one candidate as plain non-interactive current context without button, border, chevron, or menu
  affordances, and becomes searchable only when at least two candidates offer a real choice. Pages
  MUST NOT redefine these count states independently. Both surfaces keep the current object on the
  left and reserve the trailing lanes for Agent context, the primary command, and overflow actions;
  responsive layout MUST NOT move this action group to the left edge. Profile readiness belongs to
  that trailing Agent/action context and MUST NOT appear as Profile identity metadata below its name.
- The selected `Agent` is the context for Workspace inspection, supported edits, Preview, and Open;
  it MUST NOT be labelled as only an `Open with` preference. Changing it refreshes the visible
  resources before another Agent-scoped mutation can be reviewed. Resource identity remains plain
  text, an editable resource exposes a separate row action, and a relative path identical to its
  displayed name is not repeated as secondary metadata.
- Workspace file mutation is supported only for paths and formats explicitly declared by the Agent
  adapter. Every mutation is `fresh read -> semantic diff -> explicit command -> backup -> atomic
  write -> verification -> recovery`. A semantic no-op creates no backup and performs no write.
  Stale bytes require a fresh review. Failure restores the original bytes or leaves a visible
  recovery record before any success is reported.
- A missing primary Workspace instruction remains absent until the user explicitly saves its draft.
  Save creates only the adapter-declared file and the minimum missing regular parent directories;
  Restore returns the path to absence. Existing links, special files, and non-directory parents are
  never replaced to make creation succeed.
- Inspection support never grants mutation authority. Renderer paths are never mutation authority:
  Main issues opaque resource and Skill-location IDs, then revalidates the canonical root, bounded
  relative path, parents, entry type, and hash immediately before commit. Instruction writes use an
  Agent declaration; Skill writes use an explicit location declaration and never infer the location
  from the Agent selected for Open. Child links, special files, escaping paths, and case-folded
  duplicate destinations remain inspect-only.
- Dirty Workspace editors use one Save / Discard / Cancel guard for Workspace or resource switching,
  workspace navigation, dialog dismissal, reference removal, and app close. A stale hash refreshes
  review rather than overwriting external changes.
- Every committed Workspace mutation has a private recovery receipt. Failed writes MUST restore and
  verify original bytes; failed restoration creates a persistent `Recovery required` state and
  blocks only the same canonical path. Restore rechecks the current hash; if the path changed after
  the receipt, it refuses to overwrite the newer bytes and requires another review. Removing a
  Workspace reference never removes protected recovery receipts.
- MCP preview exposes names, source labels, and non-secret status only. Credential values, raw
  unsupported configuration, and secret-like arguments MUST NOT cross preload or enter diagnostics.
- Adding a Library Skill to a Workspace creates a verified Workspace-owned copy in the explicitly
  selected Workspace Skill directory. The default is the highest-priority writable shared declaration;
  for compatible Agents this is `<workspace>/.agents/skills`, while Agent-specific directories remain
  explicit alternatives. This Workspace-local shared directory is ordinary Workspace content and is not
  the global `~/.agents/skills` migration boundary. AgentEnv MUST NOT create a link from a Workspace into the user
  Library, copy escaping links or private AgentEnv Library metadata, or silently import an existing
  Workspace Skill into Library. The explicit Add command may create the adapter-declared Skill root
  when it is absent. A failed Add removes only empty parents created by that command and removes the
  destination only while its verified content still matches the attempted Library copy. An identical
  destination is a no-op. Different content requires an explicit Keep Workspace copy or Replace with
  Library copy decision; replacement backs up and verifies the original directory before commit.
- Profile composition and Workspace copy use the same Library Skill picker primitive: searchable
  identity rows show the same icon, description, version/hash, path, selection, empty, and keyboard
  states. Profile composition may select several Skills, while Workspace copy selects one and then
  shows the Workspace location and file impact in the same dialog. A native Skill dropdown is not a
  separate Workspace interaction pattern.
- Git observation is advisory and bounded to the selected Workspace and affected relative paths.
  It reports only `Tracked`, `Modified`, `Untracked`, `Ignored`, `Not a Git repository`, or
  `Git unavailable`. Git absence or dirtiness never expands or removes filesystem authority.
- AgentEnv MAY execute only read-only Git queries for this feature (`rev-parse`, `status`, and
  `ls-files`) with argument arrays, a bounded working directory, timeout, and output limit. It MUST
  NOT stage, commit, checkout, reset, clean, stash, or modify repository configuration.
- Workspace references and recovery data are device-local and excluded from Workspace Sync. Ordinary
  AgentEnv data backup includes the reference registry but never copies the referenced Workspace.
- `Workspaces` shows one selected directory at a time. A compact Page Header switcher temporarily
  opens the searchable Workspace list and owns `Add folder`; closing it returns the full work area
  to the selected directory. Switching preserves the existing reference and mutation contracts,
  while the page never gains horizontal scrolling.

### 4.3 Profile

A Profile is the public and persisted reusable Agent setup recipe. It is the product's primary
composition object, but it does not own an Agent runtime, a Workspace folder, or native Agent
settings outside an adapter's declared resource boundary. A Profile owns:

- Instructions.
- References to Library Skills, each with an install name and enabled state.
- An independent MCP policy for each Target: `Use Profile`, `Turn off`, or `Keep current`, plus a sparse set of `On` and `Off` choices for MCP servers already defined by that Agent.

Instructions, Skills, and MCPs each have an independent application policy for every Target. The policy is part of the saved Profile recipe, not a global application preference.

- `Use Profile` includes that resource category in Profile auto-save, Preview, Apply, drift detection, Backup, and verification for the selected Target. Its desired state comes from the saved Profile content and item-level choices.
- `Turn off` remains an AgentEnv-managed policy but makes the selected Target's desired state empty or off without deleting the saved Profile recipe. Instructions are removed, every Profile Skill is treated as disabled, and every explicitly saved MCP selection is treated as `Off`. It MUST NOT remove unrelated Agent Skills, disable MCPs absent from the Profile selections, or delete MCP definitions.
- `Keep current` preserves the saved Profile content and visible resource count but excludes that category from the selected Target's effective payload. In steady state, Apply MUST NOT inspect, fingerprint, validate, write, remove, or claim new ownership over the Target's corresponding resources.
- Changing a category policy is auto-saved to the Profile and does not mutate the Target until Preview and Apply. Returning from `Turn off` or `Keep current` to `Use Profile` uses the same fresh Preview and explicit drift confirmation as any other managed replacement.
- The transition to `Keep current` MAY touch only resources already owned by AgentEnv when detachment is required. An already AgentEnv-managed Skill live link MUST first be materialized as a standalone copy of its current content. Preview names that transition and Backup protects it. This prevents later Library updates from changing an opted-out Target without Apply while retaining enough paused ownership evidence for safe drift review when management resumes.
- Paused ownership evidence MUST NOT contribute to ordinary managed-resource counts or drift status. It is consulted only when management resumes, and a refreshed managed snapshot replaces it after a successful Apply.
- Missing Instructions and Skills policies default to `Use Profile`; a missing MCP policy defaults to `Keep current`.

A Profile MAY record a preferred Target for default UI context and the Target it was created from for provenance. Neither field binds deployment: the same Profile MAY be applied to every compatible Target, and each Target still has at most one active Profile.

Create from Target MAY record a machine-local Capture receipt containing source paths, location roles, and content hashes. The receipt is optional takeover evidence, lives outside portable AgentEnv data, is never part of the Profile or data backup, cannot authorize content that differs from the current Library hash, and is consumed after the first successful Apply to that Target. Missing or malformed receipt data falls back to current content and path-capability validation.

Create from Agent is observational with respect to Agent files. A readable ambiguity is a conditional Capture decision, not a workflow-wide failure.

- Multiple active paths that expose the same normalized Skill name and the same content hash are one equivalent runtime Skill. Capture MAY collapse them automatically while retaining every path in its receipt.
- Multiple active paths that expose the same Skill name with different content require an inline version choice. Capture MUST show each path, canonical path, runtime role, shared consumers, declared version, content hash, modification time when available, collection origin, and exact Library match. Version and time are evidence only and MUST NOT silently choose a winner.
- The user MAY select one readable copy for the Profile or leave every conflicting path unchanged on this device. Selecting a copy imports or reuses that content without modifying any runtime source. Leaving copies unchanged records exact device-local management boundaries and excludes the Skill from the portable Profile; a later Apply preserves those paths and reports a local override rather than removal or perpetual pending work.
- A same-name Library conflict remains an explicit import decision. Capture MUST NOT silently overwrite the Library or invent an unexplained duplicate identifier.
- Capture decisions are fingerprint-bound. If one reviewed path changes, refresh only the affected decision while preserving the Profile name and unrelated choices.
- Capture MAY fail globally only when the Agent is no longer available, AgentEnv cannot safely persist its own data, or no user decision can produce an honest Profile. Every resolvable prerequisite stays inside Capture and names the next action.
- Capture never removes, replaces, links, or cleans Agent runtime paths. Shared and collection cleanup remains a separately reviewed Local Skills mutation.

### 4.3.1 Isolated Profile Comparison

Profile Comparison answers one bounded pre-Apply question: how the selected Agent's current
environment and one saved proposed Profile behave on the same task. It is not Apply, a Benchmark
suite, a correctness score, or a generic Agent launcher.

- Input is one saved Profile, the Agent currently selected beside Apply, one task prompt, and an
  optional Workspace. The Workspace may be empty or any local folder; Git is optional metadata,
  not an eligibility requirement. Pending Profile edits MUST finish auto-saving before Compare becomes available.
  A Profile already matching the selected Agent has no pending candidate and MUST NOT offer a
  redundant comparison run.
- Compare MUST use the selected Apply Agent. It MUST NOT silently fall through to OpenCode, another
  installed Agent, or a generic shell command. An Agent is available only when its adapter exposes
  and verifies an isolated comparison capability. AgentEnv implements that capability for OpenCode,
  Codex, Claude Code, Antigravity CLI, and Pi. Adding another Agent requires an equally isolated
  target adapter rather than a generic fallback. An installed Agent without that capability keeps a
  visible disabled Compare command whose explanation names the missing technical prerequisite; it
  MUST NOT collapse an absent command, unsupported platform, and missing one-shot Agent interface
  into one generic unsupported state. Runtime readiness is a separate condition: an installed and
  supported Agent that is signed out or references a missing credential MUST fail during Preview
  with the exact login or environment-variable action required, before either comparison side runs.
- Preview freezes the Workspace into two independent private snapshots, creates two random `0700`
  Homes, and records immutable copies of every included Library Skill. Empty Workspace creates no
  project files. A folder snapshot includes its current readable content, including uncommitted Git
  changes, while excluding disclosed generated, oversized, sensitive, or escaping-link entries.
  Routine generated-directory exclusions are summarized as a count; sensitive files and unsafe
  links remain explicit warnings.
- The first run materializes a snapshot of the selected Agent's current effective Instructions,
  Skills, and supported resource state. The second materializes the saved proposed Profile. `Use
  Profile`, `Turn off`, and `Keep current` retain their ordinary Profile meanings; no run points at
  a live Agent resource path. Both runs receive the same task and the same frozen Workspace bytes.
- P0 performs two fresh model calls in sequence. The UI MUST disclose this before confirmation.
  Previous results are not reused unless a future implementation can prove an exact match for
  Agent, executable, CLI version, model, task, Workspace hash, current environment hash, and
  isolation policy. Similar-looking prior runs are not valid baselines.
- Compare MUST NOT Apply, write the selected folder, or write the real Agent's Instructions, Skills,
  MCP settings, state, authentication, or credentials. On macOS, each child process is constrained
  to its own comparison root by the operating-system write sandbox. After inputs are frozen, the
  child is also denied reads from the real user Home and original selected folder, except for the
  narrowly declared executable runtime required to launch the selected Agent. A platform without
  an implemented sandbox reports comparison unavailable and MUST NOT downgrade this guarantee.
- Claude Code custom-provider comparison may project only documented Anthropic endpoint,
  credential, model, and effort environment fields from `settings.json` into the isolated process.
  It MUST NOT copy the full settings file or pass unrelated `env` entries through.
- Disposable comparison roots MUST live outside the protected real Home and every Home, Target,
  Workspace, and temporary path passed to the child MUST use its canonical filesystem form. macOS
  path aliases such as `/var` to `/private/var` MUST NOT make the sandbox reject its own isolated
  `CODEX_HOME`, working directory, or temporary files.
- Target-recognized project-local Agent resources are masked only inside each temporary snapshot
  and are restored before collecting task changes. MCP definitions and literal credentials remain
  Agent-owned and are never copied into P0 comparison Homes. Exclusions are displayed and make the
  result `Partial`, never silently `Full`.
- Before launch and between both runs, Preview binds the target-specific saved Profile hash,
  selected Library hashes, complete included Workspace fingerprint, executable identity, and real
  Agent resource fingerprints. Stale input invalidates Preview. After both runs, the original
  Workspace and real Agent fingerprints are verified again before a result is accepted.
- Each child uses an absolute executable and argument array without a shell, a bounded timeout and
  output limit, and process-tree cancellation. User-visible states are `Preparing`, `Running`,
  `Cancelling`, `Completed`, `Incomplete`, `Failed to run`, and `Cancelled`. `Completed` means both
  CLI runs ended normally and evidence was captured; it does not mean either result is correct.
- Results name the two runs by user meaning: `Agent now` is the selected Agent's live effective
  environment snapshot and `With Profile` is the saved candidate. They present responses, file
  changes, duration, exit code, and only usage values explicitly reported by each CLI. Overview is
  one aligned comparison table and highlights factual differences without declaring a winner. A
  Delta view compares Profile output files with Agent output files and identifies which removed
  lines belong only to the Agent run and which added lines belong only to the Profile run. CLI and
  model are common run metadata when equal; the UI splits them only if the CLI reports different
  values. Missing token or cost fields display `Unavailable` and MUST NOT be inferred as zero.
- Temporary Workspace, Home, authentication copy, and runtime state are deleted after every
  terminal outcome. A preparation failure or cancellation MUST also clean every already-created
  sibling environment. Cleanup failure is a visible failed state.
- AgentEnv persists only the latest redacted and bounded comparison report in device-local
  application data. Reports and temporary workspaces are excluded from Workspace Sync. A report may
  be included in an explicit whole-data backup but never contains a temporary Home, selected-folder
  absolute paths, or raw literal credentials.
- P0 has no suites, assertions, pass/fail label, ranking, scheduler, LLM judge, concurrent runs,
  result sync, automatic write-back, or top-level Comparison navigation.

Source of truth: the saved Profile directory in AgentEnv data.

A v2 Profile directory contains exactly `profile.json`, `INSTRUCTIONS.md`, and `resources.json`. It MUST NOT store arbitrary native configuration, credentials, private Skill copies, Agent definitions, hooks, environment variables, or disabled-path lists.

Profile name, description, icon, Instructions, Skills, and MCP activation intent are all Profile-owned
data. Semantic edits auto-save the complete Profile atomically without writing any Target. Apply remains
the explicit boundary that may change an Agent.

Each Library Skill reference has a Profile-scoped enabled state. Missing legacy state means enabled.

- Turning a Skill off MUST preserve the reference and its Library content; it removes the Skill only from that Profile's effective payload.
- Turning a Skill back on MUST restore the same reference without another Library import or picker flow.
- A disabled Skill MUST NOT be deployed, validated as a desired Target resource, counted as an effective resource, or recorded in applied Library versions.
- Enable and disable are Profile edits: they auto-save to the Profile and affect a Target only after Preview and Apply.
- An enabled reference whose Library Skill is missing blocks Apply. A disabled missing reference remains visible for repair but is an effective no-op.
- Disabling a Skill removes AgentEnv-owned deployments automatically. A writable Target location outside AgentEnv MAY be removed only as a reviewed, backed-up Apply effect. A path covered by a `Leave unmanaged` boundary is preserved and reported as `External still active`; it is excluded from that Target's effective managed payload. Observe-only locations are reported but never mutated.

Each Target MCP policy follows these rules:

- `Keep current` means Apply MUST NOT inspect, parse, hash, diff, back up, write, or retain ownership of that Target's MCP configuration. Retained inactive selections are editor convenience only and MUST NOT affect the Target-specific Profile hash.
- `Use Profile` is sparse. A connection absent from the selections remains Agent-owned.
- `Turn off` turns every retained Profile selection off through the same allowlisted activation field used by `Use Profile`; absent connections remain Agent-owned and definitions are never removed.
- `On` plus an existing native definition updates only the adapter's verified activation field. `On` plus a missing definition blocks Apply and tells the user to configure it in the Agent or turn it Off.
- `Off` plus an existing native definition updates only the verified activation field. `Off` plus a missing definition is a no-op.
- A Target without a verified activation mechanism is Agent-controlled. Its Profile policy MUST remain `Keep current`, and Apply MUST NOT write its MCP configuration.

### 4.4 Agent (internal Target)

An Agent is a supported local coding tool and its deployment locations. OpenCode, Codex, Claude Code, Antigravity, Trae CLI, and Pi are Agents.

- Target files are deployed copies, links, or serialized output.
- Target files are never the canonical Library source.
- A Target can have at most one active Profile at a time.
- One Profile can be active on multiple Targets simultaneously.
- A Target can be modified by AgentEnv Manager, the agent itself, or another local process.

### 4.4.1 Enabled Agent Scope

Settings owns the explicit set of enabled Agents.

- Settings also owns one device-local Agent display order. Reordering uses the same dedicated
  drag handle and `Alt+Arrow` keyboard contract as other ordered object switchers; selecting or
  copying row content MUST NOT begin a drag. The persisted order is the single renderer source for
  Settings, Agents, Profile and Workspace Agent selectors, Conversations, Quick Open, status
  summaries, and every other multi-Agent list. Discovery and refresh may append newly supported
  Agents but MUST NOT restore adapter registration order over the user's preference.
- Existing installations without an Agent scope MUST migrate with every currently supported Agent enabled.
- Once the scope is persisted, a newly added adapter MUST remain off until the user enables it.
- Turning an Agent off MUST remove it from navigation, status summaries, Profile destination choices, discovery results, lifecycle scans, Capture, Apply, rollback, stop-management, and Agent-specific Skill scans.
- Every write or recovery entry point MUST re-check the enabled scope in the main process. Hiding a renderer control is not sufficient authorization.
- Turning an Agent off MUST NOT edit or delete its files, deployment state, Profiles, Library resources, or Backups, and MUST NOT end an existing management relationship.
- Turning off a managed Agent requires an impact confirmation. An Agent in `Recovery required` cannot be turned off through the UI until recovery is resolved.
- Turning an Agent on MUST run fresh installation and lifecycle discovery before restoring operational controls.
- An enabled Agent remains visible when its installation is not detected. Configuration directories alone do not make an Agent installed.
- Opening Skills for an undetected Agent MUST show the missing installation prerequisite in the work surface, keep setup disabled with a readable reason, and direct the user to install then Refresh. It MUST NOT present a generic preservation flow that appears actionable.
- Installation detection MUST use adapter-declared authoritative evidence. A command, desktop application, or another verified platform installation marker MAY establish installation; stale configuration files MUST NOT.
- A desktop application is installation evidence for an existing Agent only when it consumes that Agent's declared user-level resource paths. It does not create another Agent, destination choice, or Apply operation.
- Multiple installation signals for the same Agent MUST produce one Agent row and one deployment plan. AgentEnv applies to the declared file boundary once, regardless of whether a command, desktop application, or both are present.
- IDE extensions are outside the current installation-discovery scope.
- Installation probes MUST be platform-aware and testable without reading the developer's real machine. A macOS application probe MUST NOT prevent the same adapter from using command or platform-native evidence on Windows and Linux.
- Shared Library data and global compatibility locations remain global concerns; disabling one Agent MUST only remove that Agent's identity and dedicated paths from consideration.

Status: explicit persisted scope, discovery filtering, command and compatible macOS desktop-application evidence, renderer filtering, operation guards, managed-Agent confirmation, and recovery lock are `Implemented`. IDE extension discovery is intentionally out of scope.

### 4.4.2 Agent Profile Configuration

Agents is the contextual entry for users who begin with one installed Agent rather than
with a reusable Profile. It is a navigation facade over the canonical Profile editor and
Preview/Apply transaction, never a second editor or a reduced resource model.

- `Configure` and the Agent name open the same configuration entry.
- If the Agent has an active Profile, Configure opens that Profile in the canonical
  Profile editor and selects the invoking Agent as the Preview/Apply target.
- If the Agent has no active Profile but has a valid Profile previously captured from that
  Agent, Configure resumes the newest captured Profile instead of capturing it again.
- If no such Profile exists, Configure starts the complete read-only Create from Target
  flow. The saved result is an ordinary Profile containing the reviewed Instructions,
  Skills, and supported MCP activation policy.
- The Agent entry MUST NOT provide a Skills-only editor or its own Save, Preview, or Apply
  implementation. Every resource type that Apply may evaluate MUST be visible and
  configurable in the Profile editor before Apply.
- Saving Profile intent and applying it remain separate persistence boundaries. Editing
  never writes Agent files; Apply always uses the standard impact preview, ownership
  checks, backup, transaction, verification, and recovery contract.
- Global Skill source settings, global disable, duplicate cleanup, Library deletion,
  diagnostics, and recovery stay on their owning surfaces. Configure only composes the
  selected Profile and applies it to the selected Agent.
- A missing or malformed active Profile is a recoverable Profile error, not permission to
  silently create a replacement or fall back to a partial editor.
- A new installation persists every supported Agent as off. After the stable Agents shell is
  visible, a background read-only probe MAY suggest installed Agents in one lightweight dialog.
  The dialog never begins Capture, Apply, or filesystem mutation; enabling only adds the Agent
  to AgentEnv's visible and operational scope.
- After an explicit Enable succeeds, the same dialog MAY advance to an ephemeral next-step view
  for only the Agents enabled by that action. It MUST state that Agent files have not changed,
  MUST NOT persist wizard progress, and MUST NOT automatically Capture, create a Profile, or
  Apply. Dismissal leaves the Agent enabled and Profile Review remains the repeatable entry.
- Each next-step row derives exactly one action from canonical state: open the active Profile,
  continue the newest valid Profile captured from that Agent, surface a malformed active Profile
  for repair, or start the ordinary read-only Create from Target flow. Multiple enabled Agents
  remain independent rows and MUST NOT trigger a chained sequence of Capture dialogs.
- `Not now`, closing the dialog, and Escape skip only the current application launch. A user MAY
  suppress one detected Agent persistently with `Don't suggest again`. Turning an Agent off also
  counts as reviewing that Agent, so it remains off without creating a second row-level action.
  Explicitly suppressed reminders are reversible from the advanced discovery-reminder section in
  Settings; restoring them changes only future suggestions, never Agent enablement or Agent files,
  and the Settings result MUST be immediately visible.
- Existing installations whose stored settings predate the enabled-Agent field preserve the
  previous all-enabled scope during migration. An explicit empty enabled list MUST remain empty.
- Agent discovery review is persisted independently from enabled scope and carries a review-version
  marker. Existing installations whose settings predate the current review version MUST receive the
  read-only chooser once even when legacy migration enabled every Agent or an older build wrote
  reviewed IDs. Confirming persists the exact checked enabled set, records only currently installed
  Agents as reviewed, and advances the review version. `Not now` remains launch-local, and an Agent
  first detected later remains eligible for its own future suggestion.
- A confirmed chooser result MUST survive a full renderer and application restart. When the
  installed Agent IDs, review version, reviewed IDs, and suppression choices are unchanged, startup
  MUST NOT reopen `Choose Agents`. Diagnostics include those non-secret discovery fields so a
  repeated chooser can be distinguished from a newly detected Agent or a review-version migration.
- Supported, detected, enabled, and managed are distinct states. The all-supported detection
  probe is read-only and MUST NOT weaken operation guards: operational Target APIs continue to
  expose enabled Agents only.
- When no Agent is enabled, Agents provides `Choose Agents`, which opens the same selection
  dialog on demand, including candidates skipped for the current launch or suppressed earlier.
- An empty workspace MUST remain empty until the user explicitly creates or captures a
  Profile. Startup MUST NOT seed a sample, adapter-default, or otherwise invented Profile.
- Every launch opens Agents as the stable top-level workspace. Navigation chosen by the user
  remains stable for the rest of that application session; startup or background work MUST NOT
  restore, replace, or otherwise override it.

Status: read-only installed-Agent suggestion, explicit Enable, ephemeral post-enable setup,
one Agent-to-Profile configuration entry, complete Capture, canonical Profile composition,
and shared Preview/Apply orchestration are `Implemented`.

### 4.4.3 Profile Review

Profile Review is the repeatable readiness projection on Agents. It is not a Home page,
onboarding destination, filesystem mutation command, or second Local Skills Manager
implementation.

- Quick open is a command, not a destination. Agents is the first item in one continuous primary
  destination list followed by Profiles, Workspaces, Conversations, and Skills. Settings remains a
  separate utility pinned above Local Agents at the bottom of the sidebar; Library is a domain
  concept, not an additional navigation group label.
- The stable shell opens Agents immediately on every launch. Local core discovery, a legacy
  saved Workspace preference, and background enrichment MUST NOT replace that destination.
  After the user chooses another workspace in the current session, asynchronous completion
  MUST preserve that explicit destination.
- Agent discovery and local Skill inventory run as independent readiness stages. Agents and
  canonical local data render before optional inventory and remote enrichment complete. A
  Skill scan failure reports that Profile Review is unavailable without hiding Agents,
  Profiles, or Library content.
- Profile Review derives its state from installed Agents, usable Profiles, Target
  lifecycle state, and the current local Skill inventory. It stores no wizard step and owns no
  duplicate lifecycle state.
- The compact status projection shows exactly one of: checking local Skills, environment
  check unavailable, shared Skills need review, first Agent setup, Agent changes need review,
  or environment ready. `Applied with local overrides` is a stable current deployment and
  MUST NOT be counted as an Agent that needs review or promoted to a separate global warning;
  its machine-local exception remains visible on the affected Agent and Profile. The projection
  exposes at most one current action. Commands name their affected object:
  `Review Skills`, `Review Profile`, `Configure Agent`, or `Retry check`; a bare lifecycle verb
  such as `Review` is not a Profile Review command.
- Status detail remains a single compact line. When it overflows, the complete selectable value
  is available through the shared enterable detail overlay; truncation MUST NOT discard affected
  Agent names or recovery context.
- Shared compatibility findings open the canonical Local Skills Manager surface already scoped
  to shared locations. The same scan, grouping, preview, Backup, mutation, verification, path
  policy, and rollback contracts apply whether the user enters from Agents or Skills.
- Automatic checks are read-only. Startup, Refresh, Capture, Apply, Import, Update, and Cleanup
  MAY invalidate or refresh readiness, but no background or first-run check may move, delete,
  import, link, copy, or rewrite a Skill.
- A shared compatibility location is discovered before Capture, included in Capture's
  effective environment, and must be reviewed before a Profile can claim to disable or omit a
  Skill that the Agent still loads from that location. Leaving migration outside AgentEnv remains
  an explicit device-local boundary and must produce `Applied with local overrides` on the affected
  Agent. The global Profile Review may still show `Profile ready` because it answers
  whether an action is currently required; it MUST NOT hide the exception from Agent or Profile
  detail.
- Refresh is idempotent. An unchanged inventory produces no canonical write, Backup, ownership
  change, or timestamp churn. A changed inventory invalidates stale review plans and exposes
  only the remaining current work.
- First-run presentation may give the same status projection stronger explanatory copy.
  Completion changes only presentation emphasis; every Profile Review action remains
  available on later runs.

Status: repeatable Profile Review, shared-location scoping, and first-run presentation are
`Implemented`.

### 4.4.4 Data Freshness

AgentEnv distinguishes cached presentation, local discovery, and remote checks. Freshness is a
shared desktop contract rather than a collection of page-specific effects.

- Startup MUST render persisted Profiles, Library content, Agent state, and the Conversation index
  before optional filesystem or network enrichment completes. Automatic enrichment preserves the
  last-good content and selection; it MUST NOT flash an empty replacement view.
- `Refresh` reloads local or cached product state, `Scan` inspects filesystem state, and `Check`
  contacts an upstream source. These verbs MUST NOT be used interchangeably. A command that only
  reads data never implies Import, Update, Apply, Cleanup, or another mutation.
- Manual Refresh, Scan, and Check always force a new read. Automatic page-entry and focus reads
  are skipped while their last successful result remains fresh: Agents, Library, and Local Skills
  use 1 minute on page entry and 5 minutes on focus; Conversations uses 1 minute for both; managed
  Backup inventory uses 1 minute on page entry.
- One resource permits only one in-flight read. Navigation, focus, timers, and a manual command
  MUST join the same operation rather than start duplicate filesystem scans, Agent discovery, or
  network requests.
- A successful mutation invalidates or refreshes every affected local projection. Unrelated
  projections remain intact. A semantic no-op does not churn freshness timestamps.
- Automatic reads are non-blocking and do not emit routine success toasts. When usable content is
  already present, Refresh progress belongs to the command that initiated it: that control keeps
  its geometry, disables duplicate activation, and shows the shared spinner in place. The list,
  selection, detail, filters, and page header remain mounted and do not move. Background reads are
  silent unless they leave an actionable partial or failure state.
- Initial loading with no usable content MAY use a content-scoped loading surface. A full-width
  strip MUST NOT represent transient Refresh progress or routine success. Such strips are reserved
  for persistent conditions that explain an unavailable capability or offer a concrete recovery
  action.
- Refresh success is expressed by the updated content and the control returning to idle, not by a
  global success message. Failure preserves the last-good data and last-success time. Partial or
  failed reads remain attached to the Refresh control through warning treatment and selectable
  detail; a page-local error surface is used only when the user must act before continuing.
- Monitored Skill sources use their persisted per-source `checkedAt` values. Startup checks only
  when at least one monitored source is due; while the app remains open, the next check is
  scheduled from the oldest monitored success, and returning to the foreground checks immediately
  only when overdue. Manual-only sources never participate. The minimum interval remains 5 minutes.
- Automatic checks are read-only. They MUST NOT Import, Update, Apply, delete, move, link, copy, or
  rewrite user or Agent resources.

Status: shared local freshness coordination, persisted Conversation refresh time, due-time Skill
source scheduling, non-blocking automatic refresh, and regression coverage are `Implemented`.

### 4.5 Conversations

Conversations is a local, read-only index over histories owned by enabled Agents. It helps the
user find prior work and continue its visible context in another Agent. It is not a chat client,
an archive, or a native-session database migration tool.

- Original Agent history is always the source of truth. Discovery, indexing, search, and preview
  MUST NOT edit, rename, delete, resume, or otherwise mutate a source conversation. `Open original`
  is an explicit user action that MAY resume the source through the Agent's supported command; it
  MUST NOT rewrite the Agent's history store directly.
- The index is a disposable device-local cache. It MUST NOT enter Workspace Sync, Profile data,
  data exports, backups, diagnostics, or startup-critical data.
- Only visible user and assistant text is portable. Hidden instructions, reasoning, tool protocol
  identifiers, credentials, environment variables, permission state, and native runtime state
  MUST NOT be indexed as portable messages or sent to another Agent.
- Agent-injected runtime envelopes such as application context, environment context, permission
  policy, plugin or Skill inventories, and standalone attachment transport records are not user
  messages. Adapters MUST exclude recognized pure envelopes while preserving mixed records that
  contain an actual user request.
- Sensitive-looking values explicitly present in visible messages MAY remain in the device-local
  index so the original conversation can be found, but Continue MUST require review and redact
  those values before creating a handoff artifact.
- `Continue in` always keeps the source Agent as the first destination. Choosing it is equivalent
  to `Open original`: AgentEnv invokes the source adapter's native resume command and creates no
  handoff artifact. Choosing another Agent creates a new target conversation initialized from the
  selected visible context. It MUST NOT claim that a native session ID, hidden model state, or
  running tools moved between Agents.
- A direct CLI continuation MUST end in the target's persistent interactive entry point. A
  one-shot bootstrap MAY create the seeded target session only when the same terminal captures its
  provider session identity and immediately resumes that session in the full interactive client.
  Exiting after the seeded response is not a successful continuation, even when the bootstrap
  exposes an option named `interactive`.
- When the source history exposes a working directory, Continue MUST carry it into every CLI
  launch, including the generic clipboard fallback. The review surface names the complete
  directory and whether preservation is guaranteed or best effort. A desktop-only launch MUST NOT
  claim guaranteed preservation because LaunchServices may reuse an already-running application.
- The ordinary path is one explicit destination choice followed by direct launch. Review is
  required only when content exceeds the adapter's safe delivery boundary, referenced content is
  unavailable, sensitive text is detected, or the target cannot receive context automatically.
- Context MUST NOT be placed in command-line arguments or copied wholesale to the clipboard.
  Every cross-Agent continuation first writes the reviewed context to an app-owned mode-`0600`
  handoff file. Adapters MAY use a native import API, stdin, or that private file directly. When a
  target cannot receive the file automatically, the clipboard contains only a short prompt that
  names the handoff path and the original working directory; the UI MUST report that pasting this
  prompt is still required.
- Passing a context-file path in the initial prompt is a best-effort handoff, not native session
  transfer. The adapter MUST allow access only to the private handoff directory, copy the same
  short handoff prompt to the clipboard before launch, and identify the method as `Context file`.
  A target with no verified file path MUST use the short `Paste prompt` fallback instead.
- Conversation support is a capability of one Agent integration. Unsupported or metadata-only
  formats remain visible with an honest capability state; the renderer MUST NOT infer support from
  an Agent name or path.
- A list row MAY show the source transcript's byte size when it is already available from the
  indexed file fingerprint. Database-wide sizes and values that require reopening or reparsing the
  source are omitted rather than presented as per-conversation estimates.
- Search defaults to relevance ranking and offers an explicit `Last activity` order based on the
  indexed conversation `updatedAt` value. Changing or extending the query MUST preserve an
  explicitly selected order; clearing the query returns the equivalent ordinary `Recent` order.
- A row context menu is a secondary projection of the existing conversation actions. `Open in
  <Agent>` MUST call the same adapter-backed `Open original` command used by the detail view, and
  `Copy conversation` MUST read the same indexed detail. Right-click never introduces a separate
  resume path or directly rewrites the source history.
- A discovered record identity, source locator/version, and provider session identity are separate
  values. File names MUST NOT overwrite a provider session ID parsed from the source, and native
  resume MUST use the provider identity and source runtime home.
- Refresh is append-incremental and failure-isolated. JSONL readers stream from a verified line
  boundary, fall back to a full streaming read after truncation or replacement, and exclude nested
  subagent logs from the top-level conversation list.
- Absence is authoritative only after the adapter completely observes its source. A malformed
  record, unreadable file, missing history root, unavailable database, or failed Agent command
  MUST NOT clear the last-good index or prevent other Agents from refreshing.
- Read-only local stores MAY be used as an optimization when their schema is probed at runtime and
  work is isolated from the Electron main thread. OpenCode SQLite and legacy storage are preferred
  when readable, deduplicated by provider session ID, and fall back to the official CLI when local
  storage is unavailable, busy, or unsupported. Reads against one OpenCode database are serialized
  and wait briefly for transient writer locks. Repeated lock failures are summarized per Agent while
  the last-good index remains visible.
- The terminal used to open or continue CLI conversations is a device-local General setting.
  `Default terminal` delegates to the operating system's `.command` handler; `Ghostty` explicitly
  opens Ghostty. A selected terminal that is unavailable MUST fail clearly and MUST NOT silently
  launch a different application.
- Handoff transcript text is untrusted historical data. Generated continuation context MUST tell
  the target Agent to ignore instructions embedded in transcript or tool output and to treat the
  current repository plus the user's new request as authoritative.
- Conversation discovery MUST NOT delay startup, Profile loading, Library loading, or Agent
  discovery. Once local startup core data is usable, the application starts one deduplicated
  background refresh when the persisted last-success time is older than 1 minute, the cache is
  empty, or the discovery version changed. That refresh updates only the device-local index and
  MUST NOT navigate to Conversations or change the active workspace. Opening Conversations reads
  the last-good cached index first and joins an in-flight refresh instead of starting a duplicate.
  Revisiting or refocusing within the freshness window reuses the cache. Manual Refresh always
  starts a fresh discovery pass.
- Index list, search, and transcript reads MUST run outside the Electron main thread. Refresh
  parsing MUST yield between records so window navigation and clean shutdown remain responsive
  during a large first index. Parser upgrades invalidate record versions without clearing the
  visible last-good cache.
- The desktop workspace uses one stable list-and-reader surface. Search and the conversation list
  own their scrolling; page chrome and detail actions remain visible. Refresh, copy, open, preview,
  and continue progress belongs to the initiating control, while completion and failure use the
  same global feedback component as the rest of the application.
- The list is a task index, not a message feed. Native Agent titles remain authoritative; when a
  source has no title or exposes a generic placeholder such as `New session - <timestamp>`, the
  first visible request is normalized into a compact task title without invoking a network service.
  Rows give the title the full identity lane; Agent icon/name, workspace, and time share a compact
  context lane. A compact source snippet MAY appear while searching; an exact matching excerpt is
  optional and MUST NOT require loading full transcripts on the Electron main thread. A snippet
  identical to the visible title is omitted rather than consuming a duplicate row.
- Antigravity CLI transcript files are the preferred source for recent full conversations because
  its summary database may update later or omit a newly completed CLI session. Summary database
  rows remain a read-only fallback for older metadata-only history.
- Agent and workspace filters are index queries, not renderer-only hiding. Changing search or a
  filter invalidates older pending list requests, preserves selection only when the selected task
  remains in the result, and never mutates source history.
- Conversation sorting is also an index query applied after filtering and before pagination.
  `Recent` is the default, becomes `Best match` while searching, and uses indexed relevance before
  update time. `Largest` uses only byte sizes already verified in source fingerprints; records with
  unknown size remain available after sized records and MUST NOT be displayed or sorted as zero.
  `Most messages` uses the indexed visible-message count. Non-chronological results do not show
  date-group headings because those headings would imply an ordering the list does not have. Sort
  is a fixed-size icon menu beside search; Agent and Workspace remain the two symmetric filter
  fields below it, and the result-count row contains no interactive control.
- Search queries the complete device-local index, including indexed visible message text, rather
  than only the currently loaded list page. Bounded list pages disclose loaded and total counts;
  the next-page command names how many records it will add and ignores a stale response after the
  query or filters change. The command stays out of the reading surface until the user reaches the
  end of the currently loaded list, remains visible with local progress while loading, and after
  appending records appears again only when the user reaches the new end.
- Indexed search uses a disposable full-text index when the bundled SQLite runtime supports it,
  with a literal bounded fallback for short queries or an unavailable tokenizer. Quick Open uses
  the same indexed ranking through a summary-only query that does not compute list facets or
  trigger source discovery. Matching excerpts are derived inside the read worker and remain
  bounded before crossing IPC.
- Agent filters show indexed counts for every enabled history-capable Agent. A zero count is an
  honest source state, not an implication that another Agent's records belong to that Agent.
  Metadata-only histories remain useful by displaying their source summary while clearly disabling
  transcript-dependent actions.
- During every refresh the last-good rows, inferred Agent icons, selection, and detail remain
  stable. An automatic refresh uses compact header progress and MUST NOT make the list, search, or
  detail inert. An explicit manual refresh MAY use the region-scoped progress overlay; that overlay
  blocks only the Conversation workspace, not application navigation, and MUST NOT depend on the
  current Target discovery array to identify already indexed Agent rows.
- The detail reader presents one task header followed by a readable transcript. Consecutive
  messages from the same role are grouped without changing message order. Visible Markdown,
  tables, lists, and fenced code MAY be rendered, but raw HTML is never executed, remote images
  are never loaded from history, and external links open only through the validated desktop API.
- Opening a full conversation initially reads only a bounded tail page so a very long transcript
  cannot saturate IPC or Markdown rendering. Earlier messages load in explicit bounded pages while
  preserving chronological order. Copy and Continue remain whole-conversation commands and fetch
  the complete indexed transcript only after the user invokes them.
- Opening a Conversation from an active search loads one bounded page centered on the first
  matching visible message, scrolls that message to the middle of the reading surface, and marks
  it with the shared selection accent. A title-, workspace-, or metadata-only match falls back to
  the ordinary bounded tail rather than loading the complete transcript. Selecting the already
  open row repeats the focus action so the match is recoverable after manual scrolling.
- Trae CLI conversation discovery selects the first available runtime from the resolved runtime, the active
  Trae config root's `cli` directory, and the default `~/.trae/cli` runtime in that order. It never
  mixes histories from separate runtimes or probes unrelated legacy products. One missing,
  malformed, or unreadable rollout is reported and skipped without hiding readable neighboring
  histories; an incomplete scan never removes the last-good Trae index.
- A stale search or refresh result MUST NOT replace a newer result. Initial cached loading and
  first-use source refresh are sequential so the workspace does not flash an empty duplicate load.
  Search input is debounced, query work is asynchronous, and older pending results cannot replace
  a newer query. Destination menus and review dialogs follow the shared keyboard, Escape,
  outside-click, focus-return, and viewport-containment contracts.

Source of truth: the original Agent history. AgentEnv owns only the disposable local index and
short-lived continuation artifacts.

### 4.6 Backup

A Backup is an immutable pre-operation snapshot used for recovery.

- Backup belongs to one operation and records its Profile and Target when applicable.
- Backup is not a Profile and MUST NOT silently become canonical content.
- A no-op MUST NOT create a Backup.
- A complete user-selected copy stored outside AgentEnv data is a Data Export, not a managed recovery Backup, and MUST NOT be removed by automatic retention.

### 4.7 Deployment State

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
- A Profile selection is three-state: missing means `Unchanged`, `enabled: true` means `On`, and `enabled: false` means `Off`.
- Returning a previously selected MCP to `Unchanged` MUST preserve its current native value and remove it from AgentEnv deployment state. It MUST NOT implicitly turn the connection off.
- The external v1 migration backup MAY retain legacy MCP Library references for recovery. Conversion maps known Target/name pairs to native Target selections once; v2 runtime MUST NOT read or write legacy definition references.

### 5.4 Target Identity

- Target ID is defined by its adapter and remains stable across path changes.
- Executable discovery determines whether the Target is installed.
- Missing configuration directories do not make an installed Target missing; writable directories MAY be created during Apply.

## 6. Command Semantics

| Command | Contract |
| --- | --- |
| Auto-save Profile | Persist the complete Profile after a semantic edit. It does not change any Agent. Explicit `Save` remains a document-editor or Capture-dialog command only. |
| Import | Copy or ingest a resource into the canonical Library. Imported content no longer depends on the original path for normal use. |
| Track source | Attach an explicit update source to a Library resource. It does not update immediately. |
| Check update | Compare canonical Library content with its explicit tracked source. It does not write. |
| Update | Replace canonical Library content after preview. It marks affected deployments pending; it does not deploy. |
| Add to Profile | Add a Library reference and auto-save the complete Profile. It does not Apply the Profile to an Agent. |
| Preview | Compute one fresh, complete deployment plan against current Profile, Library, and Target facts. It records the inventory fingerprint, approved transitions, expected content hashes, and backup scope without writing. |
| Apply | Freshly reconcile one saved Profile against one Target, verify that the reviewed Profile, Library, inventory, native state, policies, and live paths still match Preview, then execute that exact plan transactionally. Apply MUST NOT reinterpret the same facts through a second ownership planner. Every approved outside-path replacement is hash-checked again immediately before execution, and a multi-path failure uses compensating rollback. |
| Take over | First Apply to an unmanaged Target. It establishes ownership after previewing existing content. |
| Create from Target | Read a Target's portable environment into a new saved Profile and import reusable resources into Library without changing or taking over the Target. |
| Stop managing | End AgentEnv ownership through an explicit keep-current or restore-pre-takeover path. |
| Remove from Profile | Remove a reference from the Profile draft. It does not delete Library content. |
| Remove from Library | Delete canonical Library content only after references are resolved; managed installs are included explicitly. |
| Enable or disable Library Skill | Change global Library availability. It preserves content and Profile references and does not write Targets; affected Targets change only through their next Apply. |
| Merge Skills | Resolve duplicate Library identity after content, version, source, and reference review. It preserves the selected canonical entry, updates references transactionally, and retains recovery data. |
| Merge sources | Replace selected source records with one reviewed common scope. It changes update grouping and provenance only; it does not import, update, or delete Skill content. |
| Leave unmanaged | Record that AgentEnv must not mutate one concrete machine-local Skill path or collection. It remains visible; Profile reconciliation reports the effective local override until the boundary is removed. |
| Roll back | Restore one Backup and its associated deployment state after preview. |
| Adopt Target changes | Copy compatible managed Instructions and MCP activation intent into the saved Profile after preview and Backup. It does not adopt native settings, credentials, or Skill content outside the Library. |
| Change deployment mode | Persist a new default for future Skill Apply operations. It does not convert existing installs immediately and invalidates an open Preview. |
| Change Agent root | Persist one absolute adapter root after validation. It does not move files; subsequent discovery and Preview use the new root. |
| Workspace Connect | Preflight a candidate Git repository and branch, then atomically replace device-local Sync connection state. Failure preserves the previous connection. |
| Workspace Check | Fetch and compare remote, local, and accepted-base snapshots. It writes only device-local check metadata and cache. |
| Workspace Update | Apply one reviewed portable snapshot transactionally to Profile, Library, and source registry. It never applies a Profile to an Agent. |
| Workspace Publish | Publish the deterministic portable snapshot only when remote HEAD still matches Check. It never force-pushes. |
| Workspace Disconnect | Remove device-local Sync connection state and cache only. |
| Workspace Recover | Restore the protected Workspace recovery backup and re-check before further Sync mutations. |
| GitHub Sign in | Store the granted token through operating-system secure storage and verify account status. It does not alter Skill sources. |
| GitHub Sign out | Remove only the saved GitHub token and pending login session. Skill content, sources, update metadata, and Git credentials remain unchanged. |
| Export data | Create an independent validated data export without changing active data. |
| Restore data | Validate the selected export, create recovery data, atomically replace app-owned data, and restart against the restored root. It never writes Targets. |
| Delete or clean Backups | Remove only eligible app-owned recovery points after protected and failed entries are excluded. |
| Delete Profile | Delete only the saved recipe. It MUST NOT silently alter deployed Targets. |

## 7. Profile Lifecycle

The Profile editor MUST distinguish these states:

| State | Meaning | Primary action |
| --- | --- | --- |
| Saved | Visible Profile equals its durable AgentEnv copy. | Edit, choose Target, or Apply. |
| Saving | A complete semantic Profile change is being persisted. | Wait; navigation and close await the same queue. |
| Save failed | The latest edit is preserved in memory and persistence failed. | Retry or restore the last saved version. |
| Saved, never applied | Profile is valid but has no deployment on selected Target. | Preview Apply. |
| Saved, changes pending | Selected Target has an older Profile or Library version. | Preview Apply. |
| Applied | Saved Profile, effective Library versions, and managed Target files match. | No Apply action. |
| Applied with local overrides | The saved Profile is current, while one or more concrete device-local Skill paths remain outside AgentEnv management. | Review the named local overrides when needed. |
| Validation blocked | Saved Profile resources need correction before Apply. | Fix the named row or open the owning product area. |
| Drifted | Managed Target files changed outside AgentEnv. | Apply to create a fresh preview. |
| Recovery required | Target history requires intervention before normal Apply. | Open Recovery. |

Rules:

- Auto-save MUST persist the complete Profile, not an individual accordion section. A document editor's `Save` commits that document into the Profile and then joins the same complete-Profile persistence queue.
- Reverting an edit to the persisted intent MUST cancel the pending write and avoid a filesystem mutation. Explicit default resource policies are equal to their omitted representation. Keyboard shortcut, navigation, Compare, Apply, and programmatic flush paths share this semantic no-op rule.
- Auto-save MUST expose local working feedback immediately. Once persistence succeeds, Apply availability is recalculated from the returned saved Profile without waiting for Target discovery, inventory scanning, update checks, usage aggregation, or a full-page refresh.
- Agent selection, Apply, and overflow MUST appear as one compact action group in the selected Profile context. Compare, Undo, Recovery, Duplicate, and Delete belong to overflow; Apply Preview may expose Compare beside the commit controls.
- Apply keeps a stable label and position. It is disabled only while the Profile save queue is pending or failed, when no Target is available, when no change exists, or when validation prevents a truthful Preview.
- The commit verb remains `Apply` in Ready, Review, drift, and protected-replacement states. Backup and replacement safeguards are disclosed inside Preview; they MUST NOT rename the commit command to `Apply with backup` or introduce a parallel apply workflow.
- Readiness text describes the current state; it is not a second workflow. Only a condition that requires another product area exposes an inline remediation link: unavailable Target opens Agents and required recovery opens Recovery. Resource validation stays beside the affected Instructions, Skill, or MCP row. Preview blockers and drift do not expose a separate Review command because Apply already creates the authoritative fresh preview.
- Readiness remediation links MUST show a visible verb and object. Icon-only arrows and backend phase labels such as `Review preview` are not executable product intents and MUST NOT appear as commands.
- When no Target is selected, the visible Target selector remains the single selection entry point.
- Edit, Duplicate, Delete, Undo, Recovery, Target selection, Compare, and Apply are selected-Profile commands and MUST remain inside the selected Profile surface. Profile creation belongs to the Profile list header, beside the collection it changes; it MUST NOT be promoted into window chrome or mixed into the selected Profile lifecycle group.
- Every Profile row is a stable two-line selector: Profile icon and name with only exceptional persistence state such as `Saving...` or `Save failed` on the first line, then one compressed deployment summary on the second line. One Agent is shown as `Agent · Active`, `Agent · Pending`, or `Agent · Attention`; multiple Agents are summarized as `N Agents · State`, with the per-Agent states available from the row's accessible hover label. A Profile with no deployment shows only `Not applied`. Description, resource counts, preferred Target, provenance, and Agent artwork belong to the selected Profile detail, not the list. The deployment summary projects the canonical Target lifecycle state; the renderer MUST NOT independently recompute a competing current/pending result from a preferred-Target hash or version snapshot.
- The Profile list is always ordered by persisted creation time, newest first. Selection, the chosen Apply Agent, deployment state, auto-save, and Apply MUST NOT reorder it.
- Selected-Target lifecycle status belongs beside Agent selection and Apply inside the selected Profile surface. It MUST NOT be repeated as a separate page-level summary strip. When the Profile is active on multiple Agents, the same compact deployment projection used by the Profile list MUST also remain visible beside the selected-Target status so selection does not hide the Profile-wide application scope.
- Pending auto-save MUST delay Preview and Apply. A failed save blocks them while preserving the complete edit for Retry or restore.
- Switching Profile, Target, workspace, or closing the window MUST await an ordinary pending Profile save without a confirmation dialog. A failed Profile save and an unsaved Workspace file edit remain explicit recovery decisions.
- Failed validation or auto-save MUST preserve all draft input.
- Applying a Profile MUST NOT rewrite Agent-native configuration outside explicitly managed MCP activation fields.
- When exactly one installed Target is available, Profiles MUST show it as stable context instead of an option menu. When multiple installed Targets are available, Target selection remains available.
- Target selection is scoped to the selected Profile rather than the Profiles page. During an app session, each Profile remembers its own selected Target; otherwise the most recent active Target for that Profile is preferred, followed by its persisted preferred Target. Choosing a Target for one Profile MUST NOT change another Profile's destination context.
- A blank Profile is not created as Agent-bound. Its create dialog asks only for portable identity fields; the persisted preferred Target is an initial preview hint and is labelled `Preview Agent` when exposed after creation. `Source Agent` appears only when the user explicitly chooses Capture from Agent, and `createdFromTargetId` records provenance rather than compatibility.
- An empty managed Instructions value is a valid complete Profile state. Preview MUST describe it as clearing the managed instruction file rather than blocking Apply.
- On entry, Profiles SHOULD select the chosen Target's active Profile and open its Skills section for the common single-Target workflow. Selection MUST NOT add a redundant `Current` badge or pin and reorder the row; the row's Target deployment badges remain the source of application state.
- Profile name, description, icon, Instructions, Skills, and MCP intent share one serialized auto-save owner. Rapid edits MUST preserve the newest semantic value and MUST NOT let an older completion overwrite it.
- Before each non-no-op Profile replacement, AgentEnv stores a verified app-owned edit-history snapshot. `Profile Recovery` lists those earlier saved versions.
- Every successful Apply also records an immutable, Agent-specific Profile baseline in local Target state. `Restore last applied` restores the shared Instructions and Skills plus that Agent's resource policies from this baseline, while preserving Profile identity and policies for other Agents. It changes only the Profile and never rewrites Agent files; a non-drifted Agent should match again immediately.
- For pre-existing Target state without a baseline, AgentEnv may create one only when the current target-specific Profile hash and deployed Library versions still match the last successful Apply. It must never infer a baseline from a pending or drifted Profile.
- A Workspace has no separate Apply phase. `Undo last change` restores the file or Skill changed by AgentEnv's most recent completed Workspace mutation; `Recovery` lists older mutation receipts.
- Profile Skills MUST expose enabled and disabled Library references in one compact list. Each row has one identity line, one supporting line for version and source, one truthful state, one availability switch, and one overflow command. Full Library paths, applied revisions, alternate install names, and update details remain selectable through overflow detail or the row menu instead of becoming additional visible lanes. A mismatch, missing install, or pending removal is `Apply pending`. A matching device-local management boundary is shown as `External active` when it satisfies enabled intent, or `External still active` when it contradicts omit intent; neither state is presented as pending after a successful Apply. Ownership, update-source policy, source-check result, Profile availability, Target deployment, and local overrides are separate dimensions: the visible state shows only exceptional or currently actionable states. `Not tracked` MUST NOT be presented as an ownership or management state. Check updates checks only enabled tracked references in that Profile and appears only while at least one such reference is checkable or a check is already running; an unavailable check MUST NOT remain as a permanently disabled toolbar control. Add opens a searchable Library-only picker that identifies source, revision, and path and omits already attached or globally disabled Skills; Remove detaches a reference from the Profile without deleting Library content. A missing reference disables its availability control and offers Relink or Remove through the same overflow menu. Row menus MUST fit their longest localized command at the minimum viewport.
- Updating from Profile Skills still updates the global Library copy. The update confirmation MUST disclose how many Profiles reference it and whether Copy or Live link mode changes installed Targets immediately.

Status: v2 whole-Profile auto-save, recovery history, per-Target applied hashes, active-Profile focus, Profile-scoped Skill enablement, and per-Target MCP policy are `Implemented`. Compatible live Instructions can be adopted. Native configuration, Agent definitions, hooks, environment variables, credentials, and MCP definitions remain Target-owned.

## 8. Target Lifecycle

Target lifecycle MUST be represented as an explicit state, not inferred only from `managed`, hashes, or error counts.

Preview and lifecycle derivation MUST compare the same Target-materialized effective Profile: global Library availability, per-Target resource policy, local Skill boundaries, and shared-location preparations are resolved in the same order. A Preview with no file, resource, shared-preparation, or Target-state work MUST NOT coexist with `Changes pending` for the same Profile and Target facts.

A pending shared-location migration does not make an already deployed Agent copy absent. Lifecycle derivation excludes a prepared shared Skill only when the Target lacks both an `appliedLibraryVersions` receipt for its Library ID and a non-override `managed-active` receipt for that concrete deployment name. The Profile editor remains an editable declaration of the intended post-migration state, while the active shared runtime remains Agent-controlled. This keeps shared-area cleanup progress separate from whether the selected Profile is already active on the Agent.

```text
Missing
  -> Unmanaged          executable becomes available

Unmanaged
  -> Preview ready      valid saved Profile selected
  -> Applying           Take over confirmed

Applying
  -> Applied            transaction succeeds
  -> Applied with local overrides
                        transaction succeeds with device-local boundaries
  -> Apply failed       writes fail and automatic restore succeeds
  -> Recovery required  writes and automatic restore both fail

Applied
  -> Changes pending    Profile or referenced Library version changes
  -> Drifted            managed Target content changes externally
  -> Unmanaged          Stop managing completes

Applied with local overrides
  -> Changes pending    Profile, effective Library version, or management boundary changes
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
| Applied with local overrides | Target-specific Profile hash and effective managed resources match, while one or more device-local management boundaries produce stable external outcomes. Those Skills are excluded from applied Library versions and represented by reconciliation receipts. |
| Changes pending | Saved Profile or referenced Library content differs from deployed versions. |
| Drifted | One or more managed Target resources differ from their applied snapshot. |
| Apply failed | Apply failed and the automatic restore succeeded. |
| Recovery required | Apply or rollback failed and AgentEnv cannot prove a consistent state. |

The renderer consumes this canonical lifecycle as the authority for `Applied` versus `Changes pending`; a missing or delayed renderer-side hash MUST NOT downgrade an explicit `Applied` state. If an Apply reaches a semantic no-op, the client MUST refresh Target inventory and lifecycle state before presenting the reconciled result.

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
- Every built-in Target MUST pass one shared conformance suite for command discovery, read-only Capture, A-to-B replacement, restart persistence, semantic no-op, ownership policy, stale Preview rejection, and exact failure rollback. Target-specific happy-path tests are not a substitute.
- Compatibility evidence MUST include materialized machine-layout fixtures for legacy and current paths, symbolic-link roots, broken resources, and externally owned resources where the Target supports them.
- An adapter MUST NOT receive arbitrary native configuration from a Profile.

Status: adapter capability declaration, effective-payload review, cross-Target Instructions and Skills, and Target-specific native MCP activation are `Implemented`.

## 10. Preview Contract

Preview is the sole write gate for Profile deployment.

Preview MUST:

1. Use the latest saved Profile.
2. Resolve current canonical Skill Library versions and, only for a managed destination policy, the selected native MCP definitions.
3. Read current Target files and deployment state.
4. Describe every managed text and resource change.
5. Separate the final effective payload from this Apply's actual add, replace, remove, cleanup, warning, preservation, or blocking effects.
6. Include destination paths and human-readable resource identities.
7. Indicate whether the Target is being taken over or switched.
8. Leave the Target unchanged.

Preview hierarchy MUST name the Profile and Target, then show one of `Ready to apply`, `Review required`, or `Cannot apply` before any evidence. Apply issues use a structured disposition rather than message parsing:

- `notice`: AgentEnv will preserve or handle the condition automatically; it does not require a decision.
- `review`: AgentEnv has one deterministic, complete mutation plan with an exact affected path, Backup, verification, and rollback. Confirming this Preview is the explicit authorization; a second checkbox or confirmation step MUST NOT be required.
- `block`: AgentEnv cannot produce a deterministic complete plan without changing Profile intent, crossing an unsupported path boundary, resolving ambiguity, or recovering damaged state. Evidence that another tool may have written a path is not a blocker by itself.

Issue disposition and recovery are owned by one Agent-neutral policy keyed by stable issue code. Target adapters and resource scanners report capabilities and concrete facts; they MUST NOT independently promote the same fact to a stronger disposition. Expected product conditions MUST use a specific issue code. Generic blocking issues are forbidden.

The complete issue policy is normative:

| Issue code | Disposition | Resolution | Product fact |
| --- | --- | --- | --- |
| `target-unavailable` | `block` | `external-action` | The selected Agent executable or required destination is unavailable. |
| `profile-validation` | `block` | `edit-profile` | Saved Profile intent is incomplete or invalid. |
| `secret-warning` | `notice` | `automatic` | Sensitive native content is excluded or redacted. |
| `native-setting-preserved` | `notice` | `preserve` | Agent-owned native configuration remains unchanged. |
| `instruction-alias` | `notice` | `preserve` | Another supported instruction alias remains Agent-owned. |
| `invalid-native-config` | `block` | `external-action` | Native configuration cannot be parsed safely. |
| `missing-native-mcp` | `block` | `edit-profile` | Profile requests an MCP connection absent from the Agent. |
| `unsupported-mcp-management` | `block` | `edit-profile` | Profile requests MCP control the adapter cannot provide safely. |
| `target-instruction-limit` | `block` | `edit-profile` | Profile Instructions exceed an Agent capability. |
| `runtime-reload-required` | `notice` | `external-action` | Applied Instructions require a new Agent session before they enter runtime context. |
| `duplicate-native-mcp` | `block` | `external-action` | One MCP identity is defined ambiguously in multiple native locations. |
| `agent-owned-native-mcp` | `block` | `external-action` | Requested MCP activation is owned by an unsupported Agent surface. |
| `unsafe-native-mcp-update` | `block` | `external-action` | The native MCP activation field cannot be changed without touching unrelated settings. |
| `globally-disabled-skill` | `notice` | `automatic` | A Profile reference is omitted because its Library Skill is globally disabled. |
| `missing-library-skill` | `block` | `edit-profile` | A Profile references missing canonical Library content. |
| `outside-skill-replacement` | `review` | `backup-replace` | A writable Target Skill outside AgentEnv must be replaced to satisfy Profile intent. |
| `outside-skill-removal` | `review` | `backup-replace` | A writable Target Skill outside AgentEnv must be removed to satisfy complete replacement intent. |
| `unmanaged-skill-location` | `notice` | `preserve` | A device-local management boundary prevents AgentEnv from mutating this Skill path. |
| `managed-resource-drift` | `review` | `backup-replace` | An AgentEnv-owned resource changed outside AgentEnv. |
| `managed-resource-missing` | `notice` | `automatic` | A missing AgentEnv-owned resource will be restored from canonical intent. |
| `duplicate-runtime-skill` | `block` | `edit-profile` | More than one enabled Profile resource resolves to the same runtime identity. |
| `native-disabled-skill` | `block` | `external-action` | The Agent's native settings disable a Skill required by the Profile. |
| `runtime-observation` | `notice` | `preserve` | Read-only runtime evidence is disclosed without mutation. |
| `runtime-state-unavailable` | `block` | `external-action` | Required runtime state cannot be inspected reliably. |
| `runtime-skill-conflict` | `block` | `external-action` | Runtime discovery reports ambiguous or conflicting Skill identity not already resolved by an exact reviewed mutation in this Preview. |
| `unsupported-skill-management` | `block` | `edit-profile` | Profile requests Skill management unsupported by the adapter. |
| `shared-skill-conflict` | `block` | `review-local-skills` | Shared compatibility content conflicts with canonical intent and must open the exact Local Skills collection review. |
| `shared-skill-deferred` | `notice` | `preserve` | Shared compatibility content remains until all consumers have explicit intent. |
| `skill-root-isolation` | `review` | `backup-replace` | A linked Agent Skill root will be isolated without modifying its destination. |
| `invalid-skill-root` | `block` | `external-action` | The Agent Skill root is an unsafe non-directory boundary. |
| `recovery-required` | `block` | `open-recovery` | An interrupted mutation must be recovered first. |
| `operation-precondition` | `block` | `external-action` | A named non-editable precondition prevents a deterministic plan. |
| `operation-notice` | `notice` | `preserve` | A named operation fact requires disclosure but no action. |

Every issue row MUST include a concrete resource identity when one exists. Every `review` issue MUST include its exact affected path. A policy change requires a product-contract change and automated contract-policy verification in the same commit.

True blockers appear before the change plan. Replaceable Agent drift, an ordinary writable destination outside AgentEnv, and a Target Skills root link are review requirements rather than duplicate blockers. `After Apply` describes the final effective Instructions, Skills, and MCP payload; `Changes this Apply` contains only actual mutations grouped by semantic resource type. Concrete identities and actions precede secondary filesystem detail. Full paths remain selectable through hover/focus detail, file diffs expand on their owning rows, and local overrides and non-blocking notes remain collapsed after the change plan. Header and footer stay fixed while one dialog body owns vertical scrolling; only large diff content may own nested code scrolling. Preview does not display generation timestamps because freshness is enforced by the stale-preview contract rather than user inspection.

Managed Skill drift compares canonical Skill content rather than symbolic-link text. A Live link or managed copy that exactly matches the currently referenced Library content is an expected Library transition, not an external Agent change. Every genuine drift issue names the concrete Skill and exposes its selectable path; repeated anonymous Target-level warnings are forbidden.

A Preview becomes stale when any of these changes:

- Saved Profile content.
- Referenced enabled Library Skill content or a native MCP definition inspected by the selected Target's managed policy.
- Any live file or resource included in the plan.
- Deployment state.
- Selected Target or the adapter-resolved configuration, runtime, Instructions, MCP, Agent, or Skill paths for that Target.

Skill inventory freshness is a semantic projection, not a fingerprint of every discovered Skill. It includes exact Profile destinations, relevant runtime-name conflicts, Profile-referenced resources, AgentEnv-owned cleanup candidates, and shared compatibility facts used by the plan. An unrelated local Skill that cannot change the reviewed result MUST NOT stale Apply.

Apply MUST reject a stale Preview before writing. The client SHOULD refresh that Preview in place and require confirmation of the refreshed effects instead of presenting stale data as a permanent blocking issue. A concurrent operation is a temporary working state, not a resource conflict; it MUST NOT be rendered as a permanent Preview blocker.

No-op contract:

- A Preview with no changes MUST produce `Applied`, or `Applied with local overrides` when a current reconciliation receipt records a device-local override.
- The confirmation action MUST be unavailable.
- No Backup, history record, or timestamp update is created.
- Identical managed Skills MUST NOT be reported as replace operations.

Status: stale checks and no-op detection are `Implemented`.

## 11. Apply And Takeover Contract

Apply means complete replacement of the AgentEnv-managed portion of one Target with one saved Profile.

Instructions and dedicated Skill deployments may be fully AgentEnv-owned paths. Agent native configuration remains shared and Agent-owned except for explicit sparse MCP activation fields. OpenCode Legacy may patch only `mcp.<name>.enabled`, while OpenCode V2 may patch only `mcp.servers.<name>.disabled`; Codex may patch only `mcp_servers.<name>.enabled`; Trae CLI's TOML layout may patch only `mcp_servers.<name>.enabled` in `traecli.toml`, while its YAML compatibility layout may patch only an existing MCP's `disabled` field in `traecli.yaml`. Claude Code, Antigravity, Pi, and any adapter without a verified activation field MUST NOT write MCP configuration.

When the selected Target's MCP policy is `Keep current`, Apply MUST preserve its configuration byte-for-byte, omit the path from Preview freshness and Backup, and clear prior MCP ownership metadata. When the policy is `Use Profile` or `Turn off`, the adapter parses the current file, patches only named existing activation fields, preserves every definition and unknown field, and includes that file in freshness and Backup only when a semantic change is planned. Configuration files MUST NOT be recorded as whole-file AgentEnv-managed resources.

It MUST:

1. Revalidate Preview freshness immediately before writing.
2. Create a Backup of every affected live path and deployment state.
3. Write all planned text resources.
4. Install, replace, or remove all planned managed resources.
5. Preserve observe-only resources and locations covered by a device-local management boundary.
6. Write deployment state only after all resource writes succeed.
7. Record one history entry only after success.
8. Refresh visible Profile and Target state after completion.

Preview MUST also summarize the local footprint as adopted existing resources, modified paths, created paths, removed paths, and live links. Zero-write adoption is distinct from replacement. Internal Target-state and Backup files remain under AgentEnv's data root and are not presented as extra Agent files.

Apply executes the immutable Preview plan. It MAY re-read and hash the plan's bound preconditions, but MUST NOT rerun runtime conflict classification, asset ownership classification, backup-path discovery, or stale-resource discovery after confirmation. Newly discovered facts outside the reviewed plan remain untouched. A changed bound precondition returns `stale` before Backup or mutation.

Switching Profiles MUST reconcile every writable Skill location declared by the selected Target adapter. Skills absent or disabled in the Profile are removed from managed locations; content outside AgentEnv is changed only when the fresh Preview names the exact backup-and-replace or backup-and-remove effect. Observe-only locations and locations covered by `Leave unmanaged` remain unchanged. MCP choices absent from the sparse policy remain Agent-controlled.

A same-name Skill replacement outside AgentEnv MUST be scoped to exact paths named by the fresh Preview, included in the operation Backup, and installed atomically as an AgentEnv-owned resource. Confirming that Preview authorizes only those named paths. External-tool evidence does not create a blocker by itself; an unsupported or observe-only path capability does.

If Capture or Profile reconciliation selected one runtime Skill while another exact writable path
declares the same runtime name, Preview MUST expose the unselected path as a reviewed backup-and-remove
or backup-and-replace effect. Runtime validation MUST accept that exact fresh mutation plan instead of
reporting the same path again as an unresolved conflict. Same-name paths outside the reviewed plan,
observe-only paths, and ambiguous collection boundaries remain blocking.

Takeover is the first Apply to an unmanaged Target. Preview MUST disclose:

- Existing content that will be replaced.
- Existing content that will be adopted, reviewed for replacement or removal, left unmanaged by a device-local boundary, or observed without mutation.
- Conflicts that prevent takeover.
- Backup availability.

Status: transactional backup, reviewed outside-path replacement, kept-path preservation, and automatic restore are `Implemented`.

Minimal-footprint takeover, central deployment receipts, markerless new deployments, and first-run telemetry consent follow [the dedicated feature contract](superpowers/specs/2026-08-11-minimal-footprint-takeover-design.md).

## 12. Failure And Atomicity Contract

Apply is a single transactional user operation even when it writes multiple resource types. It is not a filesystem-atomic operation across paths.

- The stable shell, Agent inventory, Profile summaries, Library contents, and Settings are startup
  core data. Optional recovery history, update checks, source observations, native diagnostics, and
  other derived enrichment MUST NOT prevent those core surfaces from loading.
- Global navigation destinations and their order MUST be present from the first shell paint.
  Asynchronous Agent discovery may update the Agents page and Local Agents summary, but MUST NOT
  insert, remove, or move the Agents navigation destination or show a false empty state while the
  initial discovery is pending.
- Every cold renderer start selects Agents before optional enrichment begins. Conversation
  indexing and every other background completion MUST preserve both that initial destination and
  any later workspace explicitly chosen by the user.
- Listing recovery history MUST isolate malformed, missing, or path-unsafe neighboring Backups. A
  rejected Backup remains byte-for-byte unchanged and unavailable for Restore; valid Backups remain
  visible. Restore continues to perform the complete strict path and manifest validation before any
  write.
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
| Apply | Preserve replaceable live drift in a Backup, then deploy the saved Profile through the ordinary Apply transaction. |
| Restore previous deployment | Restore the most recent known-good AgentEnv deployment. |
| Stop managing and keep current | Detach ownership while preserving current files. |
| Ignore for now | Keep the Target visibly Drifted and block ordinary Apply. |

One drifted path MUST produce one reconciliation problem. If another writer replaces a previously managed Skill or removes its ownership marker, Preview MUST report the managed drift instead of also reporting a generic outside-destination collision. Ordinary `Apply` MAY replace only the exact drifted or outside paths recorded by the fresh Preview after its Backup guarantee is disclosed; unrelated observe-only paths remain untouched.

Drift adoption MAY update portable Instructions and the existing sparse MCP selections for that same Target. It MUST NOT adopt arbitrary native configuration, create MCP definitions, or add Target-owned Skills automatically.

Status: detection, diff inspection, explicit overwrite with Backup, compatible Instructions and managed MCP activation adoption, and detach choices are `Implemented`. Target-owned Skills, native configuration, excluded credentials, and MCP definitions remain intentionally non-adoptable.

## 14. Stop Managing Contract

Stopping management is distinct from deleting a Profile.

Two paths are required:

### Keep current environment

- Back up current managed resources and state.
- Materialize AgentEnv-managed Skill links as independent copies where possible.
- Remove AgentEnv deployment state and any validated legacy ownership markers.
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
- Rollback MUST restore files, directories, links, permissions, deployment state, validated legacy ownership markers, and originally absent managed directories consistently.
- Rollback MUST detect live changes made after the Backup and require explicit confirmation before replacing them.
- A Rollback Preview becomes stale when any affected live path changes after Preview. Rollback MUST reject the stale plan without writing and require a fresh Preview.
- Confirming a fresh Rollback creates a second safety Backup of the current paths before restoring the requested Backup. Each destination is hash-checked against that safety snapshot immediately before its first mutation. If requested restoration fails, AgentEnv restores the safety Backup; if both restores fail, both Backup IDs remain protected in `Recovery required` rather than being hidden or removed.
- New managed Backups are prepared in a private sibling staging directory, copy and re-hash files, directories, and symbolic-link metadata, flush the complete payload, then publish the directory atomically. The v2 manifest has its own SHA-256 receipt and every non-missing entry has a content hash. Existing pre-v2 Backups remain readable through strict path/type validation and an in-memory content-hash baseline; AgentEnv never rewrites them merely by listing or previewing them.
- A successful rollback MUST refresh Target lifecycle and active Profile metadata.
- Backups MUST be retained until explicitly removed by the user or a documented retention policy.
- Settings owns the global managed-backup inventory, storage usage, retention policy, explicit deletion, and policy cleanup entry points. Contextual Target and Skill surfaces continue to own Restore.
- Selecting one managed Backup opens a read-only manifest preview of every affected file or
  directory path. The Preview is loaded on demand through the validated Backup store, distinguishes
  paths that were absent before the operation, keeps long paths selectable, and performs no live
  filesystem mutation or unbounded directory scan.
- Automatic retention applies only to managed Target recovery and Skill cleanup Backups. `Never`, `7 days`, `30 days`, and `90 days` are the supported policies. New installations default to `30 days`; an existing explicit `Never` choice remains unchanged.
- A Backup referenced by `Recovery required`, its rollback safety Backup, and the earliest Apply Backup for every currently managed Target are required recovery state and MUST NOT be deleted manually or automatically.
- The latest Target recovery point MUST be retained from automatic cleanup, but MAY be explicitly deleted after impact confirmation when it is not otherwise required.
- Changing the retention policy saves future cleanup behavior and MUST NOT silently delete data in the same interaction. `Clean up now` previews the eligible count and size before deletion.
- Deleting or cleaning Backups MUST NOT modify Profiles, Library resources, current Target files, or external Data Exports. Partial cleanup reports both deleted and failed items.
- Backup storage measurement and deletion MUST NOT follow symbolic links outside managed backup roots.
- A failed rollback enters `Recovery required`.

Status: Apply and cleanup rollback, stale rollback conflict handling, managed storage inventory, explicit deletion, protected recovery points, and retention cleanup are `Implemented`.

## 16. Skill Library Contract

### 16.1 Import

- Import from a local folder copies canonical content into the Library.
- Import presents only `Local` and `Repository` as source modes. A local selection MAY be one Skill directory, a containing directory with multiple nested Skills, or a ZIP archive; a separate Workspaces workflow or saved-location concept MUST NOT duplicate this intent.
- Selecting a local directory scans it read-only. Import copies only selected Skills through the same Preview, duplicate-review, validation, Backup, and atomic Library-write contract as other imports and MUST NOT modify the selected directory.
- A ZIP is a one-time import transport, not a continuously checked source. AgentEnv extracts it only into an isolated temporary directory; rejects encrypted entries, links, path traversal, duplicate paths, unsupported compression, excessive entry counts, and declared or observed expansion beyond fixed limits; and removes the temporary copy when the import dialog closes. Library metadata MAY retain the original archive path as provenance but MUST NOT retain the temporary extraction path or enable update checks by default.
- A folder or ZIP containing multiple valid Skills exposes one `Import all` command. It runs the ordinary per-Skill Preview and conflict flow sequentially, reports failures beside the affected Skill, leaves other candidates available, and never bypasses duplicate decisions. The dialog exit command is `Close`; mutation commands keep their own progress state.
- A local source scan produces one candidate per canonical Skill path. Generated dependency/build directories and directory symlinks are excluded, and bounded scans disclose truncation instead of silently appearing complete. An unreadable root or candidate remains a local warning while healthy candidates remain usable.
- Local candidates show a trustworthy `SKILL.md` modification time when available. Invalid or unreadable candidates display an unknown time rather than a fabricated epoch value. A failed candidate import retains the scanned row, shows the complete selectable failure locally, and offers Retry without rescanning unrelated candidates.
- When the selected local folder is an adapter-declared Target Skill location, Import MUST back it up and replace it with a managed link or copy in the same transaction. A successfully managed source MUST NOT remain in Needs attention as a duplicate.
- Local folders outside supported Target locations remain independent provenance sources and are not modified.
- Normal use MUST continue if the original folder is later deleted.
- The original local path is retained as provenance, but local imports default to the `Untracked` update policy.
- A user MAY explicitly track a stable local folder as an update source.
- Repository import MUST store the sanitized repository locator, explicit ref, directory, resolved commit, and Skill-subtree revision. GitHub API imports remain `sourceType: github`; System Git imports use `sourceType: git`.
- Repository scan results keep summary, optional guidance, and selection controls in one opaque,
  content-sized header. Only the candidate list scrolls. Adding or removing truncation or index
  guidance MUST NOT change the list's grid ownership, paint candidates beneath the selection row,
  or cover the first candidate at any supported viewport.
- Persisted update-source types remain `local`, `github`, and `git`. ZIP is represented only as local import provenance and MUST NOT become a hidden continuously checked source type.
- Selecting a Library Skill name opens a read-only file browser. The name is the only file-browser trigger in the row and exposes pointer, hover, and keyboard-focus affordances; clicking the description, source, version, usage, status, install data, or row background MUST NOT open it. The browser lists only regular files contained by the canonical Library Skill, hides AgentEnv metadata, skips links, rejects escaped or resolved-outside paths, previews text with syntax highlighting, and reports binary or oversized files without decoding them. Browsing never changes the Skill, its source, a Profile, or an Agent install.
- Repository imports default to the `Tracked` update policy. The canonical HTTPS source locator is durable metadata. A Git web directory URL using `/tree/<ref>/...` or `/blob/<ref>/...`, including the GitLab-style `/-/` separator, MUST be split into the clone repository, ref, and requested directory before any Git command runs. For a System Git import on any host, an HTTPS authentication, authorization, or repository-access failure MAY retry the equivalent `git@host:path.git` locator through the user's existing SSH setup. Timeout, DNS, malformed URL, parse, cancellation, and ordinary network failures MUST NOT trigger a transport fallback. The scan summary discloses `SSH fallback`, while persisted provenance keeps the canonical HTTPS source and records the access transport separately.
- A GitHub Web URL MAY identify a Skill directory, a containing directory, or a repository. Other Git Web URLs MAY infer Ref and Directory only from the explicit and structurally unambiguous `/tree/<ref>/...` or `/-/tree/<ref>/...` forms; all other provider-specific layouts use separate Ref and Directory fields instead of guesswork. A supplied subdirectory is a hard scan boundary: no candidate outside it may appear. The only exception is a readable `llms.txt` in that exact directory that explicitly links repository-relative `SKILL.md` files: AgentEnv MAY expose only existing, traversal-free, same-repository links, MUST disclose the expanded scope before Import, and records their common repository ancestor as the reviewed source scope. External URLs, missing paths, traversal, and unindexed Skills remain excluded. When a non-root directory directly contains `SKILL.md`, it is otherwise the sole candidate. A repository-root router `SKILL.md` MUST NOT hide sibling top-level Skills. Containing-directory and repository imports MUST scan recursively for valid top-level Skill roots before any Library write.
- `github.com` Web URLs use the GitHub API by default. SSH, SCP-like, non-`github.com`, and explicitly selected System Git locators use the packaged application's discovered system `git` executable and the user's existing SSH Agent or Git credential helper. AgentEnv MUST NOT store Git passwords, access tokens, private keys, or credential-helper output.
- In `Automatic` connection mode, a GitHub API 401, 403, or private-repository-style 404 MAY retry through System Git and then the equivalent GitHub SSH transport under the same access-failure boundary. Rate limits, network failures, and malformed URLs MUST NOT trigger this fallback. When automatic fallback cannot proceed, the user MAY explicitly choose `Try with System Git`.
- Scan results MUST appear in a confirmation dialog, select all importable candidates by default, allow individual candidates to be excluded, and identify already-imported or duplicate candidates without selecting them. The bulk-selection control MUST expose all, mixed, and none states while keeping its label and selected count aligned without overlap at the minimum supported viewport.
- A batch import MUST process selected candidates sequentially in the same dialog. Each candidate advances through distinct queued, reviewing, writing, completed, failed, or skipped states; only the current candidate may open the conditional duplicate review.
- A candidate becomes completed only after its canonical Library write has returned successfully. Completed candidates remain visible and preserved when a later candidate fails or is skipped.
- While a batch is active, `Stop import`, Escape, or the dialog close control requests a cooperative stop and keeps the result dialog visible. A write that already completed remains completed; a cancelled review or write and every candidate not yet started become `Skipped`, not failed. Each skipped row exposes an independent `Import` action.
- After the final candidate, the dialog MUST show one aggregate success or partial-failure result and remain open until the user explicitly closes it. A batch import MUST report each failure against its source. Failed rows use a compact failure state and expose the complete selectable error in a hover/focus detail layer.
- Scan, Preview, and the immediately following Import MAY reuse the same successful Repository snapshot or GitHub response. Explicit Scan and Check updates MUST contact the source, but a System Git check MAY compare the advertised remote ref with its verified cached ref and skip a redundant fetch when they are identical. Identical requests that are concurrently in flight remain coalesced. Update Preview reuses a fresh immutable result from the immediately preceding check; when that result is absent or expired, Preview performs a fresh read. Materialization MUST use one repository tree and bounded parallel file reads rather than recursively serializing one remote request per directory and file.
- A multi-Skill GitHub check groups Skills by repository and ref, reads one complete commit tree per group, and derives each Skill-subtree revision from that shared immutable tree. Per-Skill commit-time requests run only for changed candidates. A just-imported tracked Skill immediately replaces any stale same-ID check result with its persisted revision and MUST NOT display `Update available` until a later fresh check proves a difference.
- Every Skill has an independent `Tracked` or `Untracked` update policy. `Untracked` excludes that Skill from the global Updates result, update reminders, and batch Update review. An explicit source-level `Check` MAY still read its source to update the source projection without creating a Skill update reminder.
- A Skill row overflow is a compact command menu. Update source and tracking fields live in one focused `Update settings` dialog and MUST NOT turn the row menu into a scrolling form. Source and tracking edits remain staged until one `Save settings` command succeeds; closing the dialog discards both, and a partial visual save MUST NOT imply that only one field was persisted.
- The UI status for this durable policy is `Monitoring off`; temporary wording such as `Checks off` and source-type wording such as `Fixed copy` MUST NOT substitute for the policy.
- The global auto-check setting controls scheduling only. New installations default to one check per day to avoid noisy network work and routine provider rate limits; an existing explicit interval remains unchanged. Within that schedule, only source groups whose routine-check policy is `Monitored` are read; results are surfaced only for member Skills whose independent policy is `Tracked`.
- Legacy metadata without an explicit policy defaults to `Untracked` for local sources and `Tracked` for GitHub API and System Git Repository sources.
- Import validates `SKILL.md` and rejects unsafe or ambiguous directory layouts.
- Skill version metadata is normalized from either ClawHub's top-level `version` field or Agent Skills' `metadata.version` field. String and numeric scalar versions are accepted. Conflicting values declared in both locations are rejected rather than silently prioritized.
- Library identity is the stable `id`; duplicate detection uses the normalized frontmatter `name` and also guards storage-ID collisions. Import MUST NOT silently create a suffixed ID when a same-name Skill exists.
- A same-name import opens one conditional review step before any write. It compares declared version, full content hash, source, modified time, `SKILL.md`, and every changed file against each matching Library entry. Modified time uses the upstream Skill-subtree commit time when available and otherwise the local `SKILL.md` modification time; unavailable values remain explicitly unknown. Identical content is labelled explicitly and can only reuse the existing entry. Different content always presents the same three persisted outcomes: keep the current Library copy without changing the incoming source, replace a selected Library entry, or save under a system-derived unique ID shown in the decision row. Internal Library identity MUST NOT appear as an unexpected required form field.
- Import comparison treats trackable online provenance as part of the Skill's useful state. When content is identical but an incoming Repository source differs from or improves on the existing local provenance, the review labels `Source available` and offers `Update source`. This operation preserves every Skill file and stable Library ID while updating source, revision, upstream, transport, and `Tracked` policy metadata. Different local paths alone do not create a source conflict, and a local import never silently downgrades an existing online source.
- When an online source exposes a verified commit time for the Skill subtree, AgentEnv stores it separately from the local Library write time. Generic Git reads use one batched path-history query over a bounded blobless history window and MUST omit a path time when its newest visible match is the shallow-history boundary; a repository HEAD time is never substituted for a Skill path time. The Skill list and duplicate-import comparison label this as the upstream update time; unavailable source time is omitted rather than inferred from repository or local file timestamps.
- Replacing preserves the selected Library ID so Profile references remain valid, preserves Library-only presentation and availability metadata, backs up the current content, and atomically installs the reviewed source. Saving another copy makes the duplicate IDs visible in the Skill list so intentionally same-name entries remain distinguishable.
- Import commit MUST verify the reviewed incoming content hash. A local or remote source that changes after review is rejected without modifying Library.
- Local import MUST distinguish a non-destructive `Import copy` from `Import & manage` for a folder already inside a Target. Before `Import & manage`, the UI discloses that AgentEnv will back up the Target copy, import it to Library, and replace that location with a managed installation.
- A selected canonical Library directory or AgentEnv-managed deployment MUST NOT be re-imported as a duplicate. A same-name Library conflict stays inside the Import intent and uses the shared duplicate-review workflow; it MUST NOT redirect the user to Scan local.
- A failed local or external import MUST preserve the selected source and keep its dialog open so the user can retry or inspect the global error.
- An online Library Skill without a custom icon uses the source site's favicon when it can be loaded and falls back to its source type when it cannot. Local Skills fall back to the folder icon. A user MAY replace that automatic artwork with a built-in icon or restore automatic source artwork. Only the custom override is presentation metadata; it MUST survive content updates and clearing it MUST NOT change source metadata.
- `SKILL.md` frontmatter MUST be parsed as YAML rather than with line-oriented string matching. Folded, quoted, and multiline values remain valid.
- System Git uses one disposable Bare Repository Cache per sanitized locator. The Cache lives under the operating system cache root rather than AgentEnv data storage, is excluded from Data Backup, and MAY be deleted or rebuilt without changing Library, Profiles, or Targets.
- A Repository scan or fetch failure MUST leave existing Library content available and MUST NOT block Profile Save or Apply. Repository operations never modify or pull a user's existing checkout.
- Cancel, Escape, window close, and application quit MUST terminate active System Git processes without disposing the Repository service for later operations. GitHub API operations are not silently converted into System Git operations when cancelled or failed.

### 16.1.1 Refresh

- `Refresh` rescans canonical Library content and local install state; it does not contact tracked update sources.
- `Check updates` is the separate command that contacts tracked sources.
- A complete source read that verifies the tracked directory no longer contains `SKILL.md` is a successful `Removed upstream` observation. It is not an update and not a failed check. The Library copy remains unchanged, the Skill stays visible in `Enabled`, and it is excluded from `Updates` and bulk update review until the source is changed, tracking is disabled, or the Library copy is explicitly removed.
- An incomplete, failed, cancelled, rate-limited, or truncated source read MUST NOT infer `Removed upstream`. A stale `Update available` row whose Preview verifies removal MUST converge in place to `Removed upstream` without opening an empty diff or raising a diagnostic failure.
- `Cmd/Ctrl+R` in Library/Skills invokes the same in-place Refresh command and MUST NOT reload the renderer.
- Refresh MUST preserve the current search, filters, scroll context, and rendered Skill list until replacement data is ready. It MUST NOT flash a temporary empty state.
- Update and install-repair facts MUST remain in `Status`, while their one current direct command appears in the adjacent `Action` lane. The trailing `More` lane is reserved for the overflow menu and MUST NOT absorb or displace that labelled direct command.
- Row actions and their secondary revision or install state MUST occupy independent vertical tracks. A control's rendered height MUST fit inside its track, with at least `4px` clear space before secondary text; child overflow MUST NOT be used to compress the row.

### 16.1.2 Tags

- Tags are optional user-owned Library metadata used to organize Skills by task. They are stored only in AgentEnv metadata, never written to `SKILL.md`, Profile references, Workspace copies, or Agent directories.
- A Skill may have at most 12 tags of at most 32 characters. Input is Unicode-normalized, trimmed, whitespace-collapsed, and deduplicated case-insensitively while preserving the user's canonical spelling.
- Skill content updates and reimports preserve existing tags. Merging Library Skills produces the case-insensitive union of their tags. A semantic no-op tag save performs no metadata write.
- Portable Workspace Sync includes tags because they describe the reusable Library object; Target deployment and Profile Apply ignore them.
- The Skill List keeps tags with the Skill identity rather than adding a table column. Selecting a tag applies one exact filter, and the Filters panel exposes the same exact tag set. By Source remains a source-health projection and does not duplicate tag filtering.
- The shared Library Skill picker used by Profiles and Workspaces and global Quick Open match tag text. Tags do not change Skill availability, update policy, source grouping, Profile membership, or deployment state.

### 16.1.2 Source view

- `Skill list` remains the canonical Library resource view. `By source` is a peer view inside Skills, not a separate navigation area, source subscription system, or replacement for per-Skill management.
- A source group is identified by one deterministically normalized complete import scope. Repository sources use repository identity, ref, directory, and an optional reviewed `llms.txt` index path; an indexed suite and a full-directory source are distinct even when their common directory is identical. Every later Check MUST reuse the saved index so unlisted repository Skills do not reappear as `New`. Local sources use one canonical absolute root directory. Parent and child scopes and unrelated complete links MUST remain separate until the user explicitly merges them. Similarity, URL prefixes, Skill names, and matching content MUST NOT merge groups automatically.
- Every external, re-readable import scope becomes a source group whether it contains one Skill or many. Repository and local directory imports record the reviewed scope plus each Skill's relative source path. Legacy online or ordinary local imports without collection metadata appear as exact one-Skill source groups without rewriting their files. Agent runtime install locations and the AgentEnv Library are deployment/canonical locations, not upstream source groups.
- A group exists only while at least one current Library Skill belongs to it. Removing the final member removes the projected group; there is no independent source-delete workflow.
- Source checks are read-only with respect to Library, Profiles, and Targets. They may update only rebuildable cache data. A failed, cancelled, rate-limited, truncated, or otherwise incomplete scan MUST preserve the last successful complete observation and MUST NOT infer upstream removal.
- Each group exposes the complete selectable source address, last check state, and distinct total, update, new, and removed counts. Expanding the group maps each remote candidate to its current Library relationship and exposes at most one contextual action.
- `New` uses the existing reviewed repository import flow, `Update available` uses the existing immutable Update Preview, and `Removed upstream` uses the existing Library delete confirmation and reference safety. A check MUST NOT automatically add, update, delete, disable, or detach a Skill.
- Source status and per-Skill Update Preview MUST converge on the verified file content. When Update Preview proves that the upstream files and Library files are identical despite different revision encodings, AgentEnv advances only the internal tracking checkpoint, refreshes the source projection, and removes the stale update state. The same Skill MUST NOT remain `Update available` after a no-file-change review.
- Invalid upstream candidates and relationship conflicts remain visible with selectable detail and no unsafe mutation shortcut. A source-level failure is also reported through the shared application feedback system.
- Repository source groups default to `Monitored`; local source groups default to `Manual only`. A Monitored group participates in both `Check monitored` and scheduled checks. A Manual-only group is skipped by those routine operations but retains its per-row `Check` command as an explicit override. The per-Skill `Track updates` setting remains independent and controls whether a discovered change becomes an update reminder or participates in batch Update review.
- `Refresh` reloads the current source projection and cached observation without contacting the source. Per-row `Check` reads that source explicitly, while `Check monitored` reads only Monitored repository or local source groups. A missing local source reports an unavailable source while retaining Library content and the last complete observation. Switching between `Skill list` and `By source` MUST preserve the mounted view state and MUST NOT flash an empty Library.
- `Skill list` and `By source` use one filter grammar without pretending their objects have identical properties. Both views share the exact `All / Online / Local` source-type refinement. `Skill list` keeps `Enabled / Updates / Disabled` as its primary scope plus Usage and Agent refinements. `By source` keeps `Monitored / Manual only / All` as its primary scope plus Result refinements for Changes, Failed, and Not checked. Filters change only visibility; they MUST NOT silently change the execution scope of `Check monitored`.
- When two or more source groups can be merged, their dedicated selection rail supports ordinary checkbox selection, keyboard selection, and pointer drag across consecutive rows. Drag selection MUST NOT hijack disclosure, source-link, rename, or action controls.
- Repository source merge computes an editable common repository directory. Local source merge computes an editable common parent folder. Preview rescans that scope and confirms every member path remains contained; confirmation changes only source membership metadata and cached observation, never the external folder or Library content. Local and repository groups cannot be merged together.
- A merged source preserves the routine-check policy when all participating groups agree. Mixed settings are disclosed in Preview and resolve to `Manual only`; merging into an existing destination includes that destination in this decision.
- Every source action that waits on repository or Library work keeps feedback at the initiating control: its icon animates, duplicate activation is disabled, and unrelated rows retain their layout. A global message may summarize completion but MUST NOT be the only evidence that the command started.
- Bulk update review keeps successfully prepared plans and failed previews in the same focused dialog. Each failure identifies its Skill, exposes the complete selectable error, and offers an in-place retry; one failed preview MUST NOT hide valid plans or collapse the workflow into global feedback.

### 16.1.2 Merge Same-Name Skills

- `Merge duplicates` appears only for a Library name represented by two or more stable Library IDs. It is a row overflow command, not a page-level mode or automatic cleanup side effect.
- Preview includes every same-name Library entry and compares all files, declared versions, content hashes, sources, Profile usage, and managed-install counts. Identical content is stated explicitly; differences use the standard formatted diff viewer.
- The user independently chooses `Keep Skill` and `Keep update source`. `Keep Skill` owns the surviving Library ID, canonical content, icon, and global availability. `Keep update source` owns source type, locator, revision metadata, provenance, and tracked/untracked policy; choosing a source MUST NOT silently choose that entry's content.
- Confirming Merge verifies the reviewed member set and every reviewed content hash. A new duplicate, removed entry, or changed content makes the preview stale and blocks mutation.
- Merge migrates every Profile reference from removed IDs to the surviving ID. If a Profile already references the surviving ID, that existing reference and its target name and enabled state win, and references to removed IDs are dropped. Otherwise target names and enabled states are preserved while only the Library ID changes; references that collapse onto the same target name become one reference and remain enabled when any original reference was enabled.
- Every AgentEnv-managed install derived from a removed ID is relinked or recopied to the surviving Library entry without waiting for another Apply. External and unmanaged locations are untouched.
- Merge is one transaction covering all selected Library entries, affected Profile directories, managed installs, and central deployment receipts. Failure restores every backed-up path; success creates one History entry that can restore the pre-merge entries and references.
- The completion message names the surviving ID and reports updated Profile and managed-install counts. Success follows the global transient-feedback policy; failure remains dismissible and actionable.

### 16.2 Scan And Cleanup

Scan MUST inspect every adapter-declared Skill location and group results by canonical Skill identity and content.

Runtime identity, Library identity, and deployment identity are distinct:

- `runtimeName` comes from `SKILL.md` frontmatter and is the identity used by an Agent to resolve duplicate Skills. A missing name falls back to the deployment directory only with an explicit inferred-confidence warning.
- `libraryId` is AgentEnv's stable canonical record ID. It MUST NOT be silently rewritten merely because a runtime name or install directory differs.
- `deploymentName` is the directory name inside a Target Skill root. It is a path concern, not the primary duplicate or compatibility key.
- Scan and Apply MUST detect duplicate desired `runtimeName` values even when the Library IDs and deployment directories differ.
- Adapter-declared scan depth is authoritative. Recursive Agents are scanned recursively with realpath cycle protection; direct-child Agents are not assigned nested Skills they do not load.
- A directory symbolic link whose root has no `SKILL.md` but whose descendants contain Skills is a **Skill collection link**, not a Skill. Recursive locations follow it for runtime discovery while retaining both the outer link path and canonical source path on every descendant observation. Direct locations do not gain recursive behavior merely because the child is a link.

The Local Skills Manager surface owns unresolved local-state counts and group details; Library/Skills MUST NOT duplicate a `Needs attention` summary above the table. While the cleanup surface is open, `Refresh` MUST run a new filesystem scan in place, retain the surface, and expose its working and completion states.

Scan MAY read supported versions of `$XDG_STATE_HOME/skills/.skill-lock.json` and `~/.agents/.skill-lock.json` to recover Skills CLI provenance evidence. These files do not prove current ownership. Unsupported or corrupt lock data MUST degrade to ordinary filesystem scanning and MUST NOT block unrelated Skills.

The surface owns filesystem-copy normalization into Library and shared-area intent. Ordinary management does not edit Profile membership or orchestrate Apply. Only the explicit `Move shared Skills to Profile control` command may coordinate saved Profile intent across Agents. Scan itself is read-only: it produces a plan, and mutation begins only after the user confirms that plan.

User-facing state and action contract:

- Results are sorted once after a completed scan into `Needs your decision`, `Ready to manage`, `Managed`, and `Left unmanaged`, in that order. Names sort stably inside each section. `Managed` and `Left unmanaged` are collapsed by default, and their complete section headers toggle disclosure by pointer or keyboard; the chevron is only a state indicator, not the sole hit target.
- Every scan result and collection link passes through one `SkillManagementProjection` before rendering. Its visible state vocabulary is only `Managed`, `Not managed`, `Needs decision`, and `Unavailable`; an unresolved multi-version row MAY replace `Needs decision` with the concrete `N versions`. Runtime control is a separate supporting fact: `Profile controlled`, `Shared across Agents`, or `Outside AgentEnv`. The next action vocabulary is only `Manage`, `Add to Library`, `Choose version`, `Review`, and `Repair`. Internal scan, migration, receipt, preparation, link/copy, and cleanup states MUST NOT become visible status or command labels. The selectable hover/focus detail carries the complete explanation; a badge MUST NOT clip or ellipsize its visible label.
- Cleanup rows reserve stable identity, status, and action columns. Every status badge starts at the same left-aligned position regardless of Skill-name length or whether the row has a current action; the action column remains reserved when only the overflow command is available.
- Library is the canonical Skill source; a Cleanup row marked `Managed` represents one or more physical Target installations derived from that Library entry, not another Library record. Library-bound rows expose the neutral relationship `Library / <id>` and managed-install count without duplicating Library update or deletion commands inside Cleanup.
- `Ready to manage` includes: one writable outside copy, identical writable outside duplicates, an unimported or unclaimed shared group with one unambiguous content version, copies already matching the canonical AgentEnv copy, and safely removable broken symbolic links. Changed managed copies and local copies that differ from the canonical copy remain in `Needs your decision`. Generic bulk-ready rows expose only Details and secondary retention controls in overflow; they MUST NOT repeat a primary row action.
- When Library already contains the Skill, byte-equivalent local copies can be adopted without rewriting them. A divergent outside copy or changed managed copy remains in `Needs your decision`; after the user chooses the Library version, the exact path is backed up before replacement using the reviewed deployment policy. When Library does not exist and multiple different local versions exist, the group stays in `Needs your decision` and version selection appears inside `Add to Library`.
- A broken symbolic link can be planned for removal when Cleanup can prove it will remove only the link itself and back up its link metadata. Manager-related evidence is retained for diagnostics but does not grant or revoke mutation authority. An unreadable directory or manifest, an observe-only path, an unknown Target, a permission error, or ambiguous canonical content MUST remain in `Needs your decision` and MUST NOT be deleted automatically.
- Runtime observation, mutation authority, and cleanup task state are separate projections. Discovery-only plugin or built-in content is inventory evidence and does not create a cleanup row. An alternate runtime location that the Agent loads but marks `observed` remains visible as an explicit outside-management boundary; AgentEnv MUST NOT offer automatic mutation for it.
- A `Managed` row requires an existing Library identity and verified matching content. A Target receipt whose Library relation is missing appears as `Management record missing` and requires repair or an explicit unmanaged boundary; it MUST NOT be counted as healthy management.
- Filesystem scan failures are reported per location while readable locations remain available. `ENOENT` means absent; permission, type, and I/O failures MUST NOT be converted into an empty successful scan.
- Descendants discovered through one Skill collection link appear as one collection row rather than independent cleanup rows. Review shows the outer runtime link, canonical source folder, contained Skills, Library relation, and consuming Agents. No child path is independently writable: importing copies child content to Library, and generic cleanup, shared retirement, or direct IPC calls MUST NOT replace or remove a descendant through the linked directory.
- `Manage N` is the one emphasized bulk command and appears in the `Ready to manage` section heading only when at least one safe plan exists. It uses the shared compact primary button primitive in a trailing action slot; its enabled foreground and background MUST remain visually distinct from disabled controls. The button stays vertically centered with the section copy, shares the rows' trailing edge, keeps its intrinsic width at every supported viewport, and MUST NOT stretch to fill the heading row. `Needs your decision` and `Ready to manage` may carry warning/success markers; terminal `Managed` and `Left unmanaged` headings MUST NOT reuse the blue selection/accent marker. Its confirmation groups only unambiguous effects: save-and-adopt matching copies, manage an unambiguous shared copy in place, refresh copies that have not drifted, and remove unavailable links. Content conflicts, changed managed copies, external boundaries, Profiles-only removal, and unresolved shared collections MUST remain manual. Every listed Skill exposes at least one concrete affected path; multiple paths remain fully selectable through the shared detail layer. A failure in one Skill does not roll back completed independent Skills, and the result reports both completed and remaining groups.

## Managed Skill ownership and Local Skills Manager

- Every Skill referenced by a Profile has one canonical AgentEnv copy. Agent directories are runtime materializations, never an alternate source of truth after explicit management begins.
- Local Skills Manager is the only workflow that resolves existing Agent copies. Its inventory and commands are always device-wide. Profile, Agent, Apply Preview, onboarding, and migration notices may open the same manager with return context or focus a relevant row, but they MUST NOT expose or persist a narrower management scope.
- Scanning and opening the manager are read-only. AgentEnv MUST NOT adopt, replace, remove, or create an Agent Skill before the user confirms a management plan.
- `Manage eligible` remains available for users who want broad takeover. It MAY manage unambiguous shared copies in place, but MUST exclude any item requiring a content/version choice, collection decision, or Profiles-only removal.
- A reviewed bulk management operation remains in one progress surface until the user closes it. Each item owns `Waiting`, `Managing`, `Managed`, `Failed`, or `Skipped`; exact failure details remain selectable, and `Stop after current` prevents new items from starting without pretending to cancel the filesystem transaction already in progress. Completed independent items remain completed when a later item fails.
- With Managed copy policy, identical existing Agent directories are adopted without rewriting the directory, changing its timestamps, or creating an ownership marker beside it. Missing paths may be created only after preview. Different content is replaced only after an explicit version decision and backup.
- A managed-resource receipt records materialization (`copy` or `link`) separately from origin (`adopted`, `created`, `replaced`, or `unknown`). Legacy receipts are migrated conservatively. Stop Managing and deletion MUST NOT infer that an adopted or unknown path was created by AgentEnv.
- A validated legacy ownership marker is migration evidence, not a deployment preference. Migrating it preserves the current materialization even when the global preference differs, writes the central receipt, and removes the marker in one recoverable transaction. Marker-free links created by an explicit Live link preference remain ordinary current deployments.
- `~/.agents/skills` and other shared runtime roots are special. Their stable outcomes are `Leave as-is` and `Manage shared Skills`; `Move shared Skills to Profile control` is a separate migration command. The surface shows only the current behavior plus `Change…`, not a permanently visible technical mode control. Ordinary per-Agent commands MUST NOT silently choose a behavior or run the migration. Device-wide `Manage eligible` may perform only the non-moving, in-place management outcome.
- The global Skill deployment method (`Copy on Apply` or `Live link`) controls how Profile-managed content is materialized inside an Agent-specific Skills directory. It does not choose ownership of a shared runtime root and MUST NOT be presented as completing shared-folder migration.
- A managed shared Skill that already matches an enabled Profile reference satisfies that Profile without a migration warning. Migration becomes required only when the Profile needs a different Library version, turns the Skill off, or otherwise cannot enforce its intent while the shared runtime remains active. Explicit `Leave unchanged` decisions never enter bulk migration candidates, even if an older preparation receipt still exists.
- Create Profile from Agent may copy selected Skills into AgentEnv storage and save Profile references, but it MUST say so before confirmation and MUST leave the Agent paths unchanged until Apply.
- A Library update changes the canonical copy. Live links follow immediately and are presented as such. Managed copies become pending unless the user explicitly chooses to update eligible Agent copies in the reviewed update operation; drifted copies are never overwritten by that bulk option.
- A shared compatibility copy counts an Agent as an active consumer only while that Agent is installed. Directories left by an unavailable Agent remain visible inventory evidence, but they MUST NOT keep shared cleanup waiting or create an action the user cannot complete.
- Broken symbolic links are planned per physical path, not per Skill group. A Skill with healthy managed copies and one unavailable link is still ready for reversible cleanup of that link; healthy copies remain untouched. Other unreadable content stays decision-only. The details dialog exposes a selectable, copyable scan snapshot containing the Skill state, resolution, affected Agent and path, content hash availability, Library relation, runtime state, and exact issue text. A reviewed removable link also exposes the same scoped cleanup directly in Details, without requiring the user to discover the bulk command.
- Decision rows expose one lightweight current action. Read-only details, management-boundary, shared-retention, and review-again controls live in overflow. Internal states such as `Auto-ready`, `Take over`, and `Resolve conflict` MUST NOT be presented as user actions.
- The main process MUST rescan and compare the reviewed content hashes immediately before mutation. Stale previews fail without modifying Library or local copies.
- Every mutating cleanup backs up all affected locations first. A failure after mutation begins attempts to restore Library and every affected location independently; one failed restore MUST NOT prevent later paths from being restored. The error distinguishes a completed rollback from an incomplete rollback, and the renderer rescans disk before presenting the remaining group state.
- Cleanup MUST leave every Profile resource reference byte-for-byte unchanged. A later Apply independently decides whether a Skill is installed, omitted, disabled, reviewed for replacement, or represented by a device-local unmanaged location for that Target.
- After successful cleanup, selected Target-specific copies rescan as current and `Managed`; the group MUST NOT retain a duplicate or pending action.
- AgentEnv ownership is attached to the physical managed installation. A shared compatibility path scanned by multiple Targets MUST appear as one managed location rather than a duplicate caused by Target-specific scanning.
- A physical location scanned by multiple Target adapters MUST appear once instead of presenting the Target names as separate copies. It is labelled `Shared` only when no adapter declares that path as its own non-shared runtime; a preferred or alternate Target runtime takes precedence over another adapter's compatibility declaration, and its owning Target is the primary location owner.
- One confirmed cleanup MUST include every reviewed physical location in the group. A successful rescan MUST NOT leave a conflict or duplicate that requires the user to repeat the same cleanup for the remaining Target paths.
- The main process validates that every unresolved mutable path is included immediately before mutation. A renderer cannot submit only the already-current copies. After mutation, the transaction rescans the reviewed Target paths and commits success only when every selected path is `Managed`, Library-linked, and content-current; otherwise it restores the backup and reports the remaining paths.

Shared runtime management contract:

- A Skill collection link is one physical migration boundary. `Leave unmanaged` records one collection-coverage management boundary on the outer link and applies it to every current descendant; `Manage with AgentEnv` removes only that boundary. Newly discovered descendants inherit it because the decision is attached to the outer link, not to a list of child paths.
- Until every readable member has a reviewed Library version or the collection has an explicit unmanaged boundary, a Skills-managing Profile MUST NOT install a same-runtime-name Target copy or claim an external member is absent. Apply blocks with the outer collection path and directs the user to review the remaining members or leave the collection unmanaged. Once every member is reviewed, Apply may record install-or-omit preparations but MUST defer physical Target copies while the collection remains active; `Move collection` completes the recoverable migration. An unmanaged collection boundary preserves the external runtime without creating a duplicate.
- Moving a Skill collection first requires a reviewed Library version for every readable descendant. Missing Skills may be copied into Library without changing the source; same-name content differences use the ordinary explicit import conflict review. Choosing `Keep Library copy` records a path-scoped `use-library` decision for that collection member: it does not claim the source content matches, does not retain the member outside AgentEnv, and makes the existing Library copy canonical for the later collection migration. The reviewed source hash is revalidated before migration so a later source edit returns to review instead of silently applying an obsolete choice. Resolving one descendant conflict MUST return to the same refreshed collection review and advance to the next unresolved member; a child decision MUST NOT dismiss the parent collection task or reopen the completed member. `Move collection` saves the exact collection-member intent in each affected active Profile and deploys only those member copies; it MUST NOT Apply unrelated pending Instructions, MCP, metadata, or other-Skill changes. For `Keep current`, the explicit confirmation changes that Profile's Skills policy to `Use Profile` and adds the members so the currently loaded collection remains available after its shared link is removed. For `Turn off`, it preserves the off policy, prepares omission for every member, and MUST NOT reactivate a Skill merely to complete cleanup.
- An unsaved affected Profile is a conditional prerequisite inside the collection dialog, not a cross-page block: the primary command becomes `Save Profile and move`, saves the draft, re-reads the persisted Profile, and continues the same intent. A saved Profile may remain globally pending while collection migration completes. Main-process migration binds every Target to the active Profile ID and current Profile content hash and revalidates the exact collection source, Library decisions, Target destinations, ownership, and recovery state immediately before mutation. A changed Profile receipt, changed collection source or link, unsafe occupied destination, or recovery-required Target is a true safety stop and MUST be reported inside the collection dialog without dismissing it or hiding the error behind the overlay.
- Collection review supports both per-Skill decisions and one explicit version strategy for the unresolved set. `Keep Library versions` keeps existing canonical copies for differences and imports missing members; `Use collection versions` replaces canonical copies with the reviewed collection members and imports missing members. Batch handling proceeds per Skill, exposes waiting, working, complete, and failure status icons in the list, preserves completed work if a later item fails, and never maps `Keep both` into the collection because every runtime member requires one unambiguous canonical Library identity.
- When Apply is blocked by an unresolved Skill collection, the blocking issue exposes `Review collection` and opens the matching Local Skills collection review directly. It MUST NOT require the user to locate the collection manually, and it MUST NOT auto-replace conflicting Library content.
- Collection migration is one recoverable transaction: verify the outer entry is still a symbolic link to the reviewed canonical folder; back up the link, every affected Agent destination, ownership sidecar, and Target state; remove only the outer link; replace any captured same-runtime-name Profile reference with the explicitly reviewed Library member; deploy and verify Target-specific Library copies; then clear every member preparation. It MUST never write, rename, or delete the canonical source folder or a descendant through the link. Failure restores the original link topology and all Agent state before reporting completion.
- A shared Skill not yet in AgentEnv follows the same save-and-manage intent as every other local Skill. One content version is eligible for the confirmed in-place `Manage N` plan; multiple different content hashes remain in `Needs your decision`, show the number of different versions in the row, and add version choice inside the review flow.
- `Leave unchanged` records only the device-level area policy. It is also the effective behavior before any choice is persisted. Scan and diagnostics remain available, but update, replace, remove, and per-row takeover commands are suppressed. No shared path, Profile, or Agent directory is changed.
- `Manage in place` is the recommended takeover for users who want a unified Library without changing which Agents read the shared folder. One transaction backs up reviewed copies, creates or reuses canonical Library content, preserves exactly one shared runtime copy, removes reviewed redundant Agent-specific copies, removes legacy AgentEnv sidecars, and writes a central receipt under the AgentEnv data root. It MUST NOT edit Profile membership, apply a Profile, or create Agent-specific copies.
- A managed shared copy rescans as `Managed in shared folder` and appears once even when several adapters consume it. A copied shared materialization follows Library updates only when the user enables `Also update Agent copies`; otherwise it becomes visibly out of date. A live-linked shared materialization follows Library updates immediately under the existing Live link disclosure.
- `Move shared Skills to Profile control` is the only area command that removes shared copies. Its review lists every affected Skill or collection, supported consumer, saved Profile outcome, path, and warning for consumers AgentEnv cannot prepare. It MAY reuse internal preparation receipts, but those records are implementation state rather than user tasks.
- Profiles-only execution re-reads saved Profiles and filesystem hashes, prepares and verifies supported Agent destinations, then removes each shared directory or link as one physical entry. It never unlinks child files individually. Any failed item keeps its shared copy active; a transaction that has started mutating one item restores that item's shared path, Agent paths, central receipts, and Agent state before reporting failure.
- Unsupported or unknown consumers are disclosed because they may stop loading the Skill after removal. Since AgentEnv cannot configure them, that risk requires confirmation but MUST NOT produce an unresolvable block.
- Cleanup history exposes a completed Profiles-only migration as one restorable operation. Restore returns shared paths, Agent paths, central receipts, and preparation state to their pre-migration state.
- `Leave shared copy unmanaged` records a path-scoped exception and resolves that physical path without changing files. While the boundary is active, Apply treats the shared copy as a local runtime override and MUST NOT create a duplicate Agent-specific copy. Changing the area to `Leave unchanged` clears central shared-management receipts but does not delete files.
- A management boundary resolves only the exact physical paths covered by it. When every detected runtime copy is left unmanaged, the Skill belongs under `Left unmanaged` and MUST NOT count toward `Needs your decision`. When unmanaged and unresolved copies share one runtime name, the group status and primary action describe only the unresolved copies: a writable copy with an unambiguous canonical version becomes `Ready to manage`, while an unreadable, observe-only, or canonically ambiguous copy remains in `Needs your decision`. An unmanaged shared copy MUST NOT mask, disable, or be included in management for a remaining Target-specific copy.
- Shared runtime groups MUST NOT be flattened through generic Agent-copy management. An unambiguous group MAY participate in `Manage N` only through the in-place shared transaction. Content conflicts, unreadable paths, observe-only locations, and explicit unmanaged boundaries remain outside automatic management. Skill collection links remain one external topology boundary and continue through their dedicated collection review; the manager MUST NOT pretend that independently importing a child grants authority to rewrite the outer collection.
- Details group physical copies by full content hash and list unavailable symbolic links separately, so the user chooses between actual content versions rather than paths that happen to contain the same files.

Cleanup review contract:

- If the Skill is not yet in Library, the user chooses the local version whose content will be preserved as the Library source of truth.
- The chosen source location is always included in the cleanup and cannot be deselected accidentally.
- If the Skill already exists in Library, `Review differences` first asks whether to keep the current Library version or use a reviewed local version. Local version selection appears only after the latter choice. Replacing Library content backs up the previous canonical copy and changes its provenance to local/untracked.
- Every truncated Skill name, description, path, and history detail in the cleanup workflow exposes its full value on pointer hover and keyboard focus. The detail layer remains open while the pointer moves into it, and its text is selectable so paths and errors can be copied directly.
- Cleanup identity and compact cleanup state occupy explicit non-overlapping regions. Identity, description, path, and state detail may expose selectable overflow detail; the visible status badge itself never truncates.
- Cleanup groups and Cleanup history use the same main-content/action-column hierarchy and control scale. History does not add a redundant `Backup` badge when its section and metadata already establish that scope.
- Cleanup history is a secondary group inside the Local Skills Manager surface, not a separate framed panel.

Management-boundary and evidence contract:

- `Leave unmanaged` is a device-local decision attached to one concrete Skill path and, for Target-specific paths, one Target. A shared collection boundary may cover every member below one concrete collection path. Neither form becomes a portable Profile property.
- Unmanaged paths remain visible in Local Cleanup and Agent inspection. `Manage with AgentEnv` removes only the matching management boundary.
- A group with unmanaged and active locations is classified by its unresolved active locations; one unmanaged copy MUST NOT hide actionable copies elsewhere.
- `Leave unmanaged` grants no ownership and makes no filesystem change. Apply excludes that location from its managed payload and discloses the resulting local override instead of repeatedly blocking.
- Shared compatibility retention uses the same management-boundary store with collection or exact coverage; it remains coordinated across every consuming Agent.
- Choosing `Use Library copy` for a collection member is stored separately from the location boundary. Version choice and mutation authority MUST NOT be collapsed into one policy.
- Skills CLI locks, symlink destinations, plugin manifests, and adapter metadata are `External evidence`. Evidence may improve provenance and diagnostics but MUST NOT independently classify a writable Target destination as unavailable for takeover.
- Path capability is authoritative: writable Target-owned slots may be reviewed and taken over; a Target root symlink may be replaced only at the root boundary; shared compatibility paths use Local Cleanup; observe-only plugin or alternate containers are never mutated.
- Missing, unreadable, or malformed native inventory produces a warning and skips only that evidence source. It MUST NOT suppress ordinary user Skill roots or block unrelated Capture, Save, or Apply.
- Directory symlinks and broken tracked symlinks remain visible. Import copies readable content to Library and leaves the source path and evidence unchanged.
- A GitHub Skill MAY contain a symbolic link only when System Git proves that the complete link chain resolves inside the selected Skill directory. Preview, Import, and Update Preview use the same validation path. Absolute links, escaping links, broken links, cycles, submodules, and unavailable Git validation remain blocking.
- A validated repository-internal link is materialized as ordinary file or directory content before it reaches Library or a pending update candidate. Canonical Library data and update diffs MUST NOT retain or depend on the source checkout's symbolic-link topology.
- GitHub source revisions include symbolic-link Git objects even though canonical Library content is dereferenced. A newly imported Skill MUST NOT immediately report an update solely because Scan, Import, and Check encoded the same repository tree differently.
- Import is idempotent. Matching Library content is reused; same-name different content uses the duplicate-import review. Import never changes a Target path or records deployment ownership.

### 16.3 Update

- Check compares only against an explicit update source.
- A tracked online source MUST expose its complete address on hover and keyboard focus and provide a clearly identified command that opens the address in the system browser.
- GitHub rate limiting MUST provide a GitHub sign-in remediation.
- GitHub Device Flow polling MUST respect the server-provided minimum interval. `slow_down` extends every later poll by at least five seconds, remains a waiting state rather than a user-facing failure, and MUST NOT end automatic polling.
- Window focus and manual status checks MUST NOT create overlapping or early token requests. A completed authorization immediately refreshes the visible account and rate-limit state without requiring navigation or restart.
- System Git authentication, host trust, VPN, ref, and timeout failures MUST provide Repository-specific diagnostics and MUST NOT suggest GitHub sign-in.
- Update Preview MUST show changed files and validation errors.
- Update Preview MUST bind one immutable materialized candidate, the current Library content hash, and the current update metadata. Confirm applies that exact candidate; it MUST NOT fetch the source again. If Library content or metadata changes after Preview, Update fails stale and requires a new review.
- Bulk Update Preview is owned by the main process. It groups Skills by normalized repository and ref, refreshes each source once, reuses that source snapshot for the remaining group, limits independent source work to two concurrent groups, and returns per-Skill failures without discarding successful previews.
- Skill content identity uses a versioned, framed hash over entry type, normalized relative path, content length, and content. AgentEnv metadata files are excluded. Hash-format upgrades rehash Library metadata, existing managed Skill snapshots, applied Library versions, and Capture receipts before normal operation so an upgrade cannot create false Target drift. A malformed Target state or optional Capture receipt is retained byte-for-byte, recorded in startup diagnostics, and skipped without blocking healthy neighbors; a real read, permission, or atomic-write failure still fails startup closed. New deployment ownership is recorded only in device-local Target state. Legacy ownership sidecars remain migration and recovery evidence, never managed Skill resources. Legacy state entries that misclassified `*.agentenv-owner.json` as a Skill are removed during the hash upgrade without changing or deleting the sidecar file.
- Update Preview MUST derive impact from persisted Profiles and observed managed installs. It names referencing Profiles and distinguishes live links from copied installs.
- Applying a Library update changes canonical content only after Preview, Backup, validation, and atomic replacement. A check never modifies Library. Live links follow canonical content naturally; current AgentEnv-managed copies are refreshed in the same backup transaction.
- The update transaction also advances each affected Target's applied Library version and managed-resource content hash. Completion requires the Library, every clean copied install, and every affected Target state file to verify; failure restores all three layers.
- A managed copy whose content no longer matches the pre-update Library baseline is drift and blocks the Library update until reviewed. Unmanaged and observe-only locations never participate in propagation.
- A Repository update never rewrites Profile intent. Related Profile references continue to resolve the current canonical Library version.
- In default Live link mode, linked Target content changes immediately. The UI MUST disclose this behavior and MUST NOT represent the linked deployment as an immutable applied snapshot.
- Live link installs link the complete Target Skill directory to the canonical Library directory. They MUST NOT construct a shadow directory made from per-file links. Ownership is recorded in device-local Target state so Library contents and Agent directories remain free of AgentEnv support files; replacing or removing the link cannot touch the canonical directory.
- Local imports without an explicit tracked source MUST NOT produce repeated update failures.
- A Profile-scoped Check MUST inspect only enabled tracked Skills referenced by that Profile. Disabled, missing, and untracked references remain visible but MUST NOT trigger network or filesystem checks.

### 16.4 Delete

- A Skill referenced by any Profile MUST NOT be deleted.
- The user is directed to affected Profiles.
- Deleting an unreferenced Skill explicitly includes or excludes its managed Target installs.
- The confirmation lists the canonical Library path and every managed install path that will be removed; complete paths remain selectable.
- Unmanaged copies are never deleted.
- Deletion with managed installs creates an undoable Backup.

Status: local, read-only Workspace, recursive GitHub, and System Git Repository import/update; in-place Refresh; per-Skill update policy; YAML frontmatter runtime identity; direct and recursive Agent scanning; read-only Skills CLI and Claude plugin evidence detection with malformed-inventory isolation; independent copy import; scan; cleanup; device-local management boundaries; icon metadata; duplicate runtime-name blocking; reference blocking; managed-install removal; and undo are `Implemented`.

### 16.5 Instruction Library Contract

An Instruction Block is a global, reusable text resource owned by AgentEnv. It is
not a native Agent file and it is not named `AGENTS.md`, `CLAUDE.md`, or another
Target-specific filename. The Instruction Library stores one stable Block id,
name, description, content, and revision hash per real directory under
`instructions-library/`.

- Instructions has its own global navigation destination beside Skills. The
  catalog supports search, import from a local text or Markdown file, create,
  preview, edit, and guarded delete. Import copies content into AgentEnv and
  never changes the source file.
- A Profile stores an ordered list of Instruction Block references plus its
  existing Profile-specific instruction content. Each reference may be enabled
  or disabled without removing it. The same Block may be reused by many
  Profiles.
- Effective Profile Instructions are deterministic: enabled Blocks are
  normalized and concatenated in saved order, followed by Profile-specific
  content, with one blank line between non-empty sections and one final newline.
  The effective output is preview-only; users edit its owning Blocks or the
  Profile-specific content rather than a generated file.
- Apply materializes the effective output to the selected Target's adapter-
  declared native instruction path. Library edits and reference changes update
  saved Profile hashes but never write an Agent until the ordinary Preview and
  Apply flow runs.
- A Block referenced by any Profile cannot be deleted. An unreferenced delete
  moves the verified directory to AgentEnv Trash instead of erasing it in
  place. Stale content hashes stop edit and delete mutations.
- Portable Workspace Sync includes Block metadata and content as independent
  resources. Profiles with missing Block references are invalid. Sync Update
  backs up and atomically replaces Profiles, Skills, Instruction Blocks, and
  source metadata as one recoverable operation. Older snapshots without an
  Instruction section preserve local Instruction Blocks during merge.
- Workspace project instruction files remain Workspace-owned and are not
  silently converted into global Blocks. A future explicit import may copy
  project content into the Library, but project files never become live links.

Status: Instruction Library persistence, ordered Profile composition, Target-
native compilation, guarded deletion, and portable sync are `Implemented`.
Project-to-Library import remains intentionally out of scope.

## 17. Native MCP Contract

- Each Agent is the source of truth for MCP definitions, installation, sign-in, authentication, and credentials.
- AgentEnv discovers only user/global MCP names, activation state, transport hint, source path, and control capability. Workspace, plugin, workspace, and policy-managed MCPs MAY be observed but MUST NOT be adopted or mutated.
- Discovery MUST include credential-bearing definitions such as `computer-use` and `node_repl`; secret values MUST NOT enter Profile data, renderer payloads, logs, or diagnostics.
- A Profile stores a policy per Target. `Keep current` opts that Target entirely out of MCP activation changes. `Use Profile` stores sparse three-state rows: an absent row is shown as `Agent setting` and performs no mutation, while explicit `On` and `Off` choices update only a verified native activation field. Selecting `Use Profile` MUST NOT synthesize overrides for discovered MCPs; returning a row to `Agent setting` removes its saved selection. `Turn off` retains those sparse choices but treats every retained selection as `Off` for the selected Target.
- Codex, OpenCode, and Trae CLI activation control are `Implemented`. Claude Code and Antigravity are read-only until an official, reliable user-scope activation mechanism is verified. Pi has no built-in MCP configuration and remains outside MCP discovery and mutation.
- Apply MUST preserve command, URL, arguments, headers, environment, OAuth state, and every unknown definition field byte-for-byte or semantically unchanged.
- A managed `On` selection missing from the Target is `Setup required` and blocks Apply because AgentEnv cannot create definitions. A managed `Off` selection missing from the Target is equivalent to Off and is a no-op.
- A new native MCP added outside AgentEnv remains valid. Whole-file drift MUST NOT block it or remove it.
- If activation already matches the saved Profile, Preview is a no-op: no write, Backup, history event, or timestamp update.
- Create from Target captures discovered connections as Target-specific activation selections only when that adapter supports safe activation. Read-only Targets capture `Keep current` and import no MCP definition into Library.
- Profile v2 has no MCP Library store or IPC. Legacy MCP definitions survive only inside the external one-time migration backup and report; runtime MUST NOT read, mutate, or delete that old file.
- MCP interaction exists only inside a selected Profile as native Agent discovery and activation choice.

Status: native discovery across Agents with built-in MCP configuration, per-Target opt-in and sparse editing, Codex, OpenCode, and Trae CLI activation, read-only Claude Code and Antigravity visibility, explicit Pi unsupported state, blocking missing-On remediation, no-op, definition preservation, and one-time legacy reference migration are `Implemented`.

## 18. Create From Target Contract

Create from Target gives an existing native environment a reusable Profile representation before the user decides whether AgentEnv should manage it.

- Capture MUST read only paths declared by the selected Target adapter.
- Blank Profile creation MUST start with empty Instructions, Skills, and MCP policy. Native Agent resources are discovery candidates only and MUST NOT be adopted until the user explicitly adds an override; only Create from Target may intentionally capture the current environment.
- Create from Target defaults the Profile name to the Agent display name. The default MUST NOT add transient state words such as `Current`; users may edit the name before saving.
- A Target-row capture command MUST keep the invoking Targets workspace visible until the user confirms. Cancel and Escape return focus to that exact command without changing workspace.
- Every Target presents `Configure` as the stable primary action. It opens the active
  Profile, otherwise the newest valid Profile captured from that Agent, in the canonical
  editor with the invoking Agent selected; when neither exists, it starts complete
  Capture. `Capture` remains available for every detected Agent because creating a new
  snapshot of the Agent's current environment is distinct from editing a reusable
  Profile. Diagnostics and Recovery remain separate commands with distinct ownership.
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
- Readable Skills, including paths with external provenance evidence or a device-local management boundary, MAY be imported or reused and included in the portable Profile. Capture review names the local override or evidence, while Save leaves every source path unchanged.
- A broken or unreadable discovered Skill link is unavailable rather than capturable. Capture MUST continue for other resources, show the unavailable Skill before Save as an excluded warning with its source path and reason, omit it from both Library and Profile, and leave the source link byte-for-byte untouched. Fixing the source and capturing again is the only path that can include it.
- An existing writable Target copy that exactly matches Library content is adopted during reviewed Apply. Different content is a reviewed backup-and-replace decision; a `Leave unmanaged` boundary preserves it as a local override.
- Duplicate active runtime copies with identical content MAY be represented by one Library reference, but every source copy remains unchanged. Same-name copies with different content become an inline Capture decision: the user either selects the exact copy to save or leaves every listed path outside this Profile on this device. Capture shows path, canonical path, version, content hash, modification time, location role, Library match, and readable differences before Save. Neither decision changes an Agent file; a selected copy becomes the Profile's canonical Library reference, while leave-unchanged records exact Target-scoped management boundaries.
- Capture Save is locally unavailable only while a required inline decision remains unresolved or a true global error makes a coherent Profile impossible. A global stop MUST show the concrete reason beside Copy details and Export report; it MUST NOT send the user to diagnose an unnamed conflict in another workspace.
- When a captured Skill has identical shared-compatibility and Agent-private copies, the first takeover Apply MAY replace only the matching private copy with an AgentEnv-managed deployment. The shared copy remains untouched until the separate reviewed cleanup workflow. Changed private content requires explicit replacement review; unmanaged and observe-only paths remain unchanged.
- Preview becomes stale when any captured source path changes before confirmation.
- Saving a captured Profile MUST NOT invoke Apply, create a Target Backup or deployment state, add ownership markers, delete a source path, or write Target history.
- A successful capture opens the new Profile in `Saved, never applied` state. The user may inspect or edit it before using the standard Preview and Apply contract.
- Takeover, backup, Target-specific deployment, and managed-resource replacement occur only during the later explicit Apply. Local duplicate cleanup remains an explicit Scan local workflow.
- Failure while saving MUST remove the partially created Profile and newly imported Library resources while leaving the Target unchanged.

Status: OpenCode, Codex, Claude Code, Antigravity, Trae CLI, and Pi adapter capture, reviewed Skill Library import, native MCP activation capture where supported, stale protection, source preservation, and saved-never-applied handoff are `Implemented`.

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
- Skill source work is scoped by command: `Check updates`, one Skill's `Update`, bulk `Update all`, one source check, and `Check monitored` never borrow each other's spinner. The active command state survives workspace navigation and restores on return until the operation completes.
- Cross-page or background operations use the shared global feedback region.
- Workspace-owned completion feedback remains scoped to its originating workspace and disappears when the user navigates away. When a command intentionally navigates to the object it created, that result workspace inherits the completion feedback. An error from a modal or sheet workflow stays inside that overlay with the failed object, reason, and next executable action; it MUST NOT appear only in a global layer behind the overlay. Global errors are reserved for background, startup, or genuinely cross-workspace recovery.
- Success feedback expires after approximately five seconds.
- Errors persist until dismissed or resolved.
- A newer warning or error replaces stale success feedback.
- Completion updates visible persisted state, not only a message.
- No visible command may appear to do nothing.
- A conditional prerequisite is completed inside its parent workflow whenever AgentEnv can do so without broadening the confirmed mutation. An unrelated pending lifecycle state is not a blocker. Hard blocking is reserved for conditions where continuing would risk data loss, overwrite unreviewed external content, use stale reviewed input, or violate recovery ownership; every such stop names the affected object and keeps the recovery action in the same surface when possible.
- Profile edits update the in-memory draft without filesystem scans. Auto-save, Preview, and Apply each expose owned working state for their complete asynchronous lifetime.
- Profile saving state stays attached to the selected Profile context and Apply command group. It MUST NOT create a layout-shifting banner or cover Composer content.
- Complete-Profile auto-save exposes immediate working and completion feedback while preserving the newest edit through overlapping input.
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
- The desktop window appears before service initialization completes. Initialization failure remains inside a recovery screen that classifies newer data, invalid data, permissions, interrupted recovery, and unknown failures. It offers Retry, Open data folder, Export redacted diagnostics, and Quit; it never resets or deletes local data automatically. Recovery labels follow `en`, `zh_CN`, and `zh_TW`; each support action owns visible progress and local failure feedback. A late initial status response MUST NOT overwrite a newer startup event, and Retry confirms the final status even if an event is missed.
- Startup diagnostics are size-bounded and rotated. Home paths and credential-shaped values are redacted, and Skill contents, MCP payloads, and secrets MUST NOT be logged.
- One structured device-local runtime event log is always available without requiring a reproduction mode. Every renderer-to-main operation records a stable operation ID, start, completion, elapsed time, and an allowlisted result summary; the channel name provides the baseline operation identity for discovery, scans, Save, Preview, Apply, Backup, refresh, authentication, Git, updates, and other user-visible work. Multi-step services append correlated domain phases where the top-level command is insufficient, beginning with startup and Capture inventory, decisions, imports, boundaries, and completion. `completed`, `no-op`, `decision-required`, `blocked`, `partial`, `cancelled`, `failed`, and `rolled-back` are the supported semantic outcomes; a service MUST emit a non-default outcome only when it can determine that state authoritatively.
- Every IPC failure receives a stable diagnostic reference bound to its complete operation timeline and records the original redacted error name, message, stack, and cause chain. Decision-required and partial operations also remain copyable and exportable even though they are not exceptions. Informational writes are asynchronous and bounded; mutation start/final events and failures are flushed before returning when recovery evidence depends on them. Logging failure MUST NOT change the user operation, and logging MUST NOT delay clean shutdown indefinitely.
- Diagnostic context uses an explicit field allowlist. Clipboard text, Instructions, Skill contents, Conversation text, MCP definitions, environment values, credentials, authenticated URL components, and arbitrary IPC payloads MUST NOT enter logs, renderer diagnostics, or exported reports. Home paths are normalized to `~`, individual fields are size-bounded, and malformed log lines do not hide valid neighboring events.
- Runtime errors show a concise message plus their diagnostic reference. Conditional review surfaces expose Copy details and Export report beside the affected object. Copy details resolves the reference to a selectable operation summary; View details exposes the redacted error chain when present. Settings > Data and the native Help menu export one redacted JSON report containing build/system metadata, safe Target discovery state, the selected operation timeline, recent runtime events, and startup diagnostics. Runtime logs and reports remain device-local, are never uploaded as telemetry, and are never included in Workspace Sync.
- Export report acknowledges work on the initiating button, prevents duplicate exports, and turns
  the completed path into transient success feedback. A completed export MUST NOT retain a
  loading spinner or require manual dismissal.
- Switching Profiles keeps the selected Profile surface painted while the next Profile loads. The list may show the pending selection, but the editor MUST render a stable named loading surface with unchanged bounds and MUST NOT flash `No profile selected`.
- Renderer startup MUST NOT synchronously open duplicate browser-side persistence. Locale begins from the operating system and then adopts the authoritative local Settings value during core loading.
- Packaged macOS PNG and ICNS assets MUST preserve transparent corners around the app-icon silhouette so Finder volumes and Dock icons do not render an opaque square frame.
- macOS uses an inset hidden title bar with native traffic-light controls. AgentEnv MUST NOT recreate window controls in renderer content. Window chrome owns only the sidebar toggle, a continuous full-width bottom divider, and unoccupied draggable space; it MUST NOT contain page identity, creation/import commands, Refresh, or selected-object actions. Page identity and page-level commands remain in the content area that owns them. Every interactive chrome descendant is explicitly no-drag. In native full screen the traffic lights disappear and the sidebar toggle moves to the leading edge without introducing page controls into window chrome.
- Primary commands and lifecycle state remain visible.
- Switching workspaces MUST NOT resize or reposition global chrome. Sidebar, brand lockup, navigation rows, status card, page gutter, and content control scale use shared geometry at a given viewport.
- Sidebar navigation icons and labels MUST share the vertical center of their fixed selection surface. Padding, icon slots, and text line boxes MUST fit inside that height rather than enlarging or overflowing it.
- Top-level product objects use one semantic icon vocabulary everywhere they recur: Agents use a monitor, Profiles use layered environments, Conversations use messages, Skills use a book, Instructions use a document, MCPs use a plug, and Settings uses a gear. Sidebar navigation, Quick Open, loading and empty states, and Profile resource headings MUST resolve these icons through the shared product-icon owner rather than selecting page-local substitutes. Concrete Agent artwork, source favicons, file-type icons, and user-selected Profile icons may identify individual records; action icons describe the persisted command and MUST NOT replace product identity icons.
- The sidebar Agent summary shows at most three Agent icons inline. Additional Agents collapse into a `+N` disclosure whose hover and keyboard-focus popover shows every hidden Agent's icon, name, and current status without becoming a second navigation entry.
- Agent summary icons and the `+N` disclosure use the shared `28px` square geometry and render as optical circles. Flex pressure, localized text, focus, hover, and an open popover MUST NOT change either axis or the circular silhouette.
- The sidebar defaults to the expanded `204px` rail and supports an explicit collapsed
  `64px` rail at every supported viewport. Collapse is a device-local presentation
  preference, persists without entering Workspace Sync, and MUST NOT change the active
  workspace, selected resource, filters, owned scroll positions, or a pending Profile save.
  Window width MUST NOT silently toggle this preference; the expanded rail remains a
  supported layout at `920 x 620`.
- Expanded and collapsed rails share the same fixed navigation hit targets and active-state
  geometry. The collapsed rail shows only familiar icons with accessible names and delayed
  tooltips; its header exposes an explicit Expand command rather than turning the product
  mark into an unlabeled control. Quick Open remains available as an icon command.
- In the collapsed rail, Local Agents becomes one fixed square aggregate command whose state
  distinguishes loading, all ready, attention, and no enabled Agents. Its popover lists every
  enabled Agent with the same status and complete-configuration destination used by the
  expanded rail, plus one Open Agents command. It MUST NOT stack miniature Agent icons into a
  second navigation column.
- Shell-owned fixed anchors, including global feedback, derive their horizontal position from
  the current sidebar-width token. Workspace overlays and dialogs remain centered to the
  window rather than the content column.
- Workspace-specific content MAY use its own density only inside the stable page content region.
- Workspace resource groups reuse the Profile resource disclosure shell and row grammar: a neutral
  collapsed header, a lightly separated expanded header, a quiet toolbar, and a leading hierarchy
  guide that begins at the actual resource list. Workspace resources do not gain Profile policy
  controls; their available file actions remain beside the affected row and unsupported actions are
  read-only status, never disabled-looking fake controls. Instructions, Skills, and MCPs use the
  same title, summary, action lane, row density, overflow, and internal-scroll ownership rules as
  their Profile projections.
- Page-level creation and import commands remain in the content region that owns the affected collection. Single-pane pages use the shared page header; list-and-detail pages may place creation in the list header and selected-object commands in the detail header. Neither kind of command belongs in window chrome.
- Comparable single-pane pages use the shared page-header anatomy: one title, optional concise context or help, then one right-aligned command group. Their titles share a type scale and content origin. Split-view list headers use the compact section-title scale and align to their pane rather than imitating a second global page header.
- Interface typography uses four semantic weights only: regular `400` for body, controls, routine navigation, status, and metadata; medium `500` for repeated-row identity anchors, section and preference labels, decision-group headings, and the current navigation item; semibold `600` only for dialog titles, the selected primary object, and the brand; and heading `650` for first-level page titles. Native `strong` and `b` elements inherit by default because semantic markup does not grant visual emphasis to layout values. Each repeated row or compact decision group MUST expose one medium-or-stronger scanning anchor, while descriptions, paths, counts, sources, versions, timestamps, routine statuses, badges, and ordinary buttons remain regular. Interface CSS MUST NOT use weights above `650`, and the product-wide semibold declaration budget is enforced by the style audit.
- Reusable resources use one reading order: `identity -> metadata -> lifecycle state -> contextual actions`. Identity includes a fixed compact icon slot defined by its shared row primitive, name, and at most one visible supporting line; longer content remains available through the selectable overflow tooltip. Skill and Profile list icons are optically centered and transparent at rest. A Profile list icon is display-only so selecting a Profile cannot accidentally open icon editing; icon selection lives in the selected Profile detail, includes every supported Agent brand plus the shared generic icon library, and a newly created or captured Profile defaults to its initial or source Agent artwork.
- Standard resource rows use the shared `52px`, `60px`, or `68px` density tokens. A page MAY choose a denser table only when comparison across named columns is the primary task, as in Skills Library.
- A lifecycle state owns a stable lane and MUST NOT move into the action lane when another value is absent. State labels MUST fit without ellipsis; long explanations belong in a tooltip or focused review surface.
- Repeated rows implemented as independent Grid or Flex containers MUST reserve the same fixed state and action tracks. Content-sized `auto` tracks MUST NOT make status text change its horizontal origin between sibling rows; a missing secondary line keeps the same top-aligned state slot.
- Resource rows expose at most one direct contextual command plus a trailing overflow menu. Destructive, settings, and infrequent commands belong in that menu. Inline icon commands use shared `32px` hit targets and always have accessible names and tooltips.
- Skill Library and Profile list rows expose their existing overflow command set through the same compact renderer action menu used by the trailing ellipsis. Right-click MUST target the row under the pointer without inventing commands, changing availability, bypassing dirty-state or destructive confirmation, or silently applying the command to the selected row. The shared menu owns viewport clamping, Escape and outside-click dismissal, initial focus, Arrow/Home/End navigation, focus return, icon lanes, and danger treatment. The same keyboard contract applies to Profile actions, Agent selection, cleanup actions, and icon selection menus.
- Accent fill identifies only the current page-level primary command or the next commit action. Lists MUST NOT contain repeated primary-filled actions unless each row is an independent queued workflow.
- A populated Profiles workspace keeps `New Profile` neutral because Apply owns the external commit emphasis; an empty Profiles workspace MAY promote `New Profile` to the primary action. Available Skill updates use a neutral compact `Update` action, while the update confirmation dialog owns the filled commit action.
- The Library page uses `Skills` as its interactive page title; `Library` is neutral scope text and MUST NOT resemble a clickable breadcrumb.
- Skills Library uses one stable semantic reading order: `Skill -> Source -> Usage -> Status -> More`. Its default row is a compact projection, not a detail view: Skill shows the icon and name; Source shows one concise source label; Usage shows one combined `Profiles · Agents` line; Status shows one current maintenance state; and More owns infrequent commands. Description, full source, version or revision, update time, and named Profile or Agent references remain available through selectable hover details. When a Status has exactly one obvious review step, the Status itself may be interactive so a separate Action column does not consume minimum-window space. At the supported minimum width Source and Usage share one two-line lane while Skill, Status, and More retain stable tracks. Header and rows MUST consume the same named column contract, identity MUST NOT be the widest flexible column by default, and missing values never move sibling lanes.
- By Source preserves the same compact-table rule. At comfortable widths Last checked may use a
  comparison column; at the supported minimum it moves under source identity while Changes and
  Status + Action retain stable lanes. Disclosure, source artwork, and overflow controls keep
  fixed hit targets and do not become text-sized tracks.
- The Agents table may combine Management and Profile into one Profile lane at the supported
  minimum width. Agent identity, health, environment ownership, and the primary Configure
  destination remain visible; lower-frequency timestamps and commands may move into metadata or
  overflow without creating horizontal scrolling.
- Skill-list quick tabs are limited to `Enabled`, `Updates`, and `Disabled`. `Enabled` is the default and excludes globally disabled Skills; Source, Usage, and Agent-install filters live in one on-demand filter region, while `Update all` is rendered only when one or more updates can actually be prepared. Source-view quick tabs are limited to `Monitored`, `Manual only`, and `All`, with `Monitored` as the default. Skill List and By Source use the same `Check updates` command and the same compact status ownership: `Update available` and `Check failed` may be clicked to open their single obvious review or retry step, while bulk `Update all` handles the visible eligible set. A copied deployment behind the Library is `Apply pending`; its action opens the affected Profile instead of mutating the Agent outside Profile Apply. By Source MUST NOT repeat status as last-checked metadata; source checking, monitoring, rename, and other infrequent commands remain in the trailing menu. Update still opens a safety preview, and the dialog's filled `Update` command performs the mutation.
- A newly discovered source candidate MAY be ignored without importing or hiding it. Ignore identity is the normalized source record plus its source-relative path, never the Skill name, so an identically named Skill in another source is unaffected. Ignored candidates remain visible as `Ignored`, are excluded from source change counts and bulk actions, and expose an explicit `Unignore` action that returns them to `New` without importing files. `Add` is available only after that state transition. Source merges preserve and remap ignored relative paths into the merged scope.
- Update previews render the complete reviewed Skill file index immediately and mark added, removed, replaced, and unchanged paths without hiding context. A changed descendant marks its ancestor directories while fixed tree columns keep file and directory labels aligned. A multi-file preview mounts only the initially open diff and lazily renders other changed files when expanded; it MUST NOT synchronously syntax-highlight every changed file before the dialog becomes usable.
- Large Skill update file rows keep their intrinsic height inside the scrolling dialog body. The list may scroll, but file names and the open diff MUST NOT be compressed into blank rows.
- Confirming a Skill update turns its preview into a persistent task panel rather than closing it. One-Skill updates show that Skill's waiting, updating, success, or failure state; bulk updates execute Skills sequentially and retain every per-Skill result until the user explicitly closes the dialog. Each Skill remains an independent atomic filesystem transaction, and failed items remain visible and retryable without repeating successful updates.
- Disabled Skills remain readable and use one neutral row treatment plus the explicit `Disabled` status. They MUST NOT accumulate decorative grayscale, inset rules, badges, and opacity effects, and they are excluded from Enabled, Updates, and non-All Usage filters.
- Every Profile Composer resource row owns one Target-specific application-policy selector beside the row summary. The current value is always written as the complete outcome `Use Profile`, `Turn off`, or `Keep Agent`; `Keep Agent` maps to the persisted `Keep current` policy. The selector's title explains the exact Apply effect. It MUST NOT use an on/off switch, checkbox, or three abbreviated noun-like segments because the Profile can retain and edit its resource content while a selected Target either receives it, receives an explicitly disabled state, or is left untouched. The selected Target in the Profile action area provides scope without adding a detached table header above the resource rows. One parent-owned fixed policy column aligns all sibling selectors and static statuses at every supported width. Changing the selected policy MUST NOT move or resize that column. Unsupported categories show a right-aligned, non-interactive `Agent controlled` ownership state in the same stable lane; it MUST NOT resemble a disabled select or reuse the dimmed `Keep current` treatment.
- The resource disclosure occupies the leading edge and uses the platform-standard right/down direction. Its hover and pressed states change the chevron color without drawing a rounded tile behind the full disclosure lane; keyboard focus remains visible. The policy selector occupies the trailing edge. Disclosure, row body, and selector are distinct click zones: the first two only expand or collapse the editor, while the selector changes only the saved Target policy. The selector uses native option-set keyboard behavior and exposes the complete current policy without requiring hover.
- `Agent` gives the complete resource header a quiet neutral treatment so the non-managed category remains visible without competing with the Profile. `Turn off` uses the same neutral header surface and is distinguished by the selected policy control plus a concise Target-scoped effect note. The disclosure and policy control remain fully legible and interactive; neither state uses whole-container opacity or a full-row status color.
- Resource editors project the selected Target effect. Under `Profile`, saved child controls remain editable. Under `Agent`, child controls show the latest readable Agent snapshot and are read-only. Under `Turn off`, child controls show the effective off state and are read-only; the saved Profile recipe remains intact and becomes editable again when the category returns to `Profile`. When the Agent snapshot is unavailable, the editor MUST show `Unavailable` rather than reuse stale Profile values as current state.
- The `Agent` Skill projection is built from the selected Target's current runtime inventory, not from saved Profile references or the last Apply receipt. Agent-only Skills remain visible, Profile-only Skills do not masquerade as installed, and child mutation controls are absent. A refresh keeps the last readable inventory in place; when no readable snapshot exists, one group-level loading or retryable error replaces per-row repeated failures.
- `Turn off` describes the intended Target outcome rather than claiming that every detected copy is already absent. A device-local unmanaged or external copy remains visible as `External still active` until its management boundary changes; the Profile recipe itself remains preserved and read-only.
- Counts and saved summaries distinguish saved content from effective Target state. `Profile` shows the saved effective count; `Turn off` uses an explicit `saved` plus `Off for <Target>` summary instead of an unexplained zero; `Agent` shows a current count only when the Agent snapshot is available. Discovered Agent MCPs that remain on the native Agent setting are candidates, not Profile resources, and MUST NOT contribute to the saved Profile count.
- Profile MCP rows use `name -> native source/status -> On/Off switch`. Definition editing and deletion are intentionally absent because those actions belong to the source Agent. The expanded editor uses compact content-sized rows and identifies its live `MCP connections` scope. In `Profile` mode, changing a switch creates or updates a sparse safe activation override; an absent override may mirror the live Agent state without exposing a third row control. In `Agent` and `Turn off` modes, the same switch is read-only and shows the effective state. Refresh and Retry keep an immediate spinner and disabled state on only the initiating control until discovery settles.
- Expanded Profile resource toolbars use the shared compact command height and a quiet transparent
  surface. A repeated secondary command such as `Check updates` uses the shared icon-only ghost
  control with an accessible name and tooltip; the explicit composition command is labeled
  `Add Skill`. Neither command resembles the resource policy selector.
- Expanded Profile Instructions, Skills, and MCP editors share one nested hierarchy contract: one
  subtle leading guide and a consistent inset distinguish child content from the parent trigger
  without creating a nested card. Child identity starts on the parent title lane, local commands end
  on one action lane, and sibling resource types use the same panel framing. At the supported minimum
  width, a Skill's update or relink command collapses to the shared `32px` icon command with an
  accessible name while identity, lifecycle state, policy, and overflow retain dedicated
  non-overlapping lanes.
- The collapsed Profile resource trigger owns the resource name and count. Expanding Instructions, Skills, or MCPs MUST NOT repeat that heading inside the editor. An expanded toolbar MAY show one concise live-Agent scope label plus commands local to that editor; it MUST NOT create an empty command strip or a second resource title. A manageable MCP connection uses one keyboard-operable On/Off switch in a fixed action lane. Unsupported or ambiguous connections expose one quiet Agent-controlled value rather than a fake editable control.
- Profile Composer resource triggers remain `52px` high before, during, and after expansion. Expanding one resource MUST NOT compress, hide metadata from, or reposition its sibling triggers. The expanded trigger and editor surface MUST be visually distinguishable from ordinary collapsed rows without turning the editor into a nested card.
- Profile Skills with zero or one item fit their content without stretching empty list space. Larger collections grow only within the available editor region and keep the Skill list as the scroll owner.
- Agents use one continuous ordered management list at every supported width, with ordinary healthy state rendered as quiet metadata rather than a filled badge or separate card. Agent identity, health, management state, active Profile, last-applied time, and actions own stable sibling lanes. Every Capture, Profile, and Diagnostics control uses the shared control primitives and identical geometry across all Agent rows, regardless of Agent name, lifecycle state, or action label. Diagnostics expands to the full width of its owning Agent, shifts only later rows, leaves no peer-column void, and opening a second Diagnostics region closes the first.
- Each Agent row exposes `Configure` as its single direct destination and one trailing overflow command. Capture and Diagnostics live in that menu, use the shared renderer-menu keyboard contract, and never widen an individual row. Refresh progress belongs only to the page Refresh command; Recovery is disabled without a numeric badge when no Backup exists.
- The Agent name and `Configure` command open the same canonical Profile editor or complete Capture entry. The name is visibly interactive without changing its identity lane geometry or duplicating the command's accessible name.
- Settings renders ordinary preferences as stable `name and explanation -> control` rows. Labels are never detached into a separate alignment scheme, and toggles, selects, read-only values, and numeric inputs share one right-hand control lane.
- Settings is one continuous, restrained preference surface rather than a stack of feature cards. Its content width and control lane remain bounded so short controls stay close to their labels; account, data, and diagnostic commands use the same Button primitive and only the current continuation receives accent fill.
- Settings MAY override one configuration root per Agent. The Adapter remains the sole owner of deriving Instructions, Skills, and native configuration paths below that root. Selecting a root performs no migration, does not move existing files, and performs no Agent write. All later reads and writes use the same resolved paths. An Agent with retained AgentEnv ownership state MUST be stopped before its root can change even when that Agent is disabled and hidden from ordinary active-state lists. Full custom paths use the shared selectable overflow-detail behavior, and Choose, Change, and Use default show progress on their owning row.
- Truncated values and contextual explanations use one shared hover-detail primitive with two explicit interaction modes. Overflow and decision details open only when measurably clipped and remain selectable and pointer-enterable for copying. Brief `InfoTip` explanations are passive, non-interactive tooltips: they MUST NOT intercept a command underneath or prevent focus from moving to the next control. Both modes use regular body weight and neutral overlay styling, stay inside the viewport, close on Escape or owning-list scroll, and never rely on a browser `title` as the only readable copy. Wheel input at an interactive detail layer's scroll boundary continues scrolling the nearest owning list rather than making the interface appear frozen.
- At narrow widths, Profile readiness is read before its Agent and Apply command group. Secondary Profile commands MUST NOT duplicate a direct command already visible beside the selected Profile name, and expanded Skills and MCP resources share one flat list hierarchy rather than introducing resource-specific nested cards.
- Comparable actions in one command group use the same control height. Profile and Workspace Agent selectors use the same shared trigger width, icon slot, typography, and responsive variant rather than page-specific geometry.
- Switch tracks and thumbs have non-shrinking primitive-owned geometry. On and Off states preserve equal optical inset between the thumb and the track edge at every supported viewport; a page grid MUST allocate the complete intrinsic switch width and MUST NOT rely on flex shrink to make the control fit.
- A related command group MAY move below its heading at narrower supported widths, but its individual controls MUST remain together rather than orphan-wrapping one control onto another line.
- Profile rows keep one stable hierarchy at default and minimum sizes: name, one-line description, resource counts, and optional deployment state. Responsive rules MAY truncate long values but MUST NOT remove these semantic layers.
- Every Profile row shares fixed icon and content columns. Selection, dirty/current badges, hover, and long-name truncation MUST NOT move the icon, name, description, counts, or deployment text origin.
- Profile list icons use one consistent compact, non-interactive slot and icon family. Decorative per-row icon colors MUST NOT imply unsupported categories or state.
- Profile icons MAY use the shared built-in task-oriented icon set. Changing a Profile icon from the selected Profile detail joins the same complete-Profile auto-save queue and MUST NOT write an Agent.
- Icon pickers MUST use one shared component, expose the selected state without color alone, remain topmost inside the viewport, and close on selection, Escape, or safe outside click.
- Lists and expanded editors own intentional internal scrolling. In Library/Skills, page chrome, metrics, tabs, filters, and table header stay fixed; only the Skill table body scrolls, with no document or editor-panel scrolling.
- Visual verification pairs the same viewport and data immediately before and after an interaction. Numeric containment and computed geometry are necessary evidence, but optical shape, hierarchy, emphasis, and layout stability also require inspection of the rendered pixels. Zero, one, and many-resource captures MUST use the same build artifact as the corresponding Electron E2E.
- Expanding a Profile Composer section MUST expose a practically editable panel at the minimum viewport; presence of a clipped panel alone does not satisfy the interaction contract.
- At the minimum viewport, Profile list, detail header, resource policy, and expanded resource rows
  MUST remain disjoint. Dense Skill metadata MAY stack below the Skill identity, while commit
  controls and row actions keep stable dedicated columns; no visible child may overlap or escape its
  owning row.
- Collapsed Profile Composer rows stay content-sized and compact; they MUST NOT expand merely to fill unused editor height. The resource rows themselves provide sufficient context, so the Composer MUST NOT add a redundant visible title block above them.
- Target recovery history is a low-frequency safety workflow. Targets exposes it through a page-level Recovery command and a focused modal, rather than permanently consuming the primary Target list viewport.
- Profile Agent selection and Apply remain visible while the selected Profile's Composer owns internal scrolling.
- The selected Profile header separates object identity from commit controls at widths where they cannot coexist without truncation. Agent selection, Apply, and overflow remain one unbroken command group; readiness text receives its own line instead of shrinking into an unreadable fragment.
- At the minimum supported width, the selected Profile header preserves name, edit affordance,
  readiness, Target selection, Apply, and overflow while omitting the secondary description
  from the painted surface. Loading and loaded headers keep the same compact height. The full
  description remains available through Profile editing; it MUST NOT displace readiness or commit
  controls in the minimum-width workbench.
- Local Skills Manager is a review list, not a secondary resource library. Its rows show Skill identity, one compact state, the current safe next action, and overflow. Full paths, duplicate details, and alternate versions belong in Details or Review; History is an integrated list section rather than a visually unrelated card.
- Buttons do not wrap at supported desktop widths.
- Shared `Button` owns control height, padding, label line height, icon slot, icon-to-label gap,
  busy-state replacement, and visual centering. Feature and page styles MAY set only the button's
  placement or an explicitly reviewed outer width; they MUST NOT redraw those internals through a
  feature class. Short self-explanatory commit verbs such as `Apply`, `Save`, `Update`, and `Delete`
  do not carry a decorative icon. A dialog footer does not repeat the object name when the dialog
  title already establishes an unambiguous target, except when the product noun is needed to
  distinguish neighboring actions.
- English commands use sentence case while the product nouns `Agent`, `Profile`, `Skill`,
  `Workspace`, and `MCP` retain their established capitalization. For example, `Update Skill` is
  valid and `Update skill` is not. Casing is a copy contract, not a page-local visual treatment.
- Visible command, tab, status, badge, and count labels MUST fit their owning control in every supported locale. They MUST NOT use clipped overflow or ellipsis to conceal a sizing defect; shorten the visible label or change the owning layout while preserving the full accessible command name.
- When a responsive table hides its shared column header, every remaining compact field MUST retain a visible semantic label. Raw revisions, dates, source values, and Library identities MUST NOT become unlabeled values merely to fit the minimum viewport.
- Ellipsis is reserved for variable content such as names, descriptions, revisions, and paths. Every such truncation MUST declare the shared hover-detail contract so the complete selectable value remains available; generic `overflow: hidden` is not accepted as evidence of containment.
- Shared Electron geometry tests MUST scan visible controls, statuses, and clipped text across all first-level workspaces, the minimum and default viewports, supported locales, and Ready, Review, and Blocked Apply states. Document-level containment alone is insufficient.
- Text line boxes, icon boxes, and control padding MUST fit inside their controls without vertical clipping.
- A framed work surface has one edge owner painted above its scrolling children. Toolbars, rows, backgrounds, and scroll regions MUST stay inside that edge and MUST NOT redraw, cover, or visually interrupt any side or corner.
- Conversations keeps one continuous list-and-detail frame because scanning and comparing many
  records is its primary task. Profiles and Workspaces instead show one selected object in a
  continuous full-width work surface; their searchable object lists appear only in the shared
  Page Header switcher. The switcher MUST preserve dirty-state guards, selection semantics, row
  context actions, keyboard dismissal, focus restoration, and empty-state creation without
  introducing a second persistent navigation pane. Detail headers and editors may draw semantic
  horizontal separators but MUST NOT redraw or cover the outer edge, add nested corner radii, or
  introduce a gap between the header and body.
- A Profile or Workspace switcher presents the selected object's icon immediately before its name
  inside one clickable trigger. Identity artwork is not a separate selection target; Profile icon
  editing belongs to Profile details rather than competing with object switching.
- The visible Profile or Workspace name and its supporting description share one text origin even
  when the switcher keeps extra hover and click padding. Profile Agent identity and readiness use
  one icon column and one text column; the visible readiness label does not repeat the Agent name
  already shown directly above it. The expanded sidebar's Local Agents heading and summary share
  the same text column beside their status marker.
- Composite icon-and-input controls draw one border on the parent control. Their transparent borderless input remains inside the parent's content box and MUST NOT cover the parent edge at any supported width.
- Editable single-line text fields and selects use the shared default control height, control radius, surface fill, strong border, and accent focus ring. Read-only and disabled fields remain selectable where appropriate but are visually distinct from editable fields. Search fields in workspaces and selection dialogs use the same composite-field geometry; Quick Open is the intentional command-palette exception.
- Apply Preview keeps its header and footer stable. One modal body owns vertical scrolling; semantic resource groups never create another vertical scroll region, and long diff content owns only its code overflow.
- Every Apply review item names the concrete resource and exposes its complete selectable path or native key on the following line. Generic issue titles, icon-only paths, and aggregate counts that disagree with the rendered decision rows are contract failures.
- Collapsed Profile resource rows summarize policy and count, not individual resource names. Complete names stay available to assistive technology and appear in the expanded editor where they can be acted on.
- Source rows expose only the highest-priority next action inline. Rechecking an already reviewable source, monitoring policy, and renaming remain available in the shared overflow menu; zero-valued change categories are omitted instead of competing with meaningful counts.
- Create from Target keeps its step header and action footer visible at both supported viewports. Only the dialog body scrolls; resource groups MUST NOT introduce a second nested scroll region.
- Menus, tooltips, and dialogs remain above rows and inside the visible viewport.
- Context menus use one surface, `220px` width, shared item height, icon alignment, and danger treatment. Selection grids such as icon pickers are the only intentional menu-layout exception.
- Focused dialogs use one stable header/body/footer anatomy. The header identifies the task, the body owns scrolling, and the footer keeps neutral cancellation beside one primary continuation or destructive confirmation.
- Apply, Capture, and Local Skills Manager dialogs use one semantic hierarchy inside that anatomy. Readiness or the current cleanup bucket may use one small semantic marker, but explanatory safety copy, summaries, and drift actions remain flat rows separated by rhythm or dividers; they MUST NOT become nested colored cards inside an already framed dialog. The final commit action stays in the footer and is never duplicated inside the body.
- Dialog size follows task complexity rather than feature ownership: compact confirmations contain one decision, standard dialogs edit or select one resource, and wide review dialogs compare multiple resources or files. A sparse task MUST NOT inherit a wide review surface, while long content MUST NOT expand a dialog beyond the supported viewport.
- Any compact file diff or read-only text preview exposes one `Maximize preview` command that opens the shared read-only workspace directly at the maximum in-app size; it MUST NOT require an intermediate enlarged dialog and a second maximize action. For Skill updates the workspace keeps the complete reviewed file tree on the left, colors changed files and their ancestor directories by change state, and leaves unchanged context neutral; previews without a complete index fall back to the complete changed-file tree, while identical-content import review opens the incoming `SKILL.md` as syntax-highlighted read-only text. The selected true diff or text remains on the right, the pane divider is keyboard-adjustable, and the workspace owns no mutation command. While open it suspends the parent decision dialog; `Escape` closes only the workspace, restores focus to its invoking control, and leaves the reviewed Apply, Import, Update, or Merge decision intact. Read-only Library file browsing retains its compact default dialog and exposes the same one-click maximize/restore control without changing the selected file or re-reading the Skill. A multi-view report dialog such as Profile Comparison also exposes the same title-bar maximize/restore control for Overview, Responses, Changes, and Run details; maximizing it preserves the active view, current result, and in-progress run.
- Dialog titles use sentence case and the shared title scale. Eyebrows, uppercase category labels, status chips, and duplicate explanations MUST NOT replace the task title; secondary identity or state remains supporting content.
- A structured dialog has exactly one ordinary vertical scroll owner between its fixed header and footer. Search, filters, notices, and selection controls stay with that body; nested scrolling is reserved for code or file content that has an independent reading axis.
- Every async dialog command keeps its control geometry stable, sets `aria-busy`, disables duplicate submission, and shows an animated local progress indicator. Navigating away and back MUST restore that operation state until it settles.
- AgentEnv uses a low-motion desktop contract. High-frequency navigation, Profile rows, Skill rows, and resource selection MUST NOT lift, bounce, resize, or move text on hover, selection, or press; tonal feedback communicates those states without changing geometry.
- Shared command buttons MAY use one subtle, immediate pressed transform. Dense rows, navigation, disclosure lanes, segmented choices, and other compound controls MUST remain spatially fixed.
- Spinner motion is owned by the shared async primitive. Page styles MUST NOT define independent spinner keyframes, durations, or selectors; only the initiating operation appears busy. Under reduced motion, rotation becomes a gentle non-spatial pulse while state acknowledgement remains visible.
- Peer actions with equal consequence use the same neutral treatment. Accent fill is reserved for the current primary commit or flow-advance action; Target `Capture` and `Profiles` are neutral peers.
- Legacy and shared command implementations MUST resolve to the same semantic control states: secondary actions use the neutral control surface, while disabled primary, secondary, and destructive actions use the shared disabled surface, border, and text treatment. Component implementation history MUST NOT be visible through a different tint.
- Each visible work surface exposes at most one accent-filled executable command. Profile edits auto-save with local working/error feedback, while `Apply` remains the explicit external commit action; `New Profile` is promoted only when there is no current Profile work to apply. Opening a page-level tool demotes and disables competing page-header commands until that tool closes.
- Optional account and service setup starts as a neutral command. After the user enters that setup flow, its next explicit continuation MAY become the accent-filled primary action; unrelated sync or workspace actions keep their own emphasis only when that setup flow is not active.
- Drawer and modal surfaces use the shared overlay edge, shadow, header divider, and header-control geometry. Feature-specific legacy borders, shadows, close buttons, or control heights MUST NOT leak into a shared overlay.
- Settings switches sit beside the setting label they control, with supporting copy on the following line; they MUST NOT float as visually detached controls at the far edge of a wide row.
- Hover/focus tooltips are mutually exclusive and use a subtle trigger-anchored entry. The first pointer disclosure uses a short intentional delay; moving directly to an adjacent tooltip while one remains active opens the next immediately. Long-text tooltips allow pointer entry and native text selection for copying, then close after the pointer leaves both trigger and tooltip. Passive information tooltips remain outside pointer hit testing so they cannot cover or block neighboring commands. Repeated passive overflow spans MUST NOT each add a Tab stop: an existing row command or identity action owns keyboard focus and its full accessible name, while standalone error or decision details MAY opt into focus explicitly.
- Modal dialogs trap keyboard focus until they close.
- Modal dismissal follows one explicit policy. `Standard` dialogs contain read-only detail, previews, or one-step confirmation with no staged input; safe outside click and Escape both cancel them. `Intentional` dialogs contain typed values, selections, conflict choices, or multi-step draft state; outside click MUST preserve the dialog and draft, while Escape and the explicit Cancel or Close command discard it. A working dialog is temporarily non-dismissible regardless of policy. Menus, popovers, and tooltips continue to close on safe outside click.
- Escape closes only the topmost dismissible layer; the handled event MUST NOT continue and close a parent dialog or drawer. A non-dismissible working layer consumes Escape without exposing or closing the layer beneath it. Focus returns to the trigger or the next logical surviving control.
- Primary workflows work with keyboard only.
- Status is never communicated through color alone.
- Dynamic visible copy and accessible labels use the active locale. Truncated Profile descriptions use the shared selectable overflow detail instead of native browser title tooltips.
- Conversations, Skills, Profiles, Agents, Workspaces, and Settings share the same shell-owned content origin. Feature pages MUST NOT add a second outer inset that makes navigation appear to resize or the work surface jump between destinations.
- Each top-level workspace has one declared visual center, but visual-center work MUST NOT override task-selected content geometry. Selected-object identity and its current commit action outrank containers, healthy summaries, filters, and repeated secondary commands. Profiles and Workspaces use the open `SingleObjectWorkspace` surface because their selected object already owns the visible boundary. Skills retains a framed catalog and MUST NOT overlay a persistent action button inside Status; a truthful interactive state may open a non-mutating review or error-detail surface, with the effectful command inside that surface. Conversations retains its persistent list-detail geometry because scanning, search context, and rapid switching are core tasks; at the supported minimum window the history list remains at least 280 px wide. Settings uses the available workspace with a shared TabBar and preference rows whose copy and control lanes carry their own readable constraints. Agents show the environment status strip only for actionable, checking, unavailable, or setup states; a healthy count remains quiet page-header context, and opening Agent configuration uses the row identity rather than an ambiguous trailing chevron. Visible object context MUST NOT expose more than one enabled filled primary commit action.
- Shared visual primitives own their internal geometry across every page. Page CSS may place a `PageHeader`, `ObjectSwitcher`, `ResourceDisclosureSection`, or `ResourceRow`, but MUST NOT redefine its border, radius, control height, internal padding, type scale, icon box, or focus treatment through descendant selectors. Profiles and Workspaces use the same framed header object switcher width and geometry. At the minimum viewport, an Agents action lane may retain its icon column while hiding the non-actionable `Actions` header text rather than clipping it.
- Semantic status presentation is centralized. The same state, including `Update available`, uses the same tone in Skill list and By source; source-only additions or removals use the distinct `Changes available` warning state. A populated or expanded surface cannot be approved from an empty or collapsed fixture, and sibling surfaces claiming parity MUST be captured with the same state and viewport.
- On macOS, the full-width title-bar strip remains separate from sidebar navigation and owns the shell's only drag region. The sidebar box and divider begin below that strip. Its expand/collapse control is a fixed `no-drag` child after the native traffic lights; the draggable blank area starts after the control so their native hit regions never overlap. The control stays in one position in both sidebar states and never reserves a header row inside collapsed navigation. When collapsed navigation hides section labels, each section boundary remains visible as one shared hairline instead of being implied by unequal icon spacing.
- Startup presents the current recovery or preparation phase before the main workspace is interactive. A recoverable failure keeps Retry, data-folder access, diagnostics export, and Quit visible at the minimum viewport; every async recovery command uses the shared local busy state.
- Renderer styling follows one ordered cascade contract: accessibility, tokens, base, frozen legacy, primitives, shell, pages, and overlays.
- New page behavior MUST be owned by its page stylesheet or a shared primitive; the frozen legacy stylesheet MUST NOT grow and the retired product-level override file MUST NOT return.
- Skills and Profiles respond to their actual content containers, not only the outer window width.

Status: supported viewport containment, topmost overlays, policy-based modal dismissal, modal focus trapping, Escape handling, and focus restoration are `Implemented`.

## 22. Security And Privacy Contract

- All data remains local unless the user explicitly accesses GitHub or opens an external URL.
- Renderer-requested external links MUST be validated by the main process and limited to `http` and `https` URLs.
- GitHub OAuth tokens are stored using the operating system's secure credential facility when available.
- A saved GitHub token has separate credential and verification state. Local decryption failure or an explicit GitHub `401` invalid-credential response clears it. Offline state, timeout, rate limiting, malformed non-auth responses, and GitHub service failure retain the token and report `Signed in, verification unavailable`. Sign out removes only the token and pending Device Flow state; it MUST NOT alter Library content, source metadata, repository cache, or system Git credentials.
- On Linux, `safeStorage` is acceptable only with a real Secret Service or KWallet backend. The `basic_text` and pre-ready `unknown` backends are treated as unavailable, and AgentEnv MUST refuse to persist a GitHub token.
- Secrets MUST NOT appear in renderer logs, main-process logs, Preview diff, screenshots, or global feedback.
- Profile auto-save MUST reject literal credentials detected in Instructions and direct the user to environment references. Legacy native content is excluded during v2 migration, and every Preview is redacted before crossing the preload boundary.
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
- A read-only Skill runtime driver declaring roots, scan depth, scope, runtime identity, native disable facts, and manager-related evidence markers.
- Native MCP discovery scope and safe activation capability.
- An explicit isolated Profile Comparison declaration. Supported adapters define project
  Agent-resource masks, availability checks, an isolated launch specification, and structured event
  parsing. Unsupported adapters define a user-facing technical reason and keep Comparison visibly
  unavailable; capability declarations and adapter implementations MUST agree.
- An exact allowlist for any MCP activation field the adapter may patch; no generic native-config payload is accepted.
- Preview generation.
- Central managed-resource deployment receipts and read-only legacy-marker migration behavior.
- Backup path enumeration.
- Apply, drift, and rollback behavior.
- Cross-Target capability declarations.

Registration MUST occur in the Target registry. Renderer components MUST NOT require Target-specific branches for ordinary lifecycle behavior.

Target Skill drivers report facts only. They MUST NOT import Library content, mutate Profile state, deploy files, remove legacy paths, or create backups. The core owns Profile persistence, Preview, Backup, atomic Apply, post-write verification, and Rollback through one Agent-neutral operation model. Agent-specific behavior belongs behind the adapter; Agent-specific buttons and Target ID branches do not belong in the renderer.

Runtime snapshots are the single source for Skill discovery, runtime identity, availability, location role, and runtime issues. Managed Skill inventory MAY enrich those observations with canonical-copy relationships, device-local management boundaries, collection member decisions, content hashes, and manager-related evidence, but MUST NOT independently reinterpret Agent runtime behavior. Drivers only report broken links and unreadable manifests and never mutate them. Local Skills Manager MAY classify an exact broken symbolic link as `Ready to manage` only after path-capability and link-boundary verification; execution still requires the reviewed bulk confirmation and removes only the backed-up link itself. Unreadable real directories or manifests, observe-only links, and ambiguous paths remain review-only and MUST NOT enter automatic cleanup, replacement, or deletion plans. A `discovery-only` location owned by an external container such as an Agent plugin informs runtime inspection only: it MUST NOT be inferred as a Library copy from its name, create a Local Skills group, contribute a conflicting hash, or require a cleanup decision. Legacy locations remain eligible for their explicit migration contract and are not covered by this exclusion.

Skill inventory keeps deployment identity and physical identity separate. `path` is the exact Agent-visible deployment endpoint used for preview, backup, Apply, and rollback. `canonicalPath` is the resolved physical content location used only to recognize aliases and avoid reporting one physical Skill as multiple duplicate copies. Canonicalization MUST NOT collapse deployment endpoints or redirect a mutation through an alias. After a successful cleanup, merge, or deployment, rescanning the same unchanged filesystem MUST produce a resolved state rather than recreate the conflict.

Every multi-path Skill mutation owns a persistent operation journal with pre-write hashes and post-write mutation receipts. Startup MUST recover a prepared operation only when every changed path still matches its recorded receipt. Missing receipts, unreadable paths, or later external changes preserve the backup and enter `recovery-required`; subsequent Skill, Profile, Agent, and Workspace Sync mutations fail closed until recovery completes. Read-only inspection remains available, and a semantic no-op creates no journal or filesystem write.

Legacy migration eligibility is both path- and Target-owned. A shared copy carrying another Target's AgentEnv ownership marker is observable but MUST NOT be removed, replaced, or claimed by the current Target.

Antigravity's implemented global scope manages `~/.gemini/GEMINI.md` and
`~/.gemini/antigravity-cli/skills`. It observes `~/.gemini/skills` as a shared compatibility
location and treats the former `~/.gemini/config/skills` destination as legacy. Apply previews,
backs up, removes, verifies, and can roll back only AgentEnv-owned legacy copies; unowned legacy
content remains untouched. Antigravity CLI readiness requires authoritative `agy` command evidence;
the Antigravity desktop application is a separate product and is not sufficient. AgentEnv discovers
MCP names from `~/.gemini/config/mcp_config.json` without mutating that file. Secret-bearing headers, OAuth configuration, literal
environment values, and all other MCP definition fields remain Agent-owned.

Trae CLI uses one internal integration that prefers its current TOML layout. `TRAE_HOME`, when
available to the application, selects the configuration and shared-resource root; otherwise it
defaults to `~/.trae`. `TRAECLI_HOME` selects the runtime root; otherwise that root is
`<TRAE_HOME>/cli`. The integration resolves the TOML layout first when `traecli.toml`, a current
runtime history or state marker, or either explicit Home variable is present. Only when no TOML
layout evidence exists and `traecli.yaml` is present does it resolve the YAML compatibility layout;
an otherwise fresh installation defaults to the TOML layout. If both layouts exist, the TOML layout
is active and the YAML compatibility config remains Agent-owned.

Both layouts manage the isolated instruction file `~/.trae/rules/agentenv-manager.md` and
dedicated Skills under `~/.trae/skills`. Existing `~/.trae/AGENTS.md`, the inactive version config,
and the obsolete `~/.trae/trae_cli.yaml` path are capture fallbacks or disclosed outside resources;
they are never startup evidence or silent mutation targets. Readiness accepts the unambiguous
official command aliases `traecli`, `trae-cli`, and `trae-agent`; the short `ta` alias is not
authoritative because of collision risk.

The Profile editor and Apply preview MUST disclose the resolved Trae instruction path. Updating
that personal rule does not rewrite the context of a running conversation: Apply verifies the file
write, then tells the user to start a new Trae CLI session to load changed Instructions. An
unchanged rule is a semantic no-op and MUST NOT emit a reload notice.

The TOML layout discovers MCP names only from `~/.trae/traecli.toml` and may patch only an existing
`mcp_servers.<name>.enabled` Boolean. The YAML compatibility layout discovers MCP names only from
`~/.trae/traecli.yaml` and may patch only an existing server's `disabled` Boolean. Definitions,
commands, URLs, headers, environment, credentials, unknown fields, native named config files,
project sources, plugins, and built-ins remain Agent-owned.

Trae CLI Conversations reads only `rollout-*.jsonl` from
`~/.trae/cli/sessions` and `~/.trae/cli/archived_sessions`. It ignores input history, databases,
logs, memories, plans, tool protocol records, and per-session `.artifacts`. Native resume uses the
provider session ID, captured working directory, and the exact `TRAE_HOME` and `TRAECLI_HOME`.
The YAML compatibility layout exposes no Trae CLI conversation history rather than attributing another product's runtime
files to Trae.

Pi uses `PI_CODING_AGENT_DIR` when it is available to the application and otherwise defaults to
`~/.pi/agent`. `PI_CODING_AGENT_SESSION_DIR` selects the conversation root; otherwise a valid
absolute or home-relative `settings.json.sessionDir` is used, then `sessions/` is used. A relative
`sessionDir` depends on the Pi process startup directory and MUST NOT be guessed as a global path.
AgentEnv manages only Pi's independent `AGENTS.md` and dedicated `skills/` directory. Native
settings, authentication, packages, extensions, prompts, themes, and all unknown files remain
Pi-owned and MUST NOT be parsed into a Profile or rewritten by Apply.

Pi also consumes the registered shared `~/.agents/skills` compatibility location. That location
retains the same shared-runtime authority used by other consumers: ordinary Apply deploys only
to Pi's dedicated Skills directory, while in-place shared management and Profiles-only removal
remain separately reviewed device-wide operations. Pi has no built-in MCP configuration; extension-provided protocols MUST
NOT be inferred as native MCP support.

Pi Conversations recursively discovers session JSONL files from the resolved session root. A
session is a tree, so the visible conversation is the parent chain from the final entry to the
root rather than every historical branch in file order. Native reopen uses `pi --session`, the
provider session ID, the captured working directory, and the resolved Pi environment roots.

## 23.1 AgentEnv Data Lifecycle

- AgentEnv data has an explicit format version. Runtime Profile reads accept only v2.
- A v1 or unversioned non-empty data root MUST be fully copied to an external sibling migration-backup directory before conversion. When the configured data root is a symbolic link, Backup and restore operate on its physical directory and preserve the link itself. Profile conversion writes only the three canonical v2 files atomically; legacy Profile-owned Skills become self-contained Library copies; native configuration and unsupported resources remain only in the backup and migration report.
- Migration MUST write the v2 root manifest last. Its external safety copy is hash-verified before conversion. An unsafe path, unsupported future version, backup failure, or global conversion failure first preserves the complete failed migration state, then atomically restores the entire old physical data root against that failed-state hash, including Profiles already converted earlier in the same attempt; the old version marker remains intact so startup fails closed or can retry without interpreting partial data as v2. If preserving the failed state or restoring the original fails, every known snapshot path is named and retained. A malformed individual Profile or Target state remains byte-for-byte intact, is recorded in the migration report, and enters the normal repair/recovery state without blocking valid data from moving to v2.
- Partially completed conversion steps MUST be idempotent: already converted Profiles and Target states are accepted on retry, and imported Skills are reused by comparable content hash.
- The application MUST NOT retain an active v1 execution path after successful migration.
- The user can create a private directory backup from Settings.
- Portable Data Exports include a manifest with format version, creation time, payload hash, source-tree hash, and serialized symbolic-link metadata. Export never places a live symbolic link inside the payload; Restore materializes validated links only in staging and verifies the complete reconstructed tree before commit.
- GitHub credentials remain encrypted for the originating Mac and MUST NOT be presented as portable plaintext.
- Corrupt or unsupported future data MUST fail closed with recovery guidance rather than being partially loaded.
- A restore/import flow MUST deeply validate Profiles, Skills, Settings, and deployment state before mutation; reject physical or symbolic destination aliases inside active data; create and verify a safety backup before replacing current canonical data; reject unsafe links, payload tampering, or unsupported formats; validate the active data again after replacement; automatically restore the safety backup if that validation fails; and refresh all visible canonical state after success. Automatic recovery is allowed only while the active root still matches the exact content hash committed by that restore. If it changed again, AgentEnv leaves it untouched and preserves the verified safety backup for explicit recovery. A data root that is itself a symbolic link keeps that link and replaces only its physical directory. Unknown legacy files remain inert and are preserved by whole-data backups.
- One malformed Profile MUST remain visible as needing repair without hiding usable Profiles or blocking creation of a valid first Profile. It MUST NOT be silently interpreted as an empty Profile.
- Malformed deployment state MUST surface `Recovery required` and block Preview, Apply, rollback, and ownership changes until repaired. It MUST NOT be treated as an unmanaged Target.
- Malformed native Skill or MCP state MUST surface an inspection error and block unsafe mutation. It MUST NOT be rendered or planned as a confirmed empty state.
- AgentEnv permits only one application instance and one data-root mutation at a time. A lock outside the replaceable data root protects startup migration, writes, backup cleanup, and restore; dead owner locks MAY be recovered explicitly.
- Canonical JSON/text writes use same-directory temporary files, preserve an existing file's mode, flush content, and atomically rename. Directory replacement prepares and recursively flushes a complete sibling staging path, records hashes and phase in a recovery journal, preserves the previous path until the swap succeeds, and repairs interrupted root-level and child-level swaps at startup. Recovery verifies current, previous, and staging artifacts before deleting any of them. Both an existing target hash and a reviewed missing target are bound preconditions: if another process changes or creates that path before commit, AgentEnv preserves it and fails stale. An unclaimed `.agentenv-previous` path is recovery evidence and MUST NOT be deleted. When the evidence cannot identify one safe state, recovery preserves all evidence and fails closed instead of guessing.
- Persisting an existing Profile requires the content hash returned by the read that produced the editor state. Whole-Profile auto-save, Agent quick setup, Capture, Library reference rewrites, and drift adoption all use that same optimistic lock. A stale or changing Profile directory is rejected before replacement; creating a Profile requires its reviewed destination to remain absent through commit.
- Private data directories use owner-only permissions where the platform supports them; canonical text and credential files are written with owner-only permissions by default.
- Profile deletion moves the Profile into AgentEnv's private trash area rather than permanently removing it immediately. Skill cleanup, update, and deletion retain restorable backup data.
- Backup manifests and IDs are validated before restore, and restore paths are limited to adapter-declared Target locations and AgentEnv-owned canonical locations. A malformed or tampered backup fails closed before any destination is modified.
- Apply, Stop Managing, shared-folder and collection migration, Library import/cleanup/update/delete, source merge, Capture import rollback, Workspace restore, and whole-data restore bind every mutation path to a verified Backup made for that operation. Initial path absence is recorded only when the initial `lstat` is missing; a nested copy failure or source change aborts Backup rather than masquerading as an absent source. A path changed after Backup is rejected before AgentEnv writes it; a parent snapshot may cover descendants only after that exact parent passed its check. Before automatic rollback, AgentEnv creates a second verified safety Backup of current selected paths; restore writes are hash-bound and their results are verified. If restored content changes again, safety recovery preserves it and enters recovery-required instead of overwriting it. Cleanup recovery attempts every independent path and retains successful restores while preserving failed paths in its safety Backup. A concurrent change on an untouched sibling is preserved.
- A clean application window closes without waiting for renderer acknowledgement. A pending Profile auto-save is awaited before close without prompting. Only a failed Profile save or a dirty real Workspace document enables the close guard; Cancel keeps the window and draft intact, while Retry or Restore saved version resolves a failed Profile save explicitly.

## 23.2 First-Run Workflow

The first useful journey is the empty-workspace presentation of the repeatable Profile
Review and canonical Agent/Profile workflows:

1. Render the stable shell on Agents. Probe every supported integration in the background while
   operational views remain scoped to explicitly enabled Agents.
2. If installed disabled Agents are found, offer one reversible selection dialog. Enabling an
   Agent changes only AgentEnv settings; it does not Capture, Apply, or write Agent files.
3. Run a read-only local Skill inventory. Shared compatibility findings appear in Profile
   Review; no modal opens and no file changes without an explicit command.
4. Configure opens the complete Create from Target flow. Capture reads Instructions, Skills,
   supported MCP activation policy, and effective shared resources without changing the Agent.
5. Save creates an ordinary reusable Profile. It does not Apply, prepare another Agent, or
   mutate a shared compatibility location.
6. When shared Skills are detected, Review opens Local Skills Manager scoped to that directory.
   The user may keep it unchanged, manage its Skills in place, or explicitly replace its runtime
   copies with saved Profile deployments. No choice is inferred from Capture or Apply.
7. Review and Apply the saved Profile through the standard Preview, ownership, Backup,
   verification, and rollback transaction.
8. Later launches open Agents again. Profile Review remains manually refreshable and
   automatically reflects newly discovered shared Skills; background work never changes the
   user's current workspace.

Local Skills Manager, By source maintenance, and full Profile composition remain available for advanced migration and reuse, but a user with one Agent MUST NOT be required to understand all three before preserving and managing that Agent's Skills. The product MAY use contextual empty states for this journey; it MUST NOT require a marketing-style onboarding page.

The Local Agents summary is contextual navigation, not decoration. Each visible Agent icon and
each Agent inside the overflow list opens the same complete Agent configuration entry as the
Agents row; its accessible name MUST describe the same destination.

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

## 23.4 Change Closure and Evidence Contract

A reported problem is evidence of a defect class, not the default boundary of
the fix. Before implementation, every substantial product change MUST identify:

- The user intent and persisted outcome governed by the change.
- The authoritative contract and owning layer: product model, primitive, shell,
  workspace, overlay, adapter, persistence service, or desktop runtime.
- Sibling surfaces that expose the same object, command, state, or primitive.
- Applicable state pairs, supported languages, window sizes, and stress data.
- The evidence layers needed to prove the result and the exact build or package
  those results exercised.

A shared defect is closed only after its owner and applicable sibling surfaces
are corrected. A page-local selector override does not close a primitive,
shell, overlay, localization, feedback, or runtime defect.

Renderer, CSS, preload, and main-process changes invalidate prior Electron
artifacts. Electron E2E and screenshot evidence MUST fail closed when the
compiled artifact does not match current build inputs. Captures, the verification
snapshot, and the tested artifact MUST record matching identities.

Evidence has distinct meanings:

- Domain tests prove normalized semantics and command outcomes.
- Renderer and accessibility tests prove state transitions and reachability.
- Geometry tests prove dimensions, containment, alignment, and clipping.
- Equal-state pixel review proves hierarchy, rhythm, optical alignment, and
  discoverability.
- Desktop-process tests prove IPC, native window, focus, menus, pickers,
  startup, and shutdown behavior.
- Isolated filesystem inspection proves persisted effects, no-op, Backup,
  verification, and rollback.
- Packaged smoke proves GUI-environment and distributable behavior.

No layer may be cited as a substitute for another. A direct visible
contradiction revokes the prior visual verdict, reopens the complete defect
class, and requires the missing invariant or executable gate to be added before
closure. A semantic or policy change MUST update this contract in the same
commit as its implementation.

## 23.5 SSH Linux Endpoint Contract

An Agent endpoint is the combination of an Agent adapter and a device. Local Agents and
SSH Linux Agents share the same portable Profile, but deployment state and recovery
receipts are device-local.

- SSH devices store only a display name, host or SSH-config alias, optional user, and
  optional port. Passwords, private keys, access tokens, and host-key bypasses are never
  stored by AgentEnv.
- Connections use the system `ssh` executable with the user's SSH config, SSH Agent, and
  `known_hosts`. Non-interactive operations use Batch Mode and never open a password prompt.
- A remote device is supported only when it reports Linux and provides `sh`, `tar`,
  `sha256sum`, a HOME directory, and a supported Agent executable.
- Profile identity and resource policy remain keyed by the underlying Agent adapter. An
  SSH endpoint ID is deployment context and MUST NOT be persisted into portable Profile
  resource policy.
- P0 remote Apply supports Instructions and managed-copy Skills. It does not create live
  Library links across machines.
- Native MCP definitions and credentials remain remote-Agent owned. A Profile that asks
  AgentEnv to manage MCPs on an SSH endpoint is blocked with a direct `Keep Agent`
  remediation; no MCP file is created or rewritten remotely.
- Preview reads only adapter-declared paths under the remote HOME. Apply rechecks Profile,
  Library, device identity, and the exact remote snapshot before any write.
- Existing identical files are adopted without rewriting them. Existing different files
  require explicit review and are included in the remote recovery point before replacement.
- Shared Skill locations are never silently removed over SSH. A matching shared copy is a
  blocking, path-specific issue until the user reviews that remote shared area.
- Apply uploads an immutable staged payload, creates a private recovery point under
  `~/.local/state/agentenv-manager`, mutates exact planned paths, verifies every resulting
  file hash, and rolls back all planned paths when any step fails.
- If the SSH connection ends during commit, AgentEnv reads the durable remote operation
  status. Confirmed `committed` finalizes local state, confirmed `rolled-back` restores the
  prior local receipt, and an unknown result enters Recovery required without attempting a
  second write.
- Removing an SSH device removes only its saved connection descriptor. It never changes
  files on that Linux device.
- Remote Capture, Conversations, Workspace Open, Profile Compare, native MCP editing, and
  local recovery actions remain unavailable until each capability has its own verified
  remote implementation.

Required evidence includes Store validation, command quoting and timeout tests, fake SSH
Preview/Apply/stale/rollback/reconciliation tests, Docker OpenSSH integration on Linux, and
Electron coverage for add, edit, remove, endpoint selection, Preview, Apply, and unsupported
capability states.

## 24. Required Acceptance Matrix

Every release that changes Profile, Library, Target, or Apply behavior MUST verify these scenarios:

### Profile and Agent

- First launch enables every currently supported Agent and persists the explicit scope.
- Every launch opens Agents; with no usable Profile, exactly one installed Agent opens its Skill detail directly. Background discovery and a legacy saved workspace never replace the active destination.
- Turning one Agent off removes only that Agent from navigation, Profile destinations, discovery, Capture, Apply, lifecycle state, and Agent-specific Skill scans; its files and saved state remain byte-for-byte unchanged.
- Turning every Agent off leaves Library and Profiles usable while hiding Agent-only navigation and deployment commands.
- A disabled Agent rejects direct IPC Preview, Apply, Capture, rollback, and stop-management requests.
- Reload preserves the enabled Agent scope; re-enabling an Agent performs fresh discovery and restores its controls.
- A managed Agent requires confirmation before being turned off, and an Agent requiring recovery cannot be turned off.
- One v2 Profile applied to each compatible Target; preferred Target changes default context only.
- One Profile active on multiple Targets.
- Different Profiles active on different Targets.
- Switching active Profile removes only previous managed resources.
- Identical second Preview produces no changes and no Apply action. A true no-op Preview is
  presented as `No changes to apply`, exposes only `Close`, omits the payload and recovery-point
  promise, and refreshes canonical Target state so stale renderer state cannot leave Apply pending.
- Removing a Skill from an active Profile plans removal of its AgentEnv-owned Target copy and
  converges to `applied` after one Apply. A shared compatibility copy remains outside ordinary
  Profile Apply and is disclosed as preserved until the separate shared-cleanup workflow resolves
  it.
- Preview followed by Apply followed by another Preview converges to no changes for every supported Agent unless a named external writer changes a deployment-relevant fact.
- A missing AgentEnv-managed resource is restored by one fresh Apply and the next Preview is a no-op.
- Adding or changing an unrelated local Skill after Preview does not stale Apply; adding a Skill that conflicts with a desired runtime name does.
- Apply executes only the resource additions, replacements, and removals named by Preview. It never discovers and deletes a new stale resource during execution.
- Dirty Profile blocks Preview and preserves draft.
- Blank Profile creation exposes no Agent-binding field; Capture from Agent alone exposes Source Agent, and preferred Target remains a preview hint rather than a compatibility boundary.
- Active Profile is selected for the chosen Target without changing persisted creation-time ordering; a single installed Target is static context.
- Disabling a Skill in Library preserves its content and every existing Profile reference, hides it from every Add Skill picker, excludes it from update checks and effective Apply payloads, and leaves it visible but locked in Profiles until globally enabled again.
- Library status views are mutually exclusive. `Enabled` is the default and contains every globally enabled Skill, `Updates` includes only enabled tracked Skills with a confirmed available update, and globally disabled Skills appear only in `Disabled`. Source, usage, and Agent filters further refine enabled Skills without claiming deployment state. Disabled rows MUST differ from active rows through surface, edge, icon treatment, and state text rather than a badge alone.
- Global disable confirmation uses the standard compact modal hierarchy: normal-case command title, Skill identity, scannable retained/hidden/next-Apply effects, affected Profile count, and one commit action. It MUST NOT compress the complete impact into an uppercase section label or an undifferentiated paragraph.
- Enabling or disabling a Library Skill MUST expose row-local working feedback, lock duplicate availability commands, and update both the visible row and persisted metadata before reporting success.
- A globally disabled Skill is omitted from effective Profile deployment. The next Apply removes only AgentEnv-owned Target installs; global disable itself MUST NOT silently rewrite Target environments.
- A globally disabled Skill that remains active in a writable Target path is reconciled like any other absent Profile Skill: Preview offers reviewed backup-and-removal or `Leave unmanaged`. Observe-only and already-unmanaged paths remain unchanged. Global disable itself still performs no Target mutation.
- Disabling a referenced Library Skill in a Profile is a normal Profile edit: it preserves the reference, joins the same whole-Profile auto-save queue, and requires the same Preview and Apply flow as adding or removing a Skill.
- Applying a disabled Profile Skill previews and removes only its managed Target copy; re-enabling previews and restores it. The switch MUST NOT write to a Target before Apply succeeds.
- Profile-scoped update Check excludes disabled and untracked references while a Library update discloses cross-Profile and Copy versus Live link impact.
- Missing executable and missing directory are distinguished.
- Copy mode keeps Library updates pending; Live link mode visibly propagates them immediately.
- Managed copy is the default deployment. Live link is an explicit advanced choice and is never selected by an automatic fallback policy. Changing mode does not mutate an existing install before fresh Preview and Apply.
- Create from Target captures portable resources, reuses exact Library matches, and leaves Target files and deployment state unchanged.
- Create from Target MUST retain AgentEnv-owned legacy Skills as migration inputs so the first Apply cannot remove a legacy copy without installing the captured Skill into its current runtime location.
- Device-local unmanaged resources and unsupported native data remain unchanged after Create from Target.
- Applying the same Library Skill to OpenCode, Codex, Claude Code, Antigravity, Trae CLI, and Pi creates isolated Target-specific runtime copies.
- Create from Target followed by first Apply isolates a Target Skills root that aliases a shared directory, preserves the shared destination byte-for-byte, installs Target-owned child references, and restores the original root link through Rollback.
- Create from Target followed by first Apply adopts an exact Agent-private duplicate transactionally even when an identical shared compatibility copy remains active; Rollback restores the original unowned private copy and shared content byte-for-byte.
- The machine-local Capture receipt is consumed after that first successful Apply. Missing, malformed, stale, or content-mismatched evidence never expands replacement authority.
- Any Skill inventory fact used by Preview changing before Apply invalidates the whole deployment plan. An approved outside copy is checked against its Preview content hash again inside the Adapter immediately before replacement.
- Shared runtime copies remain unchanged during capture. Later in-place management or removal requires an explicit reviewed Local Skills command.
- Managing a shared Skill keeps one shared runtime copy active, removes reviewed redundant Agent-specific copies, and writes only a central device receipt. `Move shared Skills to Profile control` performs the separate backed-up, verified cross-Agent switch without deleting Library content.

### Cross-Target

- Instructions and Library Skills serialize correctly; native MCP policies remain Target-specific.
- Preferred Target and created-from provenance never restrict compatible deployment.
- Empty Instructions and all-Off resource choices remain valid complete replacement states and Preview their removals or disable operations explicitly.
- Unsupported portable resources block with remediation.
- `Keep current` performs no MCP read, hash, diff, Backup, write, or ownership retention and ignores retained editor selections in the Profile hash. `Turn off` fingerprints retained MCP names but normalizes every saved value to `Off`, so changing an inactive saved `On` to `Off` is a Target no-op while adding another name still requires Apply.
- Native MCP discovery includes credential-bearing entries without copying secrets; Codex, OpenCode, and Trae CLI change only verified activation state; Claude Code and Antigravity remain Agent-controlled; Pi reports no built-in MCP support.
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
- Workspace discovery scans configured roots read-only, deduplicates overlapping roots, isolates invalid candidates, preserves source files, and routes selected imports through the ordinary Library Preview flow.
- GitHub direct-Skill, containing-directory, and repository scan; candidate selection; partial import; rate limit; sign-in remediation; update check; Preview; and update.
- GitHub Device Flow pending, focus return, `slow_down`, expiry, denial, and successful account-state refresh without overlapping network polls.
- GitHub status clears a stored token after decryption failure or `401`, retains it through offline, timeout, rate-limit, and service failures, and keeps Sign out independent from Library and source state.
- System Git repository, directory, and direct-Skill scan; HTTPS/SSH/local transport; ref selection; partial import; cancellation; subtree update detection; Preview; backup; cache rebuild; credential redaction; and packaged-app Git discovery.
- Local and GitHub per-Skill update policies, legacy defaults, disabled-source isolation, and persistence.
- Library global disable persistence, update-check exclusion, Add Skill picker filtering, existing-reference visibility, and Apply-time managed-copy removal.
- In-place toolbar and `Cmd/Ctrl+R` Refresh preserve current Skill view state and do not contact update sources.
- Global Quick Open searches and opens Profiles, Skills, Agents, indexed Conversations, workspaces, and safe navigation actions; Arrow/Home/End selection remains visible and respects ordinary dirty-state and confirmation boundaries.
- Skill source-default and custom icons persist across refresh and content update; Profile icon changes auto-save independently without clearing or committing a dirty environment draft.
- Skills CLI v3 lock detection, corrupt and unsupported lock fallback, directory and broken symlink discovery, independent import, evidence preservation, and path-capability Apply review.
- Update marks affected deployments pending without deploying.
- Duplicate, conflict, left-unmanaged, linked, copied, and stale-copy states.
- Referenced resource deletion is blocked.
- Managed-install deletion is undoable; outside copies change only through a named reviewed action.
- Workspace Sync deterministic publish, remote receive, no-op, non-conflicting combination, same-section conflict, stale remote rejection, malicious snapshot rejection, linked-Skill impact confirmation, transaction rollback, and startup recovery.
- Workspace Sync candidate connection failure preserves the previous connection and accepted base; same-connection reconnect performs Check; Disconnect leaves Profile, Library, Targets, remote content, and Git credentials unchanged.
- Legacy shared-Library migration preserves the source, atomically replaces the destination, retains conflicting destination content under a deterministic alternate ID, writes a report, and converges on retry after interruption.

### Failure and recovery

- Failure before writes.
- Failure after text write but before asset completion.
- Successful automatic restore.
- Failed automatic restore enters Recovery required.
- Permission denied, source missing, target missing, offline GitHub, and partial bulk update.

### UI and accessibility

- The packaged desktop application owns its native menu: Settings is available through
  `Cmd/Ctrl+,`, while browser Reload, Force Reload, and developer tools are absent outside
  the development server so unsaved work cannot bypass navigation guards.
- Window bounds and maximized state are device-local UI state. They restore inside an
  available display, and malformed or stale state never blocks startup.
- Leaving and returning to Conversations preserves the current query, filters, selection,
  loaded page depth, detail, and list scroll while inactive page effects are unmounted.
- Every Conversation row exposes its indexed last-activity date and time. Its accessible label and
  hover text identify the value as the last reply time rather than a file-import timestamp.
- Persistent warning and error feedback reserves workspace space and keeps long selectable
  detail internally scrollable; it must not cover the active page. Transient success and
  informational feedback remains non-blocking and expires automatically.
- Active global navigation exposes `aria-current="page"`. Agents rows keep one visible
  text workflow action; secondary Capture and Diagnostics commands use labeled icon controls.
- Global navigation never becomes a horizontal scroll container. Long localized labels truncate
  within their lane and activating them must not shift or crop the sidebar.
- Empty, one-item, long-content, 50, 100, and 500-item cases where relevant.
- Default and minimum viewport without document overflow.
- Skill, Skill-source, and Agent table headers and every data row MUST share one column contract;
  the visible identity header text aligns with the first visible identity text rather than the
  disclosure, artwork, or icon lane. Contextual actions MUST NOT resize preceding columns. Compact
  width uses a visible grouped header and retains Skill, source, version, Profile usage, update,
  install, and action information rather than hiding columns.
- Version, update, usage, and install metadata MUST use aligned first- and second-line tracks, including empty states and truncated values.
- The Profile Target selector uses the selected Target name as its visible label without a redundant `Target:` prefix; its accessible name retains the full command meaning.
- First and last row menus are topmost and in viewport.
- Escape, outside click, keyboard focus, focus restoration, and Arrow/Home/End navigation for renderer action menus.
- Working, success, warning, error, no-op, drift, destructive, and recovery states are inspected visually.
- Profile Skill toggles respond from the in-memory draft without a data reload; auto-save immediately shows local working feedback and enables Apply after persistence; Preview immediately shows working feedback and opens without duplicate inventory scans.
- System locale detection, explicit `en`/`zh_CN`/`zh_TW` switching, persisted reload, and unsupported-locale fallback.
- Default and minimum viewport containment in all supported interface languages, including long Traditional Chinese labels.
- Profile switching at the minimum viewport preserves editor geometry through loading and never exposes a false empty state.

E2E assertions MUST verify persisted files and state, not only successful clicks.

### 24.1 Contract Coverage Matrix

This matrix is the release-facing index. A capability may be `Implemented` only when its persisted effect and failure path have automated evidence; detailed clauses above remain authoritative.

| Capability | Status | Persisted effect and recovery evidence | Required automated layer |
| --- | --- | --- | --- |
| Whole-Profile auto-save, recovery, and safe navigation | `Implemented` | Atomic Profile replacement plus verified prior version; Profile writes never touch an Agent | Domain, renderer, Electron E2E |
| Preview, Apply, no-op, stale, drift, rollback | `Implemented` | Bound plan, Backup, verification, compensating restore | Domain, cross-adapter integration, Electron E2E |
| Apply issue policy | `Implemented` | Stable code maps to one disposition and recovery; contract table is test-verified | Contract-policy and domain tests |
| Skill import, duplicate review, update, disable, delete | `Implemented` | Canonical Library transaction and History/Backup where destructive | Domain, renderer, Electron E2E |
| Instruction Library and ordered Profile composition | `Implemented` | Atomic Block storage, Trash deletion, compiled target hash, transactional Workspace Sync | Domain, renderer, Electron E2E |
| Local Skills Manager and shared migration | `Implemented` | Reviewed filesystem normalization; source evidence and device-local management boundaries preserved | Domain, fake-home E2E |
| Native MCP sparse activation | `Implemented` | Managed activation fields only; definitions and credentials preserved | Adapter matrix and fake-home E2E |
| Conversation search and cross-Agent continuation | `Implemented` | Read-only source histories, disposable cache, reviewed redaction/size fallback, private handoff artifacts | Adapter, service, renderer, and Electron E2E |
| Workspace Sync | `Implemented` | Candidate Connect, three-way plan, transactional Update, guarded Publish, recovery | Domain, two-device Git integration, Electron E2E |
| GitHub account state | `Implemented` | Secure token; invalid credentials clear; transient verification failure preserves | Service and renderer tests |
| Legacy shared-Library storage migration | `Partial` | Atomic destination replacement, source preservation, conflict retention, report | Unit complete; production-shaped packaged startup required |
| Data Export and Restore | `Implemented` | Validated export, recovery copy, atomic app-data replacement | Domain and packaged restart smoke |
| Desktop geometry and interaction | `Implemented` | No persisted effect; native window, focus, overlay, scroll, and viewport contracts | Renderer geometry and Electron screenshots |
| Windows and Linux native packages | `Required` | Platform data roots, links, Git, terminal, menu, and installer lifecycle | Native CI packaged smoke on each operating system |
| Verified direct and Homebrew macOS release | `Implemented` | One pinned fixed identity across direct and Homebrew assets; valid App seals, expected Gatekeeper rejection, exact-tag SHA-256, manifest, SBOM, draft verification, official Tap | Release generation, native package jobs, cross-channel signature gate, Cask and packaged Electron tests |
| App update checks and installation | `Implemented` | Official stable Release only; Homebrew preserves the active appdir; writable direct installs verify ZIP size, hash, bundle identity, version, seal, startup, and rollback; settings persist locally | Domain, renderer, Electron E2E |
| Anonymous usage statistics | `Implemented` | Default-on official builds; persistent opt-out; random installation ID; one basic-information event per local day; no action or result data; network failure is non-blocking | Domain, renderer, and Electron E2E |
| SSH Linux Profile Apply | `Partial` | Device-local endpoint receipt plus remote staged recovery and hash verification | Store and transport tests implemented; fake SSH, Docker OpenSSH, and Electron E2E required before release |

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
- The packaged Agent discovery smoke runs with a desktop-process minimal `PATH` and proves fallback discovery for OpenCode, Claude Code, Codex, Antigravity CLI, Trae CLI, and Pi on each claimed platform.

Current verdict: **Needs refinement**. Core Skill Library, v2 Profile, Preview, transactional Apply, backup, retention, rollback, stale rollback protection, no-op, cross-Target Instructions and Skills, Create from Target, Target-specific Skill deployment, compatibility-copy consolidation, canonical Target lifecycle, data backup and restore, active-Profile deletion recovery, Stop Managing workflows, sparse native MCP activation, and verified stable-identity distribution are functional. Broader Skill identity edge coverage remains release work.

### 25.1 Verification Snapshot

The current machine-readable totals, source commit, deterministic tracked-and-untracked source fingerprint, compiled Electron source and artifact fingerprints, dirty state, viewport list, capture count, audit results, and packaged-smoke status are generated by `npm run verify:product` in [`verification-snapshot.json`](verification-snapshot.json). The source fingerprint excludes the generated snapshot itself, so evidence produced from an uncommitted review candidate remains bound to the exact files that were exercised. Electron E2E and capture entry points reject a missing or stale `out/.agentenv-build.json`; the capture manifest and verification snapshot must name the same compiled artifact. `npm run verify:current` fails when source, compiled output, captures, or the verification snapshot no longer agree. Every Electron E2E and screenshot fixture uses an isolated Chromium user-data directory, so persisted UI preferences remain production behavior without leaking between evidence runs or into the developer's real app state. Run `npm run verify:release` for a release candidate so the same snapshot also records the packaged workflow.

- The complete test gate runs parallel-safe files first and then runs every real Electron-process file serially from one shared scheduling manifest. Desktop process tests MUST NOT be allowed to compete for native application lifecycle, focus, dialogs, or teardown merely to reduce wall-clock time.
- Module growth budgets protect the Renderer workspace, Skill Library, activation service, Target-state persistence, Skill management-boundary persistence, and page-style owners. Exceeding a budget requires moving behavior to the correct owner rather than raising the limit without an architectural review.
- CSS architecture auditing owns shared primitive roots, registered cross-file selectors, animation ownership, custom properties, and layering. A page-local override MUST NOT become a second implementation of a shared control or overlay.
- The critical visual gate compares fixed-state Electron captures against reviewed pixel baselines at a deterministic clock and scale. Baselines may change only after a cold pixel review, repeated capture, and a forced-fault check that proves the comparator still rejects a materially wrong interface.
- The automated suite covers preferred-Target and cross-Target use, Create from Target, real Electron UI, progressive startup, localization persistence and completeness, stable Profile loading, scoped feedback, stale Preview, rollback, recovery, MCP ownership release, and externally replaced managed-Skill recovery scenarios.
- The CSS architecture gate passed with named container-query contracts, no numeric `z-index` declarations, and no `!important` outside the reduced-motion contract.
- The CSS architecture gate rejects page-owned animation declarations and spatial transforms on high-frequency navigation or resource rows. Renderer and Electron tests cover scoped global feedback, delayed-then-instant adjacent tooltips, trigger-origin transitions, and fixed row geometry through hover.
- Fixed-state visual captures are regenerated through the Electron compositor at the supported default and minimum viewports, including the stable Profile loading state, sidebar Agent overflow, Agent-to-Profile configuration, complete Capture, Profile icon selection, Profile Skill selection and applied revisions, native MCP Profile states, available-update rows, disabled, empty, Simplified and Traditional Chinese Skills, Profiles, and Settings, source-specific Import, shared-Skill management guidance, Agent Diagnostics, Conversations list/detail/continuation, Workspace Sync review, startup failure, and focused update-setting states.
- Skills, Profiles, Agents, and Settings passed shared chrome and control-geometry checks at `1180 x 728` and `920 x 620` without document overflow.
- The macOS inset hidden title bar, native-control safe area, full-width divider, quiet window chrome without page commands, draggable unoccupied region, and no-drag sidebar toggle passed main-process configuration and real Electron geometry assertions.
- Shared page headers, vertically centered navigation rows, uninterrupted work-surface edges, contained composite search fields, `32px` resource identities, compact/default row heights, Profile commit controls, MCP rows, Cleanup state/action lanes, `220px` context menus, and Apply resource rows passed cross-workspace geometry and overflow assertions.
- Profile navigation passed queued auto-save, save-failure Retry, and Restore saved version outcomes; Stop Managing passed persisted file-retention and ownership-detachment checks.
- System-picker data backup and restore, pre-takeover restoration, read-only and missing Targets, missing Skill sources, offline and rate-limited GitHub checks, and partial bulk updates passed Electron E2E coverage.
- First-row and floating layers, modal Escape, outside click, focus trapping, focus restoration, and renderer-menu Arrow/Home/End navigation passed Electron E2E coverage.
- Target-row capture preserves the Targets workspace until confirmation; setup, Back, local failure recovery, grouped capture review, and a 30-resource minimum-viewport stress case keep the action footer visible with one scrolling body.
- Library deletion isolates the selected Skill from invalid neighboring content, and global feedback provides a non-blocking copy action.
- Local imports remain usable after their original path is removed; per-Skill update-check defaults, opt-out persistence, and GitHub re-enable flows passed Store and Electron E2E coverage.
- In-place Skill Refresh, sequential GitHub directory import with per-item progress and partial failure, source-default Skill icons, custom Skill icon persistence, and independently auto-saved Profile identity metadata passed Store, renderer, and Electron E2E coverage.
- Skill Import source modes, compact row command menus, focused update settings, compact MCP rows, overflow-only MCP deletion, resource-first Apply Preview, and neutral Capture outcomes passed renderer, Electron E2E, and visual capture coverage.
- Library Skill disable, picker exclusion, update-check isolation, re-enable, and Apply-time Target removal and restoration passed Store, renderer, and Electron E2E coverage; Profile Skill switches use the same auto-save and Apply contract as Add and Remove.
- Skill table headers, compact grouped headers, retained version metadata, mixed-action rows, aligned metadata, empty install states, update labels, action-to-detail clearance, compact non-truncating Cleanup badges, equal-width Cleanup actions, and status-tooltip clearance passed coordinate, overlap, and overflow assertions at both supported viewports.
- Target-local import now creates an independent Library copy without changing the source path; shared managed paths deduplicate across Target scans, and auto-ready cleanup groups pass single, bulk, conflict-exclusion, persistence, backup, and responsive-layout coverage.
- Codex Capture now reuses identical Library Skills and previews a stable alternate ID for different same-name content instead of failing during Save. Same-name writable OpenCode and Claude Code destinations become explicit Preview review items and pass Backup, atomic replacement, ownership, and recovery assertions; Skills CLI and plugin metadata remain read-only evidence.
- Local Skill cleanup distinguishes Library-managed, outside, kept, and conflict states; consolidation remains transactional, preserves backup history, and never treats a cleanup choice as a Profile Apply omission.
- Native MCP discovery includes all configured names without copying credential values. OpenCode, Codex, and Trae CLI Apply change only native activation fields, preserve definitions added outside AgentEnv, block an enabled missing definition, treat a disabled missing definition as a no-op, and produce a real no-op when states already match. Trae CLI tests cover the TOML and YAML compatibility layouts independently and prove that inactive or obsolete configuration files remain untouched.
- Claude Code and Antigravity expose Agent-owned MCPs read-only. Antigravity CLI requires `agy`, applies and rolls back `GEMINI.md` and dedicated CLI Skills, transactionally migrates AgentEnv-owned legacy Skill copies, and leaves `mcp_config.json` unchanged.
- All six built-in adapters expose the same read-only Skill runtime contract. Tests cover direct and recursive discovery, symlink-cycle safety, frontmatter runtime identity, duplicate declarations, Claude plugin ownership, duplicate desired runtime names, Antigravity legacy migration with rollback, Trae CLI's version-neutral shared Skill location, and Pi's dedicated plus shared-compatible roots. Profile Skill On/Off is represented only by managed install presence, never by an Agent configuration switch.
- GitHub Device Flow respects server polling intervals, absorbs `slow_down` as a longer pending interval, blocks overlapping token requests, and refreshes connected account state after browser authorization.
- Apply Preview puts readiness or blocking state first, separates final payload from actual mutations, groups changes by resource meaning, keeps full paths in selectable detail, and opens each file diff on its owning row without widening the dialog. Replaceable drift is shown once as an explicit review requirement.
- Profile list icon and content columns remain aligned at the minimum viewport, and a deliberately long truncated Profile name keeps the same text origin before and after selection.
- JSON/JSONC, TOML, YAML, assignment-style, token-prefix, and private-key detection reject new literal credentials; legacy Preview before/after/diff payloads are redacted before reaching the renderer.
- Drift recovery adopts compatible Instructions and existing managed MCP activation choices into a backed-up Profile while naming excluded native configuration and unmapped items.
- Production dependency audit reported zero known vulnerabilities.
- The packaged arm64 macOS application completed an isolated OpenCode Profile takeover at `1180 x 728` without document overflow or writes to the real Agent environment.
- The macOS release workflow builds direct DMG/ZIP assets and separately named Homebrew DMGs with one pinned project identity on native runners. It verifies every App resource seal, expected Gatekeeper rejection, and the same certificate fingerprint and designated requirement across both channels and architectures. It then assembles an isolated draft, verifies downloaded hashes, and only then updates the checksum-bound Cask to the `-homebrew.dmg` assets. Quarantine removal belongs to the Cask postflight after Homebrew verification. The in-app Homebrew updater derives the directory containing the running App and passes it as an explicit `--appdir`, preserving both `/Applications` and per-user `~/Applications` installations without relying on shell configuration. Browser-downloaded direct packages keep quarantine for first install: users copy the App to Applications, eject the DMG, and complete both Open Anyway and the final Open confirmation; managed-device policy may still reject that exception. The fixed identity keeps Keychain and privacy grants stable across direct reinstalls without bypassing Gatekeeper.
- A directly installed macOS App in a writable Applications folder MAY update in app from the exact architecture-specific official Release ZIP. The main process streams the asset into a private cache, enforces the Release size and SHA-256, verifies the extracted bundle identifier, exact version, and complete `codesign` seal, then stages the App beside the current bundle. A detached helper preserves the current App, commits the staged bundle, and removes its quarantine only after those checks; the previous App remains recoverable until the replacement process writes a cache-contained startup confirmation. Failed launch or confirmation MUST restore and relaunch the previous App. Direct updates require explicit `Restart and update`, never install on quit, never request administrator credentials, and never include the data directory in the replacement transaction. A non-writable or invalid App location remains check-only with an official Release action.
- App Updates always displays the installed version and the latest known official version. Check,
  download, and install commands acknowledge the click immediately, retain animated local working
  feedback for the complete operation, and name the current stage without fabricating a percentage
  when the underlying installer cannot report byte progress.
- On macOS, the application menu exposes one stateful update command rather than separate check,
  download, and install commands. Its label and availability are derived from the same update status
  shown in Settings, and explicit installation continues to use the verified channel-specific flow.
- A prepared Homebrew update MAY finish automatically after quit. Quitting schedules a detached,
  cache-contained helper and exits without waiting for `brew upgrade`; the helper waits for the App
  process to stop, upgrades the same Cask into the detected Applications directory, verifies the
  expected installed version, and records a durable result. A launch during that operation shows a
  blocking startup phase until the helper completes, then relaunches the installed version when
  needed. A failed helper keeps the previous installation usable, surfaces a retryable update error
  on the next launch, and never modifies AgentEnv data. Direct Release installations remain explicit
  restart-and-update only.

## 26. Current Priority Gaps

1. Validate both the one-time v1-to-v2 migration and legacy shared-Library storage migration against an anonymized production-shaped data export and a packaged startup.
2. Extend the conditional duplicate review with more uncommon intentionally distinct same-name Skill fixtures.
3. Run the configured macOS arm64/x64, Windows, and Linux release jobs and retain their first public evidence receipt.
4. Validate the official Cask install, upgrade, quarantine removal, and application launch on a clean Intel Mac and a clean Apple Silicon Mac.
