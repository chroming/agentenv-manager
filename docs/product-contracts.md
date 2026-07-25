# AgentEnv Manager Product Contract

Date: 2026-07-23
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
- Live link is the default deployment policy: an explicitly confirmed Library update immediately affects linked Target Skills. Copy remains available for filesystems or users that do not use links; AgentEnv refreshes clean managed copies in the same Library-update transaction instead of storing a pinned version in each Profile.
- Auto deployment plans a Live link and MAY fall back to Copy only when the destination filesystem explicitly reports that directory links are unsupported. Permission failures, invalid paths, missing sources, storage failures, and unknown I/O errors MUST fail without fallback. The concrete result is verified after Apply. Changing the default deployment mode does not rewrite existing installs; it becomes an Apply precondition and takes effect only through a fresh Preview and Apply.

Source of truth: `~/.config/agentenv-manager` or the configured AgentEnv data root.

The active data root is a startup-owned location, not an ordinary live preference. Settings shows the exact active path and opens it, but MUST NOT present a fake editable control. Moving data uses the validated Backup/Restore path until an atomic migration-and-restart workflow exists.

### 4.2 Shared Runtime Locations

`~/.agents/skills` and other cross-tool compatibility paths MAY be consumed by more than one Target. They are migration sources, not canonical Library storage or AgentEnv's default deployment destination.

- Canonical Skill content MUST remain under AgentEnv data.
- Apply normally deploys Skills to the selected Target's dedicated managed directory. While an equivalent shared compatibility copy is active, Apply MUST record that Target's current `install` or `omit` intent without creating a duplicate dedicated copy.
- Applying an OpenCode Profile MUST NOT change Codex or Claude Code Skill directories, and equivalent isolation applies to every Target pair.
- Compatibility copies MAY be captured into a Profile, but MUST remain in place while any installed consumer lacks a current prepared Profile intent.
- Importing a compatibility copy creates an independent Library copy and MUST NOT replace, link, or remove the compatibility location.
- An exact Target-specific copy that already exists beside a compatibility copy MAY be adopted during Take over or a later Apply when its current canonical Skill hash matches the current Library hash. Adoption is previewed, backed up, verified again immediately before replacement, and MUST remain a no-op on the next Preview while shared migration is still pending.
- A compatibility copy is switched only through an explicit Scan local migration action after every installed consumer Target has applied a current preparation; Capture never removes it as a side effect.
- Completing migration MUST create one restorable backup for the shared paths, every affected Target path, and every affected Target state. It removes the shared paths first, deploys or omits the Skill according to each prepared Profile, verifies the result, and restores the whole transaction on any failure.
- AgentEnv MUST NOT edit per-Agent configuration to suppress duplicate discovery during this migration.
- `Keep shared copy` is a path-scoped decision. It MUST NOT ignore or alter same-name copies in Target-specific directories.
- A compatibility copy with conflicting content blocks automatic consolidation.
- Manager-related metadata, including Skills CLI lock files, is read-only evidence. It does not prove ownership, and AgentEnv MUST NOT silently edit or delete it.
- Importing a readable Skill path creates an independent Library copy and MUST NOT imply that AgentEnv has taken over the source installation. Lock files, symlinks, and adapter metadata are evidence about provenance, not proof that another tool owns the destination path.
- A Target-specific Skills root MAY itself be a symbolic link to a shared or external directory. Capture MAY read that linked content, but Apply MUST treat the root link as one filesystem boundary: Preview names the link and resolved destination, Apply backs up and atomically replaces only the root link with a real Target-owned directory before installing child resources, and the linked destination remains untouched.
- A broken or cyclic Target Skills root link is still a recoverable filesystem boundary: Preview MUST identify it as a reviewed root replacement, Backup MUST preserve the link itself without traversing it, and Apply MAY replace only that link with a Target-owned directory. A non-link file occupying the Skills root remains blocking. Rollback after root isolation MUST restore the exact original link and remove only the Target-owned directory created by AgentEnv.
- A legacy installation that stored Library originals in `~/.agents/skills` is migrated once during startup. AgentEnv builds the complete destination in staging and atomically replaces the canonical Library directory; the shared source remains byte-for-byte untouched. Exact destination matches are reused, differing destination entries are retained under a deterministic `-pre-shared-migration` identifier, and a machine-readable report records every copied and preserved entry. Failure leaves the old Settings value in place so retry remains idempotent; interrupted replacement uses the normal replacement journal recovery.

### 4.2.1 Workspace Sync

Workspace Sync reuses portable environment intent across the user's Macs through a user-owned private Git repository. It is not Target deployment and MUST NOT automatically Apply a Profile.

- The portable snapshot includes complete Profile v2 data, canonical Skill content and executable bits, portable Skill update metadata, global Skill availability, and the Skill source registry.
- Target states, credentials, GitHub tokens, settings, backups, trash, history, observations, caches, absolute local paths, and manager-evidence lock paths MUST NOT enter a snapshot.
- Device-local Skill source records excluded from the portable snapshot remain untouched when this Mac receives remote source-registry changes. Exclusion from Sync MUST NOT delete local-only source intent.
- Snapshot output MUST be deterministic. A workspace with unchanged portable content produces the same content hash and no Git commit.
- The application MAY check the remote repository in the background, but MUST NOT automatically update this Mac, publish, merge, or Apply.
- Background Check MUST use Sync-local serialization and MUST NOT hold the application-wide mutation lock while waiting on Git or the network. Update, Publish, recovery, connection changes, and disconnection remain globally serialized mutations.
- Update and Publish require a fresh remote revision. Non-fast-forward changes and rewritten history MUST stop the operation; AgentEnv MUST NOT force-push.
- Comparison is three-way against the last accepted base. Changes to different Profile or Skill sections MAY combine automatically. Concurrent changes to the same section, and delete-versus-modify, require an explicit local or remote choice.
- Updating this Mac validates the complete candidate, creates one Workspace recovery backup, writes Profile, Library, and source registry data under the global mutation lock, verifies the result, and automatically restores all three on failure.
- If portable content is written but the accepted base or Sync state cannot be committed, AgentEnv MUST restore the Workspace recovery backup before reporting failure. A failed restore remains `Recovery required`.
- An interrupted or failed restore enters `Recovery required`. The referenced recovery backup MUST NOT be removed by retention or manual backup cleanup.
- Remote symlinks, path traversal, duplicate ids, broken references, unsupported future formats, embedded URL credentials, private keys, high-confidence tokens, and resource or total size-limit violations MUST be rejected before local mutation.
- System Git authentication belongs to the operating system SSH Agent or credential helper. AgentEnv MUST NOT store repository passwords, tokens, or private keys, modify global Git configuration, run repository hooks, sign commits, or prompt through a hidden terminal.
- Ordinary non-AgentEnv files in the repository remain untouched. Only `agentenv-sync.json` and `workspace/` are managed.
- A remote Skill content change that affects a currently linked deployment has immediate runtime impact. Review MUST identify that impact and require separate confirmation. Copy deployments and Profile-only changes remain pending until ordinary Profile Apply.
- Immediate linked-Skill impact is calculated only for Agents currently enabled in Settings.
- Connect treats a new repository and branch as a candidate. It MUST validate access, remote format, workspace identity, and the initial comparison before replacing an existing connection. Candidate failure preserves the previous connection, accepted base, status, Profiles, and Library. Reconnecting the same repository and branch is an ordinary Check.
- A successful connection change starts a new three-way base unless local and remote portable snapshots are identical. Disconnect removes only device-local Sync state and cache; it MUST NOT change Profile, Library, Target, remote repository, or operating-system Git credentials.

Workspace Sync states are `Not connected`, `Up to date`, `Changes to publish`, `Changes to receive`, `Review required`, `Could not check`, and `Recovery required`. `Checking`, `Publishing`, and `Updating` are temporary activity states, not persisted outcomes.

### Skill evidence and asynchronous feedback

- Repository source groups expand from the non-interactive area of the complete row. Links, rename, selection, and row actions retain their own effects and MUST NOT also toggle disclosure.
- Source-group multi-selection is a temporary Merge prerequisite, not persistent list chrome. Checkboxes appear only after `Merge`; `Escape` or the exit control clears the temporary selection.
- Every asynchronous command MUST acknowledge work on the initiating control immediately. Loading icons use the shared motion primitive rather than page-local animation rules.
- Whenever AgentEnv can read a trustworthy upstream commit time, Library metadata update time, or local `SKILL.md` modification time, version-choice and conflict-review surfaces MUST present it alongside version and content hash. Missing or unreadable timestamps remain omitted or explicitly unknown; timestamps never replace content comparison.

### 4.2.2 Global Quick Open

Quick Open is a navigation accelerator, not a second command model.

- `Cmd/Ctrl+K` opens one global search across Profiles, Library Skills, Agents, workspaces, and safe navigation actions.
- Results inherit the same visibility and availability rules as their owning workspace. Quick Open MUST NOT bypass dirty-Profile confirmation, destructive confirmation, disabled-resource rules, or Target ownership checks.
- Search, active selection, and result list use the standard combobox/listbox accessibility model. Arrow keys move one result, Home and End move to the first and last result, Enter opens the active result, and Escape restores focus to the invoking surface.
- The active result MUST remain visible while keyboard navigation moves through a longer result list. Opening an item closes Quick Open before navigation so focus and feedback belong to the destination workspace.

### 4.3 Profile

A Profile is a saved environment recipe. It owns:

- Instructions.
- References to Library Skills, each with an install name and enabled state.
- An independent MCP policy for each Target: `Leave unchanged` or a sparse set of `On` and `Off` choices for MCP servers already defined by that Agent.

Instructions, Skills, and MCPs each have an independent management mode for every Target. The mode is part of the saved Profile recipe, not a global application preference.

- `Managed by Profile` includes that resource category in Save, Preview, Apply, drift detection, Backup, and verification for the selected Target.
- `Not managed` preserves the saved Profile content and visible resource count but excludes that category from the selected Target's effective payload. In steady state, Apply MUST NOT inspect, fingerprint, validate, write, remove, or claim new ownership over the Target's corresponding resources.
- Turning management off is a Profile edit and does not mutate the Target until Save, Preview, and Apply. Turning it back on uses the same fresh Preview and explicit drift confirmation as any other managed replacement.
- The transition to `Not managed` MAY touch only resources already owned by AgentEnv when detachment is required. An already AgentEnv-managed Skill live link MUST first be materialized as a standalone copy of its current content. Preview names that transition and Backup protects it. This prevents later Library updates from changing an opted-out Target without Apply while retaining enough paused ownership evidence for safe drift review when management resumes.
- Paused ownership evidence MUST NOT contribute to ordinary managed-resource counts or drift status. It is consulted only when management resumes, and a refreshed managed snapshot replaces it after a successful Apply.
- Missing legacy Instructions and Skills modes default to `Managed by Profile`; a missing MCP mode defaults to `Not managed`.

