# Scoped resource operations

## Change Evidence Card

Core job -> let users manage their selected local resources safely -> removing all
checks would permit overwrites and dangling references -> remove unrelated
prerequisites, not ownership, current-content, dependency or recovery protections.

User intent -> inspect/update a Skill, remove an old backup, change an independent
resource, delete/restore one conversation, detach an Agent, or remove a referenced
Skill -> validate only relevant authority -> persist and verify the exact effects
-> keep existing transaction backups and non-overwriting recovery.

Operation risk 9/10; frequency 6/10; density 8/10; expression 3/10; motion 2/10.
Avoid global scans as per-item prerequisites, false zero counts for missing
information, silent Live link effects, forced overwrite, skipping recovery, and
new page-specific controls. Local-first Electron; existing sidebar/workspace shell,
920/1180/1440 sizes and en/zh_CN/zh_TW remain unchanged.

## Ordered Scope

1. Skill update Diff does not require a successful whole-Profile impact scan.
   Impact enrichment is read-only and bounded, with unknown/partial state visible;
   actual update still freshly verifies deployed links/copies and rollback data.
2. Backup preview/delete does not calculate all payload sizes. Protection reads
   remain mandatory where they establish sole-recovery ownership; unrelated
   backup families and optional size reads cannot veto an independent operation.
3. Recovery gates use verified affected paths. Source-merge recovery gains the
   same scoping as cleanup; scoped commands supply actual paths. Unknown affected
   resources remain protected. Unrelated local preferences stay usable.
4. Conversation deletion locates the selected session and associated files rather
   than requiring a healthy complete source scan twice. Exact identity, stable
   content, backup and non-overwrite checks stay. Restore returns before indexing.
5. Keep-files detach backs up/writes only actual changes. Plain copied resources
   without legacy markers need no content rewrite; Live links still materialize
   safely. Pre-takeover restoration keeps its stronger recovery contract.
6. Skill removal previews affected Profiles, manual Groups and deployed copies;
   one explicit confirmation removes selected references and the Skill as one
   recoverable transaction. Damaged/unknown references are not silently discarded.

## Reuse And Evidence

Keep SkillUpdateDialog/BulkSkillUpdateDialog, Notice, Switch, DiagnosticMessage,
ModalFrame, DialogHeader/DialogFooter, Button, ResourceRow, and the existing Skill
removal dialog. Feature code does not introduce parallel control CSS. Add pending,
partial, stale, failure and cancellation tests at owner boundaries; preserve the
current desktop artifact fingerprint and visual thresholds. Native fixtures use
isolated homes and mock resources, never user data or paid AI calls.

## Completion Receipt

- Current Electron source fingerprint: `89dc5bb5f4b4` (672 build inputs).
  TypeScript, production build and `assert-current-build.mjs` passed.
- Full non-Electron regression: 341 files / 2,773 tests passed, zero failures or
  skipped tests. New native tests are registered in the isolated Electron pool;
  no existing test or coverage category was removed.
- Focused current-build Electron regression: 7 cases passed. These cover referenced
  Skill removal, stale confirmation with an inline diagnostic and working copy
  button, complete removal Undo, existing consolidate/remove/Undo, both Stop
  Managing paths, conversation delete/Undo/restart/restore/reindex, occupied-path
  protection, and protected Worktree recovery copies in the shared Backup manager.
- Removal preview: 920/1180/1440 widths in English, Simplified Chinese and
  Traditional Chinese; minimum-window stale error and retry. Captures use synthetic
  data and isolated homes. Inspected the actual full-window captures, including
  the error state and existing Backup restore errors; no extra control CSS added.
- Seven existing conversation/recovery visual comparisons passed the unchanged
  1.2% threshold, with no golden-image replacement or tolerance relaxation.
- Six audits passed: styles, module budgets, Target boundaries, translations,
  feature evidence and UI contracts. `git diff --check` passed.
- Reports: `/tmp/aem-six-all-verified.json`, `/tmp/aem-six-native-verified.json`,
  `/tmp/aem-six-visual-report/visual-report.json`; reviewed captures are in
  `/tmp/aem-six-native/`.

## Verified Boundaries

- Optional usage and space information cannot authorize writes or report unknown
  counts as complete. Actual updates still inspect affected ownership and content.
- Library removal binds copied/linked installs, runtime aliases, direct and Group
  references, shared receipts, and private Target receipts to one recovery journal.
  New references or changed selected paths invalidate the preview. Tests inject
  failures both during and after reference writes and verify complete restoration.
- Shared-path removal retains the danger confirmation and an explicit warning for
  consumers AgentEnv cannot enumerate. Unmanaged copies are never adopted by name.
- Independent operations can proceed around verified disjoint recovery scopes;
  unverifiable scope, real overlap, external changes, unsafe paths and sole recovery
  data retain their safety stops. Complex commands without an issued exact scope
  remain conservative rather than inventing write authority.
- No real Agent files, paid models, remote hosts or credentials were used for this
  acceptance run. Highest verified layer is source-built macOS Electron plus
  persisted files/index. Packaged installers and native Windows/Linux were not
  exercised in this task; this is not a release certification.
