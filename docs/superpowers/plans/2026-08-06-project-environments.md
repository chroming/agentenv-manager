# Project Environments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Projects workspace that safely manages real project-local Agent resources, previews one Agent's effective environment, and launches that Agent in the selected directory without binding or applying a Profile.

**Architecture:** Persist only device-local Project references. Add an optional Project capability to Target adapters; a shared service owns path validation, discovery composition, backups, atomic file mutation, effective preview, and terminal launch. The Renderer composes existing list-detail, row, dialog, progress, and file preview primitives.

**Tech Stack:** Electron, React, TypeScript, Zod, Node filesystem APIs, Vitest, Electron E2E; no new runtime dependency.

---

## Chunk 1: Contract and Core Domain

### Task 1: Register Project contracts and evidence

**Files:**
- Modify: `docs/product-contracts.md`
- Modify: `docs/feature-evidence.json`
- Modify: `tests/visual/critical-captures.json`

- [ ] Add the normative Project ownership, direct-mutation, preview, launch, no-op, stale, rollback, and partial-support contract.
- [ ] Register all six Target support states and exact evidence paths.
- [ ] Register empty, selected, and effective-preview critical captures at 920x620 and 1180x728.

### Task 2: Define shared Project schemas and types

**Files:**
- Modify: `src/shared/schemas.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/shared/schemas.test.ts`

- [ ] Write failing schema tests for canonical Project references, resource kinds, capabilities, snapshots, preview states, and mutation inputs.
- [ ] Run `npx vitest run tests/shared/schemas.test.ts` and confirm the missing schema failures.
- [ ] Implement bounded schemas and exported API types without accepting arbitrary paths or adapter payloads.
- [ ] Re-run the schema test and confirm it passes.

### Task 3: Persist device-local Project references

**Files:**
- Modify: `src/main/paths.ts`
- Create: `src/main/projects/projectStore.ts`
- Test: `tests/main/projects/projectStore.test.ts`
- Modify: `tests/main/appDataFormat.test.ts`
- Modify: `tests/main/dataBackupService.test.ts`

- [ ] Write failing tests for add, duplicate canonical path, rename, last-used Agent, restart, missing directory, remove-reference, malformed data, and data backup inclusion.
- [ ] Run the focused tests and confirm failures are due to the absent store/path.
- [ ] Implement atomic `projects.json` persistence and validation. Removing a reference must never call `rm` on the Project path.
- [ ] Add Project metadata to complete AgentEnv data backup/restore while keeping absolute paths device-local and excluded from Workspace Sync.
- [ ] Re-run focused tests.

## Chunk 2: Target Capability and Safe Services

### Task 4: Extract generic launch and project capability contracts

**Files:**
- Modify: `src/main/targets/types.ts`
- Modify: `src/main/conversations/conversationLauncher.ts`
- Create: `src/main/projects/projectCapability.ts`
- Test: `tests/main/projects/projectCapability.test.ts`
- Test: `tests/main/conversations/conversationLauncher.test.ts`

- [ ] Write failing tests for a generic launch spec, cwd preservation, unsupported launch, and adapter support matrices.
- [ ] Extract `AgentLaunchSpec`; retain conversation resume fields in a conversation-specific extension.
- [ ] Define adapter-owned instruction files, Skill directories, MCP files, parser support, and launch builder.
- [ ] Prove existing Conversation behavior remains unchanged.

### Task 5: Add Project declarations to every Target adapter

**Files:**
- Modify: `src/main/targets/opencodeTarget.ts`
- Modify: `src/main/targets/claudeCodeTarget.ts`
- Modify: `src/main/targets/codexTarget.ts`
- Modify: `src/main/targets/integrations/antigravity/index.ts`
- Modify: `src/main/targets/integrations/trae-cli/index.ts`
- Modify: `src/main/targets/integrations/pi/index.ts`
- Modify: `src/main/targets/evaluations/*Evaluation.ts`
- Test: `tests/main/targetIntegrationContract.test.ts`
- Test: `tests/e2e/targetConformance.e2e.test.ts`