A Profile MAY record a preferred Target for default UI context and the Target it was created from for provenance. Neither field binds deployment: the same Profile MAY be applied to every compatible Target, and each Target still has at most one active Profile.

Create from Target MAY record a machine-local Capture receipt containing source paths, location roles, and content hashes. The receipt is optional takeover evidence, lives outside portable AgentEnv data, is never part of the Profile or data backup, cannot authorize content that differs from the current Library hash, and is consumed after the first successful Apply to that Target. Missing or malformed receipt data falls back to current content and path-capability validation.

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
- Disabling a Skill removes AgentEnv-owned deployments automatically. A writable Target location outside AgentEnv MAY be removed only as a reviewed, backed-up Apply effect. A path explicitly marked `Keep outside AgentEnv` is preserved and excluded from that Target's effective managed payload. Observe-only locations are reported but never mutated.

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
- Opening Skills for an undetected Agent MUST show the missing installation prerequisite in the work surface, keep setup disabled with a readable reason, and direct the user to install then Refresh. It MUST NOT present a generic preservation flow that appears actionable.
- Installation detection MUST use adapter-declared authoritative evidence. A command, desktop application, or another verified platform installation marker MAY establish installation; stale configuration files MUST NOT.
- A desktop application is installation evidence for an existing Agent only when it consumes that Agent's declared user-level resource paths. It does not create another Agent, destination choice, or Apply operation.
- Multiple installation signals for the same Agent MUST produce one Agent row and one deployment plan. AgentEnv applies to the declared file boundary once, regardless of whether a command, desktop application, or both are present.
- IDE extensions are outside the current installation-discovery scope.
- Installation probes MUST be platform-aware and testable without reading the developer's real machine. A macOS application probe MUST NOT prevent the same adapter from using command or platform-native evidence on Windows and Linux.
- Shared Library data and global compatibility locations remain global concerns; disabling one Agent MUST only remove that Agent's identity and dedicated paths from consideration.

Status: explicit persisted scope, discovery filtering, command and compatible macOS desktop-application evidence, renderer filtering, operation guards, managed-Agent confirmation, and recovery lock are `Implemented`. IDE extension discovery is intentionally out of scope.

### 4.4.2 Agent Skill Management

Agents is the contextual entry for users who want to manage the Skills used by one
installed Agent without first learning Library maintenance, Profile composition, or local
cleanup. It is a facade over the same canonical Library, ordinary v2 Profile, and
Preview/Apply transaction used everywhere else; it is not a simple mode or a second
resource model.

- `Manage Skills` opens a dedicated Agent detail surface. The Agent list MUST NOT expand a
  second editor inside a row.
- An unmanaged Agent first offers to preserve its current Skills. This command reuses
  Create from Target: the read-only Capture review creates an ordinary Profile and imports
  or reuses canonical Library Skills. It never changes the Agent.
- Skills-only Capture MUST NOT parse or depend on native Instructions or MCP configuration.
  A malformed native config cannot block Skill management when the Skill directories remain
  readable.
- Saving the captured setup and applying it are separate persistence boundaries inside
  one guided intent. If saving fails, partial Profile and Library changes are rolled back.
  If Apply later fails, the valid saved setup remains available for retry while the Agent
  is restored or left unchanged by the normal Apply contract.
- If a previously captured Profile for the Agent was saved but never applied, `Manage
  Skills` resumes the newest valid saved setup instead of asking the user to capture the
  same Agent again.
- A managed Agent detail shows the active Profile's Skill references, Library identity,
  version, source, deployed state, and availability. It does not duplicate global source
  settings, global disable, duplicate cleanup, or Library deletion.
- Enabling, disabling, adding, relinking, or removing a Skill from this surface updates
  the ordinary Profile intent atomically and marks affected Agent deployments pending.
  It does not write an Agent until the user chooses `Review and apply`.
- An Agent detail Skill edit MUST use the latest persisted Profile and reject stale
  content. A semantic no-op performs no write and does not create pending deployment.
- If the Profile is active on more than one Agent, the first edit MUST ask whether to
  update the shared Profile or create an Agent-specific copy. It MUST NOT silently change
  the desired environment of peer Agents.
- Adding from Library filters out globally disabled and already attached Skills. Importing
  new content remains a Library operation, but an import initiated from Agent detail MUST
  retain the parent intent and offer to attach the imported Skills to that Agent's Profile.
- A Library update remains a global canonical mutation. Agent detail may start its review,
  but impact disclosure MUST name every affected Profile and linked Agent. Live-link
  effects are never represented as Apply-gated.
- Drift, outside or observe-only resources, broken links, ambiguous duplicates, and recovery are
  conditional decisions inside `Manage Skills`. They do not become permanent peer
  workflows or require the user to visit Local Skill Cleanup unless that owning surface is
  necessary to resolve the exact issue.
- A missing or malformed active Profile is a recoverable local error, never an unmanaged
  state. The Agent detail shows the failure and Retry instead of offering a new takeover.
- On first run with no usable Profile, one detected enabled Agent opens directly to its
  detail; multiple Agents first show the ordered Agent list. Back returns to that list
  without changing persisted state. Later launches restore the last stable top-level
  workspace instead of repeatedly forcing the first-run route.

Status: contextual Agent detail, Skills-only Capture, atomic Profile Skill intent editing,
shared-Profile guard, Library import return, local load recovery, and guided
Capture-to-Apply orchestration are `Implemented`, including first-run direct entry for one
installed Agent and persisted top-level workspace restoration.

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
- `Continue in` normally creates a new target conversation initialized from the selected visible
  context. It MUST NOT claim that a native session ID, hidden model state, or running tools moved
  between Agents.
- The ordinary path is one explicit destination choice followed by direct launch. Review is
  required only when content exceeds the adapter's safe delivery boundary, referenced content is
  unavailable, sensitive text is detected, or the target cannot receive context automatically.
- Context MUST NOT be placed in command-line arguments. Adapters MAY use a native import API,
  stdin, or an app-owned mode-`0600` context file. A clipboard fallback occurs only after the user
  explicitly invokes `Continue in` and MUST report that paste is still required.
- Conversation support is a capability of one Agent integration. Unsupported or metadata-only
  formats remain visible with an honest capability state; the renderer MUST NOT infer support from
  an Agent name or path.
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
  storage is unavailable or unsupported.
- Handoff transcript text is untrusted historical data. Generated continuation context MUST tell
  the target Agent to ignore instructions embedded in transcript or tool output and to treat the
  current repository plus the user's new request as authoritative.
- Conversation discovery MUST NOT delay startup, Profile loading, Library loading, or Agent
  discovery. Opening Conversations reads the last-good cached index only; revisiting the page does
  not implicitly rescan every Agent. An empty cache MAY start one first-use refresh per application
  session after the empty cached read has completed. Later refreshes require the explicit Refresh
  command.
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
- Agent filters show indexed counts for every enabled history-capable Agent. A zero count is an
  honest source state, not an implication that another Agent's records belong to that Agent.
  Metadata-only histories remain useful by displaying their source summary while clearly disabling
  transcript-dependent actions.
- During explicit or first-use refresh the last-good rows, inferred Agent icons, selection, and
  detail remain stable behind a region-scoped progress overlay. The overlay blocks only the
  Conversation workspace, not application navigation, and MUST NOT depend on the current Target
  discovery array to identify already indexed Agent rows.
- The detail reader presents one task header followed by a readable transcript. Consecutive
  messages from the same role are grouped without changing message order. Visible Markdown,
  tables, lists, and fenced code MAY be rendered, but raw HTML is never executed, remote images
  are never loaded from history, and external links open only through the validated desktop API.
- Opening a full conversation initially reads only a bounded tail page so a very long transcript
  cannot saturate IPC or Markdown rendering. Earlier messages load in explicit bounded pages while
  preserving chronological order. Copy and Continue remain whole-conversation commands and fetch
  the complete indexed transcript only after the user invokes them.
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
| Save | Persist the entire Profile draft. It does not change any Target. |
| Import | Copy or ingest a resource into the canonical Library. Imported content no longer depends on the original path for normal use. |
| Track source | Attach an explicit update source to a Library resource. It does not update immediately. |
| Check update | Compare canonical Library content with its explicit tracked source. It does not write. |
| Update | Replace canonical Library content after preview. It marks affected deployments pending; it does not deploy. |
| Add to Profile | Add a Library reference to the Profile draft. Save is still required. |
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
| Keep outside AgentEnv | Preserve one concrete machine-local Skill path outside AgentEnv deployment. It remains visible and is excluded from Apply until reviewed again. |
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
| Clean | Draft equals saved Profile. | Edit or choose Target. |
| Dirty | Draft differs from saved Profile. | Save. |
| Saving | Whole Profile is being persisted. | Wait; duplicate Save is blocked. |
| Save failed | Draft is preserved and persistence failed. | Retry Save. |
| Saved, never applied | Profile is valid but has no deployment on selected Target. | Preview Apply. |
| Saved, changes pending | Selected Target has an older Profile or Library version. | Preview Apply. |
| Applied | Saved Profile, effective Library versions, and managed Target files match. | No Apply action. |
| Applied with outside resources | The saved Profile is current, while one or more concrete machine-local Skill paths are intentionally kept outside AgentEnv. | Review the named local exceptions when needed. |
| Validation blocked | Saved Profile resources need correction before Apply. | Fix the named row or open the owning product area. |
| Drifted | Managed Target files changed outside AgentEnv. | Apply to create a fresh preview. |
| Recovery required | Target history requires intervention before normal Apply. | Open Recovery. |

Rules:

- Save MUST persist the complete Profile, not an individual accordion section.
- Save MUST expose local working feedback immediately. Once persistence succeeds, the editor becomes clean and Apply availability is recalculated from the returned saved Profile without waiting for Target discovery, inventory scanning, update checks, usage aggregation, or a full-page refresh.
- Save, Apply, and Target selection MUST appear as one compact action group in the selected Profile context. The Profile-scoped destination selector sits immediately before Apply, with Save in the same compact group. Page creation controls MUST NOT separate these lifecycle commands.
- Save and Apply MUST keep stable labels and positions. A dirty Profile highlights Save and disables Apply; after Save, Save is disabled and Apply becomes the primary action.
- The commit verb remains `Apply` in Ready, Review, drift, and protected-replacement states. Backup and replacement safeguards are disclosed inside Preview; they MUST NOT rename the commit command to `Apply with backup` or introduce a parallel apply workflow.
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
- A blank Profile is not created as Agent-bound. Its create dialog asks only for portable identity fields; the persisted preferred Target is an initial preview hint and is labelled `Preview Agent` when exposed after creation. `Source Agent` appears only when the user explicitly chooses Capture from Agent, and `createdFromTargetId` records provenance rather than compatibility.
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
  -> Applied with outside resources
                        transaction succeeds with kept-path exceptions
  -> Apply failed       writes fail and automatic restore succeeds
  -> Recovery required  writes and automatic restore both fail

Applied
  -> Changes pending    Profile or referenced Library version changes
  -> Drifted            managed Target content changes externally
  -> Unmanaged          Stop managing completes

Applied with outside resources
  -> Changes pending    Profile, effective Library version, or path policy changes
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
| Applied with outside resources | Target-specific Profile hash and effective managed resources match, while persisted machine-local path exceptions remain active. Kept Skills are excluded from applied Library versions. |
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
| `duplicate-native-mcp` | `block` | `external-action` | One MCP identity is defined ambiguously in multiple native locations. |
| `agent-owned-native-mcp` | `block` | `external-action` | Requested MCP activation is owned by an unsupported Agent surface. |
| `unsafe-native-mcp-update` | `block` | `external-action` | The native MCP activation field cannot be changed without touching unrelated settings. |
| `globally-disabled-skill` | `notice` | `automatic` | A Profile reference is omitted because its Library Skill is globally disabled. |
| `missing-library-skill` | `block` | `edit-profile` | A Profile references missing canonical Library content. |
| `outside-skill-replacement` | `review` | `backup-replace` | A writable Target Skill outside AgentEnv must be replaced to satisfy Profile intent. |
| `outside-skill-removal` | `review` | `backup-replace` | A writable Target Skill outside AgentEnv must be removed to satisfy complete replacement intent. |
| `kept-outside-skill` | `notice` | `preserve` | A machine-local path policy excludes this Skill path from AgentEnv management. |
| `managed-resource-drift` | `review` | `backup-replace` | An AgentEnv-owned resource changed outside AgentEnv. |
| `managed-resource-missing` | `notice` | `automatic` | A missing AgentEnv-owned resource will be restored from canonical intent. |
| `duplicate-runtime-skill` | `block` | `edit-profile` | More than one enabled Profile resource resolves to the same runtime identity. |
| `native-disabled-skill` | `block` | `external-action` | The Agent's native settings disable a Skill required by the Profile. |
| `runtime-observation` | `notice` | `preserve` | Read-only runtime evidence is disclosed without mutation. |
| `runtime-state-unavailable` | `block` | `external-action` | Required runtime state cannot be inspected reliably. |
| `runtime-skill-conflict` | `block` | `external-action` | Runtime discovery reports ambiguous or conflicting Skill identity. |
| `unsupported-skill-management` | `block` | `edit-profile` | Profile requests Skill management unsupported by the adapter. |
| `shared-skill-conflict` | `block` | `external-action` | Shared compatibility content conflicts with canonical intent. |
| `shared-skill-deferred` | `notice` | `preserve` | Shared compatibility content remains until all consumers have explicit intent. |
| `skill-root-isolation` | `review` | `backup-replace` | A linked Agent Skill root will be isolated without modifying its destination. |
| `invalid-skill-root` | `block` | `external-action` | The Agent Skill root is an unsafe non-directory boundary. |
| `recovery-required` | `block` | `open-recovery` | An interrupted mutation must be recovered first. |
| `operation-precondition` | `block` | `external-action` | A named non-editable precondition prevents a deterministic plan. |
| `operation-notice` | `notice` | `preserve` | A named operation fact requires disclosure but no action. |

Every issue row MUST include a concrete resource identity when one exists. Every `review` issue MUST include its exact affected path. A policy change requires a product-contract change and automated contract-policy verification in the same commit.

True blockers appear before the change plan. Replaceable Agent drift, an ordinary writable destination outside AgentEnv, and a Target Skills root link are review requirements rather than duplicate blockers. `After Apply` describes the final effective Instructions, Skills, and MCP payload; `Changes this Apply` contains only actual mutations grouped by semantic resource type. Concrete identities and actions precede secondary filesystem detail. Full paths remain selectable through hover/focus detail, file diffs expand on their owning rows, and kept-outside items and non-blocking notes remain collapsed after the change plan. Header and footer stay fixed while one dialog body owns vertical scrolling; only large diff content may own nested code scrolling. Preview does not display generation timestamps because freshness is enforced by the stale-preview contract rather than user inspection.

Managed Skill drift compares canonical Skill content rather than symbolic-link text. A Live link or managed copy that exactly matches the currently referenced Library content is an expected Library transition, not an external Agent change. Every genuine drift issue names the concrete Skill and exposes its selectable path; repeated anonymous Target-level warnings are forbidden.

A Preview becomes stale when any of these changes:

- Saved Profile content.
- Referenced enabled Library Skill content or a native MCP definition inspected by the selected Target's managed policy.
- Any live file or resource included in the plan.
- Deployment state.
- Selected Target.

Skill inventory freshness is a semantic projection, not a fingerprint of every discovered Skill. It includes exact Profile destinations, relevant runtime-name conflicts, Profile-referenced resources, AgentEnv-owned cleanup candidates, and shared compatibility facts used by the plan. An unrelated local Skill that cannot change the reviewed result MUST NOT stale Apply.

Apply MUST reject a stale Preview before writing. The client SHOULD refresh that Preview in place and require confirmation of the refreshed effects instead of presenting stale data as a permanent blocking issue. A concurrent operation is a temporary working state, not a resource conflict; it MUST NOT be rendered as a permanent Preview blocker.

No-op contract:

- A Preview with no changes MUST produce `Applied`, or `Applied with outside resources` when a persisted path exception is part of the effective result.
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
5. Preserve observe-only and explicitly kept-outside resources.
6. Write deployment state only after all resource writes succeed.
7. Record one history entry only after success.
8. Refresh visible Profile and Target state after completion.

Apply executes the immutable Preview plan. It MAY re-read and hash the plan's bound preconditions, but MUST NOT rerun runtime conflict classification, asset ownership classification, backup-path discovery, or stale-resource discovery after confirmation. Newly discovered facts outside the reviewed plan remain untouched. A changed bound precondition returns `stale` before Backup or mutation.

Switching Profiles MUST reconcile every writable Skill location declared by the selected Target adapter. Skills absent or disabled in the Profile are removed from managed locations; content outside AgentEnv is changed only when the fresh Preview names the exact backup-and-replace or backup-and-remove effect. Observe-only locations and paths marked `Keep outside AgentEnv` remain unchanged. MCP choices absent from the sparse policy remain Agent-controlled.

A same-name Skill replacement outside AgentEnv MUST be scoped to exact paths named by the fresh Preview, included in the operation Backup, and installed atomically as an AgentEnv-owned resource. Confirming that Preview authorizes only those named paths. External-tool evidence does not create a blocker by itself; an unsupported or observe-only path capability does.

Takeover is the first Apply to an unmanaged Target. Preview MUST disclose:

- Existing content that will be replaced.
- Existing content that will be adopted, reviewed for replacement or removal, kept outside by policy, or observed without mutation.
- Conflicts that prevent takeover.
- Backup availability.