- [ ] Write failing conformance tests requiring explicit Project support for every Agent and no Renderer Agent-ID switch.
- [ ] Keep Compare/Evaluation masks separate; reuse Project declarations only where equivalence is proven.
- [ ] Declare inspect and mutation support independently for all six Agents.
- [ ] Re-run target conformance and evaluation adapter tests.

### Task 6: Discover resources and resolve effective environment

**Files:**
- Create: `src/main/projects/projectEnvironmentService.ts`
- Create: `src/main/projects/projectResourceReader.ts`
- Test: `tests/main/projects/projectEnvironmentService.test.ts`

- [ ] Write failing tests for instructions, Skill directories, MCP names, shared consumers, duplicate names, external global resources, unknown precedence, symlink escape, bounded traversal, missing path, and partial results.
- [ ] Implement fresh adapter-directed discovery without scanning unrelated descendants.
- [ ] Compose project and real global snapshots per selected Agent; name excluded sources and never infer undocumented precedence.
- [ ] Re-run focused tests.

### Task 7: Implement recoverable Project file mutations

**Files:**
- Create: `src/main/projects/projectMutationService.ts`
- Create: `src/main/projects/projectRecoveryStore.ts`
- Modify: `src/main/backupStore.ts`
- Modify: `src/main/maintenanceService.ts`
- Modify: `src/shared/schemas.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/projects/projectMutationService.test.ts`

- [ ] Write failing tests for text no-op, stale expected hash, opaque-resource authority, atomic Save, remove, rollback, failed verification, failed restore, overlapping-path blocking, and portable Library Skill copy rejecting links and escapes.
- [ ] Implement fresh read, diff, backup, atomic replacement, verification, protected receipt, automatic restore, and recovery-required state.
- [ ] Ensure Project rollback has preview, stale-restore safety backup, private retention, and a persistent Recovery entry without involving Profile Apply.
- [ ] Re-run focused tests.

### Task 8: Implement Project launch

**Files:**
- Create: `src/main/projects/projectLaunchService.ts`
- Modify: `src/main/conversations/conversationLauncher.ts`
- Test: `tests/main/projects/projectLaunchService.test.ts`

- [ ] Write failing tests for executable discovery, canonical cwd, last-used Agent persistence, terminal preference, missing command, and no Profile mutation.
- [ ] Reuse the terminal launcher with an adapter-generated generic launch spec.
- [ ] Verify launch never calls Profile Save, Preview, or Apply services.
- [ ] Re-run focused tests.

## Chunk 3: Desktop API and Renderer