Status: transactional backup, reviewed outside-path replacement, kept-path preservation, and automatic restore are `Implemented`.

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
- Import presents only `Local` and `Repository` as source modes. A local selection MAY be one Skill directory, a containing directory with multiple nested Skills, or a ZIP archive; a separate Projects workflow or saved-location concept MUST NOT duplicate this intent.
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
- Persisted update-source types remain `local`, `github`, and `git`. ZIP is represented only as local import provenance and MUST NOT become a hidden continuously checked source type.
- Selecting a Library Skill name opens a read-only file browser. The name is the only file-browser trigger in the row and exposes pointer, hover, and keyboard-focus affordances; clicking the description, source, version, usage, status, install data, or row background MUST NOT open it. The browser lists only regular files contained by the canonical Library Skill, hides AgentEnv metadata, skips links, rejects escaped or resolved-outside paths, previews text with syntax highlighting, and reports binary or oversized files without decoding them. Browsing never changes the Skill, its source, a Profile, or an Agent install.
- Repository imports default to the `Tracked` update policy. The canonical HTTPS source locator is durable metadata. For a System Git import on any host, an HTTPS authentication, authorization, or repository-access failure MAY retry the equivalent `git@host:path.git` locator through the user's existing SSH setup. Timeout, DNS, malformed URL, parse, cancellation, and ordinary network failures MUST NOT trigger a transport fallback. The scan summary discloses `SSH fallback`, while persisted provenance keeps the canonical HTTPS source and records the access transport separately.
- A GitHub Web URL MAY identify a Skill directory, a containing directory, or a repository. Other Git Web URLs MAY infer Ref and Directory only from the explicit and structurally unambiguous `/tree/<ref>/...` or `/-/tree/<ref>/...` forms; all other provider-specific layouts use separate Ref and Directory fields instead of guesswork. A supplied subdirectory is a hard scan boundary: no candidate outside it may appear. When that directory directly contains `SKILL.md`, it is the sole candidate; otherwise only valid top-level Skill roots below that directory are listed. Containing-directory and repository imports MUST scan recursively for valid top-level Skill roots before any Library write.
- `github.com` Web URLs use the GitHub API by default. SSH, SCP-like, non-`github.com`, and explicitly selected System Git locators use the packaged application's discovered system `git` executable and the user's existing SSH Agent or Git credential helper. AgentEnv MUST NOT store Git passwords, access tokens, private keys, or credential-helper output.
- In `Automatic` connection mode, a GitHub API 401, 403, or private-repository-style 404 MAY retry through System Git and then the equivalent GitHub SSH transport under the same access-failure boundary. Rate limits, network failures, and malformed URLs MUST NOT trigger this fallback. When automatic fallback cannot proceed, the user MAY explicitly choose `Try with System Git`.
- Scan results MUST appear in a confirmation dialog, select all importable candidates by default, allow individual candidates to be excluded, and identify already-imported or duplicate candidates without selecting them. The bulk-selection control MUST expose all, mixed, and none states while keeping its label and selected count aligned without overlap at the minimum supported viewport.
- A batch import MUST process selected candidates sequentially in the same dialog. Each candidate advances through distinct queued, reviewing, writing, completed, failed, or skipped states; only the current candidate may open the conditional duplicate review.
- A candidate becomes completed only after its canonical Library write has returned successfully. Completed candidates remain visible and preserved when a later candidate fails or is skipped.
- While a batch is active, `Stop import`, Escape, or the dialog close control requests a cooperative stop and keeps the result dialog visible. A write that already completed remains completed; a cancelled review or write and every candidate not yet started become `Skipped`, not failed. Each skipped row exposes an independent `Import` action.
- After the final candidate, the dialog MUST show one aggregate success or partial-failure result and remain open until the user explicitly closes it. A batch import MUST report each failure against its source. Failed rows use a compact failure state and expose the complete selectable error in a hover/focus detail layer.
- Scan, Preview, and the immediately following Import MAY reuse the same successful Repository snapshot or GitHub response. Explicit Scan and Check updates bypass completed response caches while still coalescing identical requests that are concurrently in flight. Update Preview reuses a fresh immutable result from the immediately preceding check; when that result is absent or expired, Preview performs a fresh read. Materialization MUST use one repository tree and bounded parallel file reads rather than recursively serializing one remote request per directory and file.
- A multi-Skill GitHub check groups Skills by repository and ref, reads one complete commit tree per group, and derives each Skill-subtree revision from that shared immutable tree. Per-Skill commit-time requests run only for changed candidates. A just-imported tracked Skill immediately replaces any stale same-ID check result with its persisted revision and MUST NOT display `Update available` until a later fresh check proves a difference.
- Every Skill has an independent `Tracked` or `Untracked` update policy. `Untracked` excludes that Skill from the global Updates result, update reminders, and batch Update review. An explicit source-level `Check` MAY still read its source to update the source projection without creating a Skill update reminder.
- A Skill row overflow is a compact command menu. Update source and tracking fields live in one focused `Update settings` dialog and MUST NOT turn the row menu into a scrolling form. Source and tracking edits remain staged until one `Save settings` command succeeds; closing the dialog discards both, and a partial visual save MUST NOT imply that only one field was persisted.
- The UI status for this durable policy is `Monitoring off`; temporary wording such as `Checks off` and source-type wording such as `Fixed copy` MUST NOT substitute for the policy.
- The global auto-check setting controls scheduling only. Within that schedule, only source groups whose routine-check policy is `Monitored` are read; results are surfaced only for member Skills whose independent policy is `Tracked`.
- Legacy metadata without an explicit policy defaults to `Untracked` for local sources and `Tracked` for GitHub API and System Git Repository sources.
- Import validates `SKILL.md` and rejects unsafe or ambiguous directory layouts.
- Skill version metadata is normalized from either ClawHub's top-level `version` field or Agent Skills' `metadata.version` field. String and numeric scalar versions are accepted. Conflicting values declared in both locations are rejected rather than silently prioritized.
- Library identity is the stable `id`; duplicate detection uses the normalized frontmatter `name` and also guards storage-ID collisions. Import MUST NOT silently create a suffixed ID when a same-name Skill exists.
- A same-name import opens one conditional review step before any write. It compares declared version, full content hash, source, modified time, `SKILL.md`, and every changed file against each matching Library entry. Modified time uses the upstream Skill-subtree commit time when available and otherwise the local `SKILL.md` modification time; unavailable values remain explicitly unknown. Identical content is labelled explicitly and can only reuse the existing entry. Different content requires an explicit choice between replacing a selected Library entry or saving under a validated unique ID.
- Import comparison treats trackable online provenance as part of the Skill's useful state. When content is identical but an incoming Repository source differs from or improves on the existing local provenance, the review labels `Source available` and offers `Update source`. This operation preserves every Skill file and stable Library ID while updating source, revision, upstream, transport, and `Tracked` policy metadata. Different local paths alone do not create a source conflict, and a local import never silently downgrades an existing online source.
- When an online source exposes a verified commit time for the Skill subtree, AgentEnv stores it separately from the local Library write time. Generic Git reads use a bounded blobless history window and MUST omit a path time when its newest visible match is the shallow-history boundary; a repository HEAD time is never substituted for a Skill path time. The Skill list and duplicate-import comparison label this as the upstream update time; unavailable source time is omitted rather than inferred from repository or local file timestamps.
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
- `Cmd/Ctrl+R` in Library/Skills invokes the same in-place Refresh command and MUST NOT reload the renderer.
- Refresh MUST preserve the current search, filters, scroll context, and rendered Skill list until replacement data is ready. It MUST NOT flash a temporary empty state.
- Update and install-repair commands MUST appear in their semantic `Updates` and `Installs` columns. The `Actions` column is reserved for the overflow menu and MUST NOT compete with labelled row actions for width.
- Row actions and their secondary revision or install state MUST occupy independent vertical tracks. A control's rendered height MUST fit inside its track, with at least `4px` clear space before secondary text; child overflow MUST NOT be used to compress the row.

### 16.1.2 Source view

- `Skill list` remains the canonical Library resource view. `By source` is a peer view inside Skills, not a separate navigation area, source subscription system, or replacement for per-Skill management.
- A source group is identified by one deterministically normalized complete import scope. Repository sources use repository identity, ref, and directory; local sources use one canonical absolute root directory. Parent and child scopes and unrelated complete links MUST remain separate until the user explicitly merges them. Similarity, URL prefixes, Skill names, and matching content MUST NOT merge groups automatically.
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
- Every AgentEnv-managed install derived from a removed ID is relinked or recopied to the surviving Library entry without waiting for another Apply. Outside and kept paths are untouched.
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

Scan MAY read supported versions of `$XDG_STATE_HOME/skills/.skill-lock.json` and `~/.agents/.skill-lock.json` to recover Skills CLI provenance evidence. These files do not prove current ownership. Unsupported or corrupt lock data MUST degrade to ordinary filesystem scanning and MUST NOT block unrelated Skills.

The surface owns only filesystem-copy normalization into Library. It does not edit Profile membership or orchestrate Apply. Scan itself is read-only: it produces a cleanup plan, and mutation begins only after the user confirms that plan.

User-facing state and action contract:

- Results are sorted once after a completed scan into `Needs your decision`, `Ready to clean up`, `Managed`, and `Kept outside AgentEnv`, in that order. Names sort stably inside each section. `Managed` and `Kept outside AgentEnv` are collapsed by default.
- Row status badges use a compact, non-truncating vocabulary: `Managed`, `N versions`, `Changed`, `Outside`, `Shared`, `Ready`, `Kept`, and `Unavailable`. A content conflict without a Library canonical MUST state the number of versions instead of exposing the generic internal state `Conflict`. The selectable hover/focus detail carries the complete explanation; a badge MUST NOT clip or ellipsize its visible label.
- Cleanup rows reserve stable identity, status, and action columns. Every status badge starts at the same left-aligned position regardless of Skill-name length or whether the row has a current action; the action column remains reserved when only the overflow command is available.
- Library is the canonical Skill source; a Cleanup row marked `Managed` represents one or more physical Target installations derived from that Library entry, not another Library record. Library-bound rows expose the neutral relationship `Library / <id>` and managed-install count without duplicating Library update or deletion commands inside Cleanup.
- `Ready to clean up` includes: one writable outside copy, identical writable outside duplicates, an unimported shared compatibility group with one unambiguous content version, copies already matching Library, stale managed copies, local copies that differ from an existing Library canonical copy, prepared shared-copy replacements, and safely removable broken symbolic links including links in shared compatibility roots. Generic bulk-ready rows expose only Details and secondary retention controls in overflow; they MUST NOT repeat a primary row action. A prepared shared-copy replacement also exposes its dedicated `Replace shared` action for users who want to handle it independently.
- When Library already contains the Skill, Library wins automatically. Divergent local copies are backed up before being replaced with Library-managed links. When Library does not exist and multiple different local versions exist, the group stays in `Needs your decision` and version selection appears inside `Add to Library`.
- A broken symbolic link can be planned for removal when Cleanup can prove it will remove only the link itself and back up its link metadata. Manager-related evidence is retained for diagnostics but does not grant or revoke mutation authority. An unreadable directory or manifest, an observe-only path, an unknown Target, a permission error, or ambiguous canonical content MUST remain in `Needs your decision` and MUST NOT be deleted automatically.
- `Clean up N` is the one emphasized bulk command and appears in the `Ready to clean up` section heading only when at least one safe plan exists. It uses the shared compact button primitive in a trailing action slot, keeps its intrinsic width at every supported viewport, and MUST NOT stretch to fill the heading row. Its confirmation groups effects as add-and-link, link-to-Library, backup-and-link, repair-link, remove-unavailable-link, and prepared shared-copy replacement with each Target's saved install-or-omit decision. A failure in one Skill does not roll back completed independent Skills, and the result reports both completed and remaining groups.
- Decision rows expose one lightweight current action. Read-only details, keep-outside, shared retention, and review-again controls live in overflow. Internal states such as `Auto-ready`, `Take over`, and `Resolve conflict` MUST NOT be presented as user actions.
- The main process MUST rescan and compare the reviewed content hashes immediately before mutation. Stale previews fail without modifying Library or local copies.
- Every mutating cleanup backs up all affected locations first. A failure after mutation begins attempts to restore Library and every affected location independently; one failed restore MUST NOT prevent later paths from being restored. The error distinguishes a completed rollback from an incomplete rollback, and the renderer rescans disk before presenting the remaining group state.
- Cleanup MUST leave every Profile resource reference byte-for-byte unchanged. A later Apply independently decides whether a Skill is installed, omitted, disabled, reviewed for replacement, or kept outside for that Target.
- After successful cleanup, selected Target-specific copies rescan as current and `Managed`; the group MUST NOT retain a duplicate or pending action.
- AgentEnv ownership is attached to the physical managed installation. A shared compatibility path scanned by multiple Targets MUST appear as one managed location rather than a duplicate caused by Target-specific scanning.
- A physical location scanned by multiple Target adapters MUST appear once instead of presenting the Target names as separate copies. It is labelled `Shared` only when no adapter declares that path as its own non-shared runtime; a preferred or alternate Target runtime takes precedence over another adapter's compatibility declaration, and its owning Target is the primary location owner.
- One confirmed cleanup MUST include every reviewed physical location in the group. A successful rescan MUST NOT leave a conflict or duplicate that requires the user to repeat the same cleanup for the remaining Target paths.

Shared compatibility migration contract:

- A shared Skill not yet in Library follows the same `Add to Library` intent as every other local Skill. One content version is eligible for the confirmed `Clean up N` plan; multiple different content hashes remain in `Needs your decision`, show the number of different versions in the row, and add version choice inside `Add to Library`.
- Adding a shared Skill to Library is one transaction: back up all copies, create the Library canonical copy, keep exactly one shared compatibility copy active, and remove redundant Target-specific copies. The shared copy MUST NOT receive a Target ownership marker.
- Once Library is ready, Cleanup shows the compact `Shared` badge and states that consumer Targets still load the compatibility copy independently of Profile references. This is a managed compatibility state, not a content decision, so it belongs in the collapsed `Managed` section. `Review shared copy` presents the two valid outcomes in one workflow: open Profiles so each affected Target can receive its intended Profile, or `Keep shared copy`. A Profile that omits the Skill is a valid explicit decision to remove it for that Target. Cleanup MUST NOT show per-Target `Needs Apply` chips, expose internal preparation or migration phases as commands, or pretend Profile Apply is a Cleanup step.
- An installed Target that still reads the compatibility location remains a consumer even when AgentEnv does not manage its Profile. AgentEnv MUST preserve the shared copy and block replacement until that Target records an explicit applied decision. A successfully applied Skills-only Profile is a valid decision because it records install-or-omit intent while leaving Instructions and MCPs unmanaged; merely opening Agent detail, capturing, or saving that Profile is not. `Keep shared copy` remains the non-takeover outcome.
- After every affected Target has an explicit current decision for the current Library ID and exact current shared-path set, the row moves to `Ready to clean up` and shows `Ready` / `Replace shared copy`; either the dedicated confirmation or the reviewed `Clean up N` batch may cross the mutation boundary. A preparation for an older or different shared copy is stale, does not count toward readiness, and directs the user to Apply that Target's saved Profile again.
- Profiles independently save and apply each Target's install-or-omit decision. Apply Preview describes the final outcome as `After cleanup: install as <name>` or `After cleanup: remove from this Target`; it MUST NOT expose preparation records or migration decisions. Preparation MUST leave the shared path active and MUST NOT create a same-name Target-specific duplicate.
- `Replace shared copy` requires confirmation that lists each prepared Target's final `Install as <name>` or `Do not install` decision. It executes one cross-Target transaction: back up all shared, destination, and state paths; remove the shared source; deploy or omit per prepared Profile; verify every destination; then clear preparations. Any failed step restores all paths and states.
- Cleanup history exposes the completed `Shared copy replacement` as one restorable operation. Restore returns shared paths, Target paths, and preparation state to their pre-replacement state.
- `Keep shared copy` records a path-scoped decision and resolves the group without changing files. While that decision is active, Apply uses the shared compatibility copy as a local exception and MUST NOT install a duplicate Target-specific copy. `Review again` removes only that decision.
- Shared compatibility groups MUST NOT be flattened through generic Target-copy cleanup. An unimported group with one content version MAY participate in the same confirmed `Clean up N` workflow through the dedicated shared-compatibility transaction, which preserves one active shared copy, creates the Library canonical copy, removes redundant Target-specific copies, and backs up every changed path. Imported shared copies that still require Profile decisions remain outside bulk cleanup.
- Details group physical copies by full content hash and list unavailable symbolic links separately, so the user chooses between actual content versions rather than paths that happen to contain the same files.

Cleanup review contract:

- If the Skill is not yet in Library, the user chooses the local version whose content will be preserved as the Library source of truth.
- The chosen source location is always included in the cleanup and cannot be deselected accidentally.
- If the Skill already exists in Library, `Review differences` first asks whether to keep the current Library version or use a reviewed local version. Local version selection appears only after the latter choice. Replacing Library content backs up the previous canonical copy and changes its provenance to local/untracked.
- Every truncated Skill name, description, path, and history detail in the cleanup workflow exposes its full value on pointer hover and keyboard focus. The detail layer remains open while the pointer moves into it, and its text is selectable so paths and errors can be copied directly.
- Cleanup identity and compact cleanup state occupy explicit non-overlapping regions. Identity, description, path, and state detail may expose selectable overflow detail; the visible status badge itself never truncates.
- Cleanup groups and Cleanup history use the same main-content/action-column hierarchy and control scale. History does not add a redundant `Backup` badge when its section and metadata already establish that scope.
- Cleanup history is a secondary group inside the Local Skill Cleanup surface, not a separate framed panel.

Path policy and evidence contract:

- `Keep outside AgentEnv` is a machine-local decision attached to one concrete Skill path and, for Target-specific paths, one Target. It never becomes a portable Profile property.
- Kept paths remain visible in Local Cleanup and Agent inspection. `Review again` removes only the matching path policy.
- A group with kept and active locations is classified by its active locations; one kept copy MUST NOT hide actionable copies elsewhere.
- `Keep outside AgentEnv` grants no ownership and makes no filesystem change. Apply excludes that path from its managed payload and discloses the local exception instead of repeatedly blocking.
- Shared compatibility retention uses the same path-policy store with `keep-shared`; it remains coordinated across every consuming Agent.
- Skills CLI locks, symlink destinations, plugin manifests, and adapter metadata are `External evidence`. Evidence may improve provenance and diagnostics but MUST NOT independently classify a writable Target destination as unavailable for takeover.
- Path capability is authoritative: writable Target-owned slots may be reviewed and taken over; a Target root symlink may be replaced only at the root boundary; shared compatibility paths use Local Cleanup; observe-only plugin or alternate containers are never mutated.
- Missing, unreadable, or malformed native inventory produces a warning and skips only that evidence source. It MUST NOT suppress ordinary user Skill roots or block unrelated Capture, Save, or Apply.
- Directory symlinks and broken tracked symlinks remain visible. Import copies readable content to Library and leaves the source path and evidence unchanged.
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
- Skill content identity uses a versioned, framed hash over entry type, normalized relative path, content length, and content. AgentEnv metadata files are excluded. Hash-format upgrades rehash Library metadata, existing managed Skill snapshots, applied Library versions, and Capture receipts before normal operation so an upgrade cannot create false Target drift. A malformed Target state or optional Capture receipt is retained byte-for-byte, recorded in startup diagnostics, and skipped without blocking healthy neighbors; a real read, permission, or atomic-write failure still fails startup closed. Ownership sidecars are backup and verification metadata, never managed Skill resources. Legacy state entries that misclassified `*.agentenv-owner.json` as a Skill are removed during the hash upgrade without changing or deleting the sidecar file.
- Update Preview MUST derive impact from persisted Profiles and observed managed installs. It names referencing Profiles and distinguishes live links from copied installs.
- Applying a Library update changes canonical content only after Preview, Backup, validation, and atomic replacement. A check never modifies Library. Live links follow canonical content naturally; current AgentEnv-managed copies are refreshed in the same backup transaction.
- The update transaction also advances each affected Target's applied Library version and managed-resource content hash. Completion requires the Library, every clean copied install, and every affected Target state file to verify; failure restores all three layers.
- A managed copy whose content no longer matches the pre-update Library baseline is drift and blocks the Library update until reviewed. Paths kept outside AgentEnv and observe-only locations never participate in propagation.
- A Repository update never rewrites Profile intent. Related Profile references continue to resolve the current canonical Library version.
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

Status: local, read-only Project, recursive GitHub, and System Git Repository import/update; in-place Refresh; per-Skill update policy; YAML frontmatter runtime identity; direct and recursive Agent scanning; read-only Skills CLI and Claude plugin evidence detection with malformed-inventory isolation; independent copy import; scan; cleanup; path policies; icon metadata; duplicate runtime-name blocking; reference blocking; managed-install removal; and undo are `Implemented`.

## 17. Native MCP Contract