### Task 9: Expose a narrow Project API

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/projects/projectIpc.test.ts`

- [ ] Write failing tests for directory picker, list/add/update/remove, inspect, preview, read/save/remove resource, add Library Skill, launch, and rollback channels.
- [ ] Reject absolute Renderer mutation paths; bind every write to Project ID, Agent ID, opaque resource ID, and expected hash.
- [ ] Register services and diagnostic operations. Project file mutations use the mutation coordinator but do not inherit Workspace Sync recovery blocking.
- [ ] Expose only typed methods through preload.
- [ ] Re-run focused tests.

### Task 10: Add Projects navigation and controller

**Files:**
- Modify: `src/renderer/components/ProfileSidebar.tsx`
- Modify: `src/renderer/hooks/useWorkspaceNavigation.tsx`
- Create: `src/renderer/hooks/useProjectsController.ts`
- Modify: `src/renderer/quickOpenItems.tsx`
- Test: `tests/renderer/ProjectsWorkspace.test.tsx`
- Test: `tests/renderer/QuickOpen.test.tsx`

- [ ] Write failing tests for navigation order, add/select/remove-reference, restart selection, Quick Open result, missing path, loading without false-empty flash, and local async feedback.
- [ ] Add `projects` to the stable shell and keep one Project-list scroll owner.
- [ ] Implement local state updates without reloading unrelated workspaces.
- [ ] Re-run focused tests.

### Task 11: Build the Project list-detail workspace

**Files:**
- Create: `src/renderer/components/ProjectsWorkspace.tsx`
- Create: `src/renderer/components/ProjectResourceList.tsx`
- Create: `src/renderer/components/ProjectOpenButton.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/ui/*.css`
- Test: `tests/renderer/ProjectsWorkspace.test.tsx`

- [ ] Write failing behavior and geometry tests for empty, selected, missing, one/many resources, long names and paths, supported/partial/unsupported capability, and 920x620 containment.
- [ ] Compose `PageHeader`, standard controls, list-detail geometry, resource rows, selectable overflow text, and split Open behavior.
- [ ] Keep list rows at two lines and show only exceptional status.
- [ ] Add right-click actions matching the overflow menu.
- [ ] Re-run Renderer tests and style audits.

### Task 12: Add resource editing and effective preview dialogs

**Files:**
- Create: `src/renderer/components/ProjectResourceEditorDialog.tsx`
- Create: `src/renderer/components/ProjectEnvironmentPreviewDialog.tsx`
- Reuse: `src/renderer/components/DiffWorkspaceDialog.tsx`
- Reuse: `src/renderer/components/SyntaxCodePreview.tsx`
- Test: `tests/renderer/ProjectResourceEditorDialog.test.tsx`
- Test: `tests/renderer/ProjectEnvironmentPreviewDialog.test.tsx`

- [ ] Write failing tests for dirty Save, no-op disabled Save, stale refresh, remove confirmation, working/error/recovery states, Agent selection, partial preview, duplicate names, unknown precedence, Escape, safe outside click, focus return, and maximize.
- [ ] Cover Save / Discard / Cancel when switching resource, Project, workspace, dismissing the dialog, removing the reference, and closing the app.
- [ ] Implement resource editing and preview with existing dialog, tab, diff, file-tree, and feedback primitives.
- [ ] Keep critical errors and recovery actions in-dialog rather than behind the overlay.
- [ ] Re-run focused tests.

### Task 13: Complete localization and product icons

**Files:**
- Modify: `src/renderer/i18n.tsx`
- Modify: `src/renderer/productIcons.tsx`
- Test: `tests/renderer/i18n.test.ts`
- Test: `tests/renderer/productIcons.test.tsx`

- [ ] Add English, zh-CN, and zh-TW strings without concatenated sentence fragments.
- [ ] Add one shared Project icon used by navigation, empty state, loading, and Quick Open.
- [ ] Run translation and icon tests.

## Chunk 4: Desktop and Visual Proof

### Task 14: Add Electron Project E2E

**Files:**
- Create: `tests/e2e/projects.e2e.test.ts`
- Modify: `scripts/run-feature-tests.mjs`

- [ ] Add a Fake Home and temporary Project containing representative resources for all capability classes.
- [ ] Verify add through native picker fixture, restart persistence, inspect, edit and rollback, no-op, stale refresh, missing path, remove-reference safety, split Open launch fixture, and effective preview.
- [ ] Verify the original project tree is unchanged after read-only preview and failed or cancelled mutations.
- [ ] Run `npm run build && npx vitest run tests/e2e/projects.e2e.test.ts`.

### Task 15: Register and inspect critical captures

**Files:**
- Modify: `scripts/capture-profiles.mjs`
- Modify: `tests/visual/critical-captures.json`
- Create: `tests/visual/golden/projects-empty-920x620.png`
- Create: `tests/visual/golden/projects-selected-920x620.png`
- Create: `tests/visual/golden/project-environment-preview-920x620.png`
- Create: `tests/visual/golden/projects-selected-1180x728.png`

- [ ] Capture empty/selected, idle/working, partial preview, minimum/default viewports, and all three locales against the rebuilt artifact.
- [ ] Cold-read every capture for hierarchy, clipping, scroll ownership, action alignment, and long-path behavior.
- [ ] Run `npm run verify:visual`.

### Task 16: Verify and close

**Files:**
- Modify: `docs/verification-snapshot.json`
- Modify: `README.md`
- Modify: `README.en.md`

- [ ] Run `npm run test:quick` during implementation checkpoints.
- [ ] Run `npm run verify:commit` after all focused tests pass.
- [ ] Run `npm run test:e2e:packaged` because packaged command discovery and terminal launch differ from the development shell.
- [ ] Record separate functional, persistence, visual, desktop-process, and packaged evidence.
- [ ] Update user documentation only for capabilities proven by the final artifact.