- Each Agent is the source of truth for MCP definitions, installation, sign-in, authentication, and credentials.
- AgentEnv discovers only user/global MCP names, activation state, transport hint, source path, and control capability. Project, plugin, workspace, and policy-managed MCPs MAY be observed but MUST NOT be adopted or mutated.
- Discovery MUST include credential-bearing definitions such as `computer-use` and `node_repl`; secret values MUST NOT enter Profile data, renderer payloads, logs, or diagnostics.
- A Profile stores a policy per Target. `Not managed` opts that Target entirely out of MCP management. Managed mode stores sparse three-state rows: an absent row is shown as `Agent setting` and performs no mutation, while explicit `On` and `Off` choices update only a verified native activation field. Turning management on MUST NOT synthesize overrides for discovered MCPs; returning a row to `Agent setting` removes its saved selection.
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
- Blank Profile creation MUST start with empty Instructions, Skills, and MCP policy. Native Agent resources are discovery candidates only and MUST NOT be adopted until the user explicitly adds an override; only Create from Target may intentionally capture the current environment.
- Create from Target defaults the Profile name to the Agent display name. The default MUST NOT add transient state words such as `Current`; users may edit the name before saving.
- A Target-row capture command MUST keep the invoking Targets workspace visible until the user confirms. Cancel and Escape return focus to that exact command without changing workspace.
- Every installed Target presents `Manage Skills` as the stable primary action. An
  unmanaged Target runs the guided Capture-to-Apply path; a managed Target opens the
  active Profile's contextual Skill surface. `Create Profile from Agent`, `Open Profile`,
  Diagnostics, and Recovery remain secondary or advanced commands.
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
- Readable Skills, including paths with external provenance evidence or a machine-local keep-outside policy, MAY be imported or reused and included in the portable Profile. Capture review names the local exception or evidence, while Save leaves every source path unchanged.
- A broken or unreadable discovered Skill link is unavailable rather than capturable. Capture MUST continue for other resources, show the unavailable Skill before Save as an excluded warning with its source path and reason, omit it from both Library and Profile, and leave the source link byte-for-byte untouched. Fixing the source and capturing again is the only path that can include it.
- An existing writable Target copy that exactly matches Library content is adopted during reviewed Apply. Different content is a reviewed backup-and-replace decision; a keep-outside policy preserves it as a local exception.
- Duplicate active runtime copies with identical content MAY be represented by one Library reference, but every source copy remains unchanged. Same-name copies with different content block capture because the canonical content is ambiguous.
- When a captured Skill has identical shared-compatibility and Agent-private copies, the first takeover Apply MAY replace only the matching private copy with an AgentEnv-managed deployment. The shared copy remains untouched until the separate reviewed cleanup workflow. Changed private content requires explicit replacement review; keep-outside and observe-only paths remain unchanged.
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
- Skill source work is scoped by command: `Check updates`, one Skill's `Review update`, bulk `Review updates`, one source check, and `Check monitored` never borrow each other's spinner. The active command state survives workspace navigation and restores on return until the operation completes.
- Cross-page or background operations use the shared global feedback region.
- Workspace-owned completion feedback remains scoped to its originating workspace and disappears when the user navigates away. When a command intentionally navigates to the object it created, that result workspace inherits the completion feedback. Errors remain globally visible because they may require recovery outside the origin surface.
- Success feedback expires after approximately five seconds.
- Errors persist until dismissed or resolved.
- A newer warning or error replaces stale success feedback.
- Completion updates visible persisted state, not only a message.
- No visible command may appear to do nothing.
- Profile edits update the in-memory draft without filesystem scans. Save, Preview, and Apply each expose control-local working state for their complete asynchronous lifetime.
- Profile dirty state stays attached to the Profile row, readiness line, and Save/Apply command group. It MUST NOT create a persistent or transient global feedback layer that duplicates those states or covers Composer content.
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
- The desktop window appears before service initialization completes. Initialization failure remains inside a recovery screen that classifies newer data, invalid data, permissions, interrupted recovery, and unknown failures. It offers Retry, Open data folder, Export redacted diagnostics, and Quit; it never resets or deletes local data automatically. Recovery labels follow `en`, `zh_CN`, and `zh_TW`; each support action owns visible progress and local failure feedback. A late initial status response MUST NOT overwrite a newer startup event, and Retry confirms the final status even if an event is missed.
- Startup diagnostics are size-bounded and rotated. Home paths and credential-shaped values are redacted, and Skill contents, MCP payloads, and secrets MUST NOT be logged.
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
- Interface typography uses four semantic weights only: regular `400` for body, controls, routine navigation, status, and metadata; medium `500` for repeated-row identity anchors, section and preference labels, decision-group headings, and the current navigation item; semibold `600` only for dialog titles, the selected primary object, and the brand; and heading `650` for first-level page titles. Native `strong` and `b` elements inherit by default because semantic markup does not grant visual emphasis to layout values. Each repeated row or compact decision group MUST expose one medium-or-stronger scanning anchor, while descriptions, paths, counts, sources, versions, timestamps, routine statuses, badges, and ordinary buttons remain regular. Interface CSS MUST NOT use weights above `650`, and the product-wide semibold declaration budget is enforced by the style audit.
- Reusable resources use one reading order: `identity -> metadata -> lifecycle state -> contextual actions`. Identity includes a fixed compact icon slot defined by its shared row primitive, name, and at most one visible supporting line; longer content remains available through the selectable overflow tooltip. Skill and Profile list icons are optically centered, transparent at rest, and gain one even hover/focus surface without changing either axis.
- Standard resource rows use the shared `52px`, `60px`, or `68px` density tokens. A page MAY choose a denser table only when comparison across named columns is the primary task, as in Skills Library.
- A lifecycle state owns a stable lane and MUST NOT move into the action lane when another value is absent. State labels MUST fit without ellipsis; long explanations belong in a tooltip or focused review surface.
- Repeated rows implemented as independent Grid or Flex containers MUST reserve the same fixed state and action tracks. Content-sized `auto` tracks MUST NOT make status text change its horizontal origin between sibling rows; a missing secondary line keeps the same top-aligned state slot.
- Resource rows expose at most one direct contextual command plus a trailing overflow menu. Destructive, settings, and infrequent commands belong in that menu. Inline icon commands use shared `32px` hit targets and always have accessible names and tooltips.
- Skill Library and Profile list rows expose their existing overflow command set through the same compact renderer action menu used by the trailing ellipsis. Right-click MUST target the row under the pointer without inventing commands, changing availability, bypassing dirty-state or destructive confirmation, or silently applying the command to the selected row. The shared menu owns viewport clamping, Escape and outside-click dismissal, initial focus, Arrow/Home/End navigation, focus return, icon lanes, and danger treatment. The same keyboard contract applies to Profile actions, Agent selection, cleanup actions, and icon selection menus.
- Accent fill identifies only the current page-level primary command or the next commit action. Lists MUST NOT contain repeated primary-filled actions unless each row is an independent queued workflow.
- A populated Profiles workspace keeps `New Profile` neutral because Save or Apply owns the commit emphasis; an empty Profiles workspace MAY promote `New Profile` to the primary action. Available Skill updates use a neutral compact review action, while the update confirmation dialog owns the filled commit action.
- The Library page uses `Skills` as its interactive page title; `Library` is neutral scope text and MUST NOT resemble a clickable breadcrumb.
- Skills Library uses one stable five-lane reading order at every supported width: `Skill -> Source -> Usage -> Status -> Actions`. Source includes version metadata, Usage combines Profile references with Agent installs, and Status exposes only the highest-priority current maintenance action while retaining complete details in selectable overflow help.
- Skill-list quick tabs are limited to `Enabled`, `Updates`, and `Disabled`. `Enabled` is the default and excludes globally disabled Skills; Source, Usage, and Agent-install filters live in one on-demand filter region, while `Review updates` is rendered only when one or more updates can actually be reviewed. Source-view quick tabs are limited to `Monitored`, `Manual only`, and `All`, with `Monitored` as the default. Applying reviewed candidates remains a distinct confirmation command inside the dialog.
- Disabled Skills remain readable and use one neutral row treatment plus the explicit `Disabled` status. They MUST NOT accumulate decorative grayscale, inset rules, badges, and opacity effects, and they are excluded from Enabled, Updates, and non-All Usage filters.
- Every Profile Composer resource row owns its Target-specific management switch beside the row summary. Its visible label remains the invariant command `Manage`; on/off state is conveyed by the switch, `aria-checked`, and focused help rather than a variable-width `Managed` / `Not managed` label. The control lane has stable geometry, remains visible while collapsed, MUST NOT expand the editor when clicked, and MUST NOT be duplicated inside the expanded panel. Unsupported categories show `Agent controlled` in the same stable control lane.
- Counts and saved summaries describe the Profile recipe and MUST remain visible when a category is not managed for the selected Target. Composer rows show `enabled / total` for resources explicitly retained by the Profile. Discovered Agent MCPs that remain on `Agent setting` are candidates, not Profile resources, and MUST NOT contribute to either MCP count. The management state is not represented by replacing the count with zero.
- Profile MCP rows use `name -> native source/status -> activation choice`. Definition editing and deletion are intentionally absent because those actions belong to the source Agent. The expanded editor uses compact content-sized rows and labels the sparse no-op state `Agent setting`.
- Profile Composer resource triggers remain `52px` high before, during, and after expansion. Expanding one resource MUST NOT compress, hide metadata from, or reposition its sibling triggers. The expanded trigger and editor surface MUST be visually distinguishable from ordinary collapsed rows without turning the editor into a nested card.
- Profile Skills with zero or one item fit their content without stretching empty list space. Larger collections grow only within the available editor region and keep the Skill list as the scroll owner.
- Agents use one continuous ordered management list at every supported width, with ordinary healthy state rendered as quiet metadata rather than a filled badge or separate card. Agent identity, health, management state, active Profile, last-applied time, and actions own stable sibling lanes. Every Capture, Profile, and Diagnostics control uses the shared control primitives and identical geometry across all Agent rows, regardless of Agent name, lifecycle state, or action label. Diagnostics expands to the full width of its owning Agent, shifts only later rows, leaves no peer-column void, and opening a second Diagnostics region closes the first.
- The Agent name and `Manage Skills` command open the same Agent Skills work surface. The name is visibly interactive without changing its identity lane geometry or duplicating the command's accessible name.
- Settings renders ordinary preferences as stable `name and explanation -> control` rows. Labels are never detached into a separate alignment scheme, and toggles, selects, read-only values, and numeric inputs share one right-hand control lane.
- Settings MAY override one configuration root per Agent. The Adapter remains the sole owner of deriving Instructions, Skills, and native configuration paths below that root. Selecting a root performs no migration, does not move existing files, and performs no Agent write. All later reads and writes use the same resolved paths. An Agent with retained AgentEnv ownership state MUST be stopped before its root can change even when that Agent is disabled and hidden from ordinary active-state lists. Full custom paths use the shared selectable overflow-detail behavior, and Choose, Change, and Use default show progress on their owning row.
- Truncated values and contextual explanations use one shared hover-detail primitive. Plain text opens detail only when it is measurably clipped; short fitting text MUST NOT create a hover surface. Complete text remains selectable and pointer-enterable, uses regular body weight and neutral overlay styling, stays inside the viewport with bounded scrolling, closes on Escape or owning-list scroll, and never relies on a browser `title` as the only readable copy. Wheel input at a detail layer's scroll boundary continues scrolling the nearest owning list rather than making the interface appear frozen.
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
- Visible command, tab, status, badge, and count labels MUST fit their owning control in every supported locale. They MUST NOT use clipped overflow or ellipsis to conceal a sizing defect; shorten the visible label or change the owning layout while preserving the full accessible command name.
- When a responsive table hides its shared column header, every remaining compact field MUST retain a visible semantic label. Raw revisions, dates, source values, and Library identities MUST NOT become unlabeled values merely to fit the minimum viewport.
- Ellipsis is reserved for variable content such as names, descriptions, revisions, and paths. Every such truncation MUST declare the shared hover-detail contract so the complete selectable value remains available; generic `overflow: hidden` is not accepted as evidence of containment.
- Shared Electron geometry tests MUST scan visible controls, statuses, and clipped text across all first-level workspaces, the minimum and default viewports, supported locales, and Ready, Review, and Blocked Apply states. Document-level containment alone is insufficient.
- Text line boxes, icon boxes, and control padding MUST fit inside their controls without vertical clipping.
- A framed work surface has one edge owner painted above its scrolling children. Toolbars, rows, backgrounds, and scroll regions MUST stay inside that edge and MUST NOT redraw, cover, or visually interrupt any side or corner.
- Composite icon-and-input controls draw one border on the parent control. Their transparent borderless input remains inside the parent's content box and MUST NOT cover the parent edge at any supported width.
- Apply Preview keeps its header and footer stable. One modal body owns vertical scrolling; semantic resource groups never create another vertical scroll region, and long diff content owns only its code overflow.
- Create from Target keeps its step header and action footer visible at both supported viewports. Only the dialog body scrolls; resource groups MUST NOT introduce a second nested scroll region.
- Menus, tooltips, and dialogs remain above rows and inside the visible viewport.
- Context menus use one surface, `220px` width, shared item height, icon alignment, and danger treatment. Selection grids such as icon pickers are the only intentional menu-layout exception.
- Focused dialogs use one stable header/body/footer anatomy. The header identifies the task, the body owns scrolling, and the footer keeps neutral cancellation beside one primary continuation or destructive confirmation.
- Dialog size follows task complexity rather than feature ownership: compact confirmations contain one decision, standard dialogs edit or select one resource, and wide review dialogs compare multiple resources or files. A sparse task MUST NOT inherit a wide review surface, while long content MUST NOT expand a dialog beyond the supported viewport.
- Dialog titles use sentence case and the shared title scale. Eyebrows, uppercase category labels, status chips, and duplicate explanations MUST NOT replace the task title; secondary identity or state remains supporting content.
- A structured dialog has exactly one ordinary vertical scroll owner between its fixed header and footer. Search, filters, notices, and selection controls stay with that body; nested scrolling is reserved for code or file content that has an independent reading axis.
- Every async dialog command keeps its control geometry stable, sets `aria-busy`, disables duplicate submission, and shows an animated local progress indicator. Navigating away and back MUST restore that operation state until it settles.
- Peer actions with equal consequence use the same neutral treatment. Accent fill is reserved for the current primary commit or flow-advance action; Target `Capture` and `Profiles` are neutral peers.
- Settings switches sit beside the setting label they control, with supporting copy on the following line; they MUST NOT float as visually detached controls at the far edge of a wide row.
- Hover/focus tooltips are mutually exclusive. Long-text tooltips allow pointer entry and native text selection for copying, then close after the pointer leaves both trigger and tooltip. Repeated passive overflow spans MUST NOT each add a Tab stop: an existing row command or identity action owns keyboard focus and its full accessible name, while standalone error or decision details MAY opt into focus explicitly.
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
- A saved GitHub token has separate credential and verification state. Local decryption failure or an explicit GitHub `401` invalid-credential response clears it. Offline state, timeout, rate limiting, malformed non-auth responses, and GitHub service failure retain the token and report `Signed in, verification unavailable`. Sign out removes only the token and pending Device Flow state; it MUST NOT alter Library content, source metadata, repository cache, or system Git credentials.
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
- A read-only Skill runtime driver declaring roots, scan depth, scope, runtime identity, native disable facts, and manager-related evidence markers.
- Native MCP discovery scope and safe activation capability.
- An exact allowlist for any MCP activation field the adapter may patch; no generic native-config payload is accepted.
- Preview generation.
- Managed-resource ownership markers.
- Backup path enumeration.
- Apply, drift, and rollback behavior.
- Cross-Target capability declarations.

Registration MUST occur in the Target registry. Renderer components MUST NOT require Target-specific branches for ordinary lifecycle behavior.

Target Skill drivers report facts only. They MUST NOT import Library content, mutate Profile state, deploy files, remove legacy paths, or create backups. The core owns Save, Preview, Backup, atomic Apply, post-write verification, and Rollback through one Agent-neutral operation model. Agent-specific behavior belongs behind the adapter; Agent-specific buttons and Target ID branches do not belong in the renderer.

Runtime snapshots are the single source for Skill discovery, runtime identity, availability, location role, and runtime issues. Library inventory MAY enrich those observations with Library relationships, path policies, content hashes, and manager-related evidence, but MUST NOT independently reinterpret Agent runtime behavior. Drivers only report broken links and unreadable manifests and never mutate them. Core Cleanup MAY classify an exact broken symbolic link as `Ready to clean up` only after path-capability and link-boundary verification; execution still requires the reviewed bulk confirmation and removes only the backed-up link itself. Unreadable real directories or manifests, observe-only links, and ambiguous paths remain review-only and MUST NOT enter automatic cleanup, replacement, or deletion plans.

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
keeps one definition or chooses `Unchanged`. MCP command, URL, headers, environment,
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

The first useful journey adapts to user complexity:

1. Detect installed Agents without blocking local Library access on background enrichment.
2. When no usable Profile exists, open Agents as the contextual starting point. If exactly one installed Agent exists, open its Skill detail directly; otherwise show the ordered Agent list.
3. Preserve that Agent's readable Skills into the canonical Library and an ordinary reusable Profile without changing the Agent.
4. Review and Apply the saved Profile through the standard Preview, ownership, Backup, verification, and rollback transaction.
5. Restore the last stable top-level workspace on later launches.

Local Skill Cleanup, By source maintenance, and full Profile composition remain available for advanced migration and reuse, but a user with one Agent MUST NOT be required to understand all three before preserving and managing that Agent's Skills. The product MAY use contextual empty states for this journey; it MUST NOT require a marketing-style onboarding page.

The Local Agents summary is contextual navigation, not decoration. Each visible Agent icon and each Agent inside the overflow list opens that Agent's Skill detail directly; its accessible name MUST describe the same destination.

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
- First launch with no usable Profile opens Agents; exactly one installed Agent opens its Skill detail directly, while later launches restore the last stable top-level workspace.
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
- A globally disabled Skill that remains active in a writable Target path is reconciled like any other absent Profile Skill: Preview offers reviewed backup-and-removal or `Keep outside AgentEnv`. Observe-only and already-kept paths remain unchanged. Global disable itself still performs no Target mutation.
- Disabling a referenced Library Skill in a Profile is a normal Profile edit: it preserves the reference, marks the whole Profile dirty, and MUST require the same Save, Preview, and Apply flow as adding or removing a Skill.
- Applying a disabled Profile Skill previews and removes only its managed Target copy; re-enabling previews and restores it. The switch MUST NOT write to a Target before Apply succeeds.
- Profile-scoped update Check excludes disabled and untracked references while a Library update discloses cross-Profile and Copy versus Live link impact.
- Missing executable and missing directory are distinguished.
- Copy mode keeps Library updates pending; Live link mode visibly propagates them immediately.
- Auto mode uses a Live link when supported, falls back to Copy only for an explicit unsupported-link error, and exposes permission, path, source, and storage failures without fallback. Changing mode does not mutate an existing install before fresh Preview and Apply.
- Create from Target captures portable resources, reuses exact Library matches, and leaves Target files and deployment state unchanged.
- Create from Target MUST retain AgentEnv-owned legacy Skills as migration inputs so the first Apply cannot remove a legacy copy without installing the captured Skill into its current runtime location.
- Kept-outside resources and unsupported native data remain unchanged after Create from Target.
- Applying the same Library Skill to OpenCode, Codex, Claude Code, Antigravity, and Trae CLI creates isolated Target-specific runtime copies.
- Create from Target followed by first Apply isolates a Target Skills root that aliases a shared directory, preserves the shared destination byte-for-byte, installs Target-owned child references, and restores the original root link through Rollback.
- Create from Target followed by first Apply adopts an exact Agent-private duplicate transactionally even when an identical shared compatibility copy remains active; Rollback restores the original unowned private copy and shared content byte-for-byte.
- The machine-local Capture receipt is consumed after that first successful Apply. Missing, malformed, stale, or content-mismatched evidence never expands replacement authority.
- Any Skill inventory fact used by Preview changing before Apply invalidates the whole deployment plan. An approved outside copy is checked against its Preview content hash again inside the Adapter immediately before replacement.
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
- Project discovery scans configured roots read-only, deduplicates overlapping roots, isolates invalid candidates, preserves source files, and routes selected imports through the ordinary Library Preview flow.
- GitHub direct-Skill, containing-directory, and repository scan; candidate selection; partial import; rate limit; sign-in remediation; update check; Preview; and update.
- GitHub Device Flow pending, focus return, `slow_down`, expiry, denial, and successful account-state refresh without overlapping network polls.
- GitHub status clears a stored token after decryption failure or `401`, retains it through offline, timeout, rate-limit, and service failures, and keeps Sign out independent from Library and source state.
- System Git repository, directory, and direct-Skill scan; HTTPS/SSH/local transport; ref selection; partial import; cancellation; subtree update detection; Preview; backup; cache rebuild; credential redaction; and packaged-app Git discovery.
- Local and GitHub per-Skill update policies, legacy defaults, disabled-source isolation, and persistence.
- Library global disable persistence, update-check exclusion, Add Skill picker filtering, existing-reference visibility, and Apply-time managed-copy removal.
- In-place toolbar and `Cmd/Ctrl+R` Refresh preserve current Skill view state and do not contact update sources.
- Global Quick Open searches and opens Profiles, Skills, Agents, workspaces, and safe navigation actions; Arrow/Home/End selection remains visible and respects ordinary dirty-state and confirmation boundaries.
- Skill source-default and custom icons persist across refresh and content update; Profile icon changes auto-save independently without clearing or committing a dirty environment draft.
- Skills CLI v3 lock detection, corrupt and unsupported lock fallback, directory and broken symlink discovery, independent import, evidence preservation, and path-capability Apply review.
- Update marks affected deployments pending without deploying.
- Duplicate, conflict, kept-outside, linked, copied, and stale-copy states.
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

- Empty, one-item, long-content, 50, 100, and 500-item cases where relevant.
- Default and minimum viewport without document overflow.
- Skill table headers and every data row MUST share one column contract; contextual actions MUST NOT resize preceding columns. Compact width uses a visible grouped header and retains Skill, source, version, Profile usage, update, install, and action information rather than hiding columns.
- Version, update, usage, and install metadata MUST use aligned first- and second-line tracks, including empty states and truncated values.
- The Profile Target selector uses the selected Target name as its visible label without a redundant `Target:` prefix; its accessible name retains the full command meaning.
- First and last row menus are topmost and in viewport.
- Escape, outside click, keyboard focus, focus restoration, and Arrow/Home/End navigation for renderer action menus.
- Working, success, warning, error, no-op, drift, destructive, and recovery states are inspected visually.
- Profile Skill toggles respond from the in-memory draft without a data reload; Save immediately shows working feedback and enables Apply after persistence; Preview immediately shows working feedback and opens without duplicate inventory scans.
- System locale detection, explicit `en`/`zh_CN`/`zh_TW` switching, persisted reload, and unsupported-locale fallback.
- Default and minimum viewport containment in all supported interface languages, including long Traditional Chinese labels.
- Profile switching at the minimum viewport preserves editor geometry through loading and never exposes a false empty state.

E2E assertions MUST verify persisted files and state, not only successful clicks.

### 24.1 Contract Coverage Matrix

This matrix is the release-facing index. A capability may be `Implemented` only when its persisted effect and failure path have automated evidence; detailed clauses above remain authoritative.

| Capability | Status | Persisted effect and recovery evidence | Required automated layer |
| --- | --- | --- | --- |
| Whole-Profile Save and dirty navigation | `Implemented` | Atomic Profile replacement; draft never writes an Agent | Domain, renderer, Electron E2E |
| Preview, Apply, no-op, stale, drift, rollback | `Implemented` | Bound plan, Backup, verification, compensating restore | Domain, cross-adapter integration, Electron E2E |
| Apply issue policy | `Implemented` | Stable code maps to one disposition and recovery; contract table is test-verified | Contract-policy and domain tests |
| Skill import, duplicate review, update, disable, delete | `Implemented` | Canonical Library transaction and History/Backup where destructive | Domain, renderer, Electron E2E |
| Local Skill Cleanup and shared migration | `Implemented` | Reviewed filesystem normalization; source evidence and kept-path policies preserved | Domain, fake-home E2E |
| Native MCP sparse activation | `Implemented` | Managed activation fields only; definitions and credentials preserved | Adapter matrix and fake-home E2E |
| Conversation search and cross-Agent continuation | `Implemented` | Read-only source histories, disposable cache, reviewed redaction/size fallback, private handoff artifacts | Adapter, service, renderer, and Electron E2E |
| Workspace Sync | `Implemented` | Candidate Connect, three-way plan, transactional Update, guarded Publish, recovery | Domain, two-device Git integration, Electron E2E |
| GitHub account state | `Implemented` | Secure token; invalid credentials clear; transient verification failure preserves | Service and renderer tests |
| Legacy shared-Library storage migration | `Partial` | Atomic destination replacement, source preservation, conflict retention, report | Unit complete; production-shaped packaged startup required |
| Data Export and Restore | `Implemented` | Validated export, recovery copy, atomic app-data replacement | Domain and packaged restart smoke |
| Desktop geometry and interaction | `Implemented` | No persisted effect; native window, focus, overlay, scroll, and viewport contracts | Renderer geometry and Electron screenshots |
| Signed and notarized macOS release | `Required` | Distribution trust only; no product-data mutation | Clean-Mac packaged smoke after credentials exist |

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

The current machine-readable totals, source commit, deterministic tracked-and-untracked source fingerprint, dirty state, viewport list, capture count, audit results, and packaged-smoke status are generated by `npm run verify:product` in [`verification-snapshot.json`](verification-snapshot.json). The fingerprint excludes the generated snapshot itself, so evidence produced from an uncommitted review candidate remains bound to the exact files that were exercised. Every Electron E2E and screenshot fixture uses an isolated Chromium user-data directory, so persisted UI preferences remain production behavior without leaking between evidence runs or into the developer's real app state. Run `npm run verify:product -- --packaged` for a release candidate so the same snapshot also records the packaged workflow.

- The automated suite covers preferred-Target and cross-Target use, Create from Target, real Electron UI, progressive startup, localization persistence and completeness, stable Profile loading, scoped feedback, stale Preview, rollback, recovery, MCP ownership release, and externally replaced managed-Skill recovery scenarios.
- The CSS architecture gate passed with named container-query contracts, no numeric `z-index` declarations, and no `!important` outside the reduced-motion contract.
- Fixed-state visual captures are regenerated through the Electron compositor at the supported default and minimum viewports, including the stable Profile loading state, sidebar Agent overflow, managed and unmanaged Agent Skill detail, Profile icon selection, Profile Skill selection and applied revisions, native MCP Profile states, available-update rows, disabled, empty, Chinese Skills, Profiles, and Settings, source-specific Import, shared-Skill management guidance, Agent Diagnostics, and focused update-setting states.
- Skills, Profiles, Agents, and Settings passed shared chrome and control-geometry checks at `1180 x 728` and `920 x 620` without document overflow.
- The macOS inset hidden title bar, native-control safe area, full-width draggable top chrome, draggable page headings, and no-drag interactive controls passed main-process configuration and real Electron geometry assertions.
- Shared page headers, vertically centered navigation rows, uninterrupted work-surface edges, contained composite search fields, `32px` resource identities, compact/default row heights, Profile commit controls, MCP rows, Cleanup state/action lanes, `220px` context menus, and Apply resource rows passed cross-workspace geometry and overflow assertions.
- Dirty Profile navigation passed persisted Save, Discard, and Cancel outcomes; Stop Managing passed persisted file-retention and ownership-detachment checks.
- System-picker data backup and restore, pre-takeover restoration, read-only and missing Targets, missing Skill sources, offline and rate-limited GitHub checks, and partial bulk updates passed Electron E2E coverage.
- First-row and floating layers, modal Escape, outside click, focus trapping, focus restoration, and renderer-menu Arrow/Home/End navigation passed Electron E2E coverage.
- Target-row capture preserves the Targets workspace until confirmation; setup, Back, local failure recovery, grouped capture review, and a 30-resource minimum-viewport stress case keep the action footer visible with one scrolling body.
- Library deletion isolates the selected Skill from invalid neighboring content, and global feedback provides a non-blocking copy action.
- Local imports remain usable after their original path is removed; per-Skill update-check defaults, opt-out persistence, and GitHub re-enable flows passed Store and Electron E2E coverage.
- In-place Skill Refresh, sequential GitHub directory import with per-item progress and partial failure, source-default Skill icons, custom Skill icon persistence, and independently auto-saved Profile identity metadata passed Store, renderer, and Electron E2E coverage.
- Skill Import source modes, compact row command menus, focused update settings, compact MCP rows, overflow-only MCP deletion, resource-first Apply Preview, and neutral Capture outcomes passed renderer, Electron E2E, and visual capture coverage.
- Library Skill disable, picker exclusion, update-check isolation, re-enable, and Apply-time Target removal and restoration passed Store, renderer, and Electron E2E coverage; Profile Skill switches use the same Save and Apply contract as Add and Remove.
- Skill table headers, compact grouped headers, retained version metadata, mixed-action rows, aligned metadata, empty install states, update labels, action-to-detail clearance, compact non-truncating Cleanup badges, equal-width Cleanup actions, and status-tooltip clearance passed coordinate, overlap, and overflow assertions at both supported viewports.
- Target-local import now creates an independent Library copy without changing the source path; shared managed paths deduplicate across Target scans, and auto-ready cleanup groups pass single, bulk, conflict-exclusion, persistence, backup, and responsive-layout coverage.
- Codex Capture now reuses identical Library Skills and previews a stable alternate ID for different same-name content instead of failing during Save. Same-name writable OpenCode and Claude Code destinations become explicit Preview review items and pass Backup, atomic replacement, ownership, and recovery assertions; Skills CLI and plugin metadata remain read-only evidence.
- Local Skill cleanup distinguishes Library-managed, outside, kept, and conflict states; consolidation remains transactional, preserves backup history, and never treats a cleanup choice as a Profile Apply omission.
- Native MCP discovery includes all configured names without copying credential values. OpenCode, Codex, and Trae CLI Apply change only native activation fields, preserve definitions added outside AgentEnv, block an enabled missing definition, treat a disabled missing definition as a no-op, and produce a real no-op when states already match. Trae CLI additionally blocks ambiguous same-name definitions across its user files.
- Claude Code and Antigravity expose Agent-owned MCPs read-only. Antigravity CLI requires `agy`, applies and rolls back `GEMINI.md` and dedicated CLI Skills, transactionally migrates AgentEnv-owned legacy Skill copies, and leaves `mcp_config.json` unchanged.
- All five built-in adapters expose the same read-only Skill runtime contract. Tests cover direct and recursive discovery, symlink-cycle safety, frontmatter runtime identity, duplicate declarations, Claude plugin ownership, duplicate desired runtime names, Antigravity legacy migration with rollback, and Trae CLI primary and alias runtime locations. Profile Skill On/Off is represented only by managed install presence, never by an Agent configuration switch.
- GitHub Device Flow respects server polling intervals, absorbs `slow_down` as a longer pending interval, blocks overlapping token requests, and refreshes connected account state after browser authorization.
- Apply Preview puts readiness or blocking state first, separates final payload from actual mutations, groups changes by resource meaning, keeps full paths in selectable detail, and opens each file diff on its owning row without widening the dialog. Replaceable drift is shown once as an explicit review requirement.
- Profile list icon and content columns remain aligned at the minimum viewport, and a deliberately long truncated Profile name keeps the same text origin before and after selection.
- JSON/JSONC, TOML, YAML, assignment-style, token-prefix, and private-key detection reject new literal credentials; legacy Preview before/after/diff payloads are redacted before reaching the renderer.
- Drift recovery adopts compatible Instructions and existing managed MCP activation choices into a backed-up Profile while naming excluded native configuration and unmapped items.
- Production dependency audit reported zero known vulnerabilities.
- The packaged arm64 macOS application completed an isolated OpenCode Profile takeover at `1180 x 728` without document overflow or writes to the real Agent environment.
- The signed release entry point requires a Developer ID Application identity and Apple notarization credentials, then verifies `codesign`, Gatekeeper assessment, and the stapled DMG. Signed and notarized artifact verification remains outstanding until those external credentials are available; the local packaged primary-workflow smoke uses an unsigned `.app`.

## 26. Current Priority Gaps

1. Validate both the one-time v1-to-v2 migration and legacy shared-Library storage migration against an anonymized production-shaped data export and a packaged startup.
2. Extend the conditional duplicate review with more uncommon intentionally distinct same-name Skill fixtures.
3. Sign and notarize macOS distribution, then repeat packaged primary-workflow verification on a clean Mac.
