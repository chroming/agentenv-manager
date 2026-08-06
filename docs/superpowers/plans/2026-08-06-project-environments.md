# Profiles and Workspaces Convergence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Profiles the reusable configuration object and Workspaces a lightweight, Git-aware view of real project-owned Agent files without duplicating Library, Profile, or Agent deployment workflows.

**Architecture:** Preserve the existing safe Project reference, adapter, mutation, recovery, and launch services. Replace the user-facing object/verb model, add bounded Git advisory metadata, extract a shared resource disclosure primitive, and rebuild Workspaces around loaded-resource context plus explicit regular-file mutations.

**Tech Stack:** Electron, React, TypeScript, Node filesystem and child-process APIs, Zod, Vitest, Electron E2E; no new dependency.

---

## Chunk 1: Contract and Shared Primitives

### Task 1: Lock the object, vocabulary, and mutation contracts

**Files:**
- Modify: `docs/product-contracts.md`
- Modify: `docs/feature-evidence.json`
- Modify: `README.md`
- Modify: `README.en.md`
- Test: `tests/config/productContract.test.ts`

- [ ] Add failing contract assertions for Profile-only terminology, Workspace ownership, regular-file copy semantics, and unique mutation verbs.
- [ ] Update the normative contracts and public description.
- [ ] Run the focused contract test and confirm it passes.

### Task 2: Extract the shared resource disclosure pattern

**Files:**
- Create: `src/renderer/components/ui/ResourceDisclosureSection.tsx`
- Modify: `src/renderer/components/ProfileComposerSection.tsx`
- Modify: `src/renderer/components/ui/index.ts`
- Modify: `src/renderer/ui/patterns.css`
- Test: `tests/renderer/uiPrimitives.test.tsx`
- Test: `tests/renderer/ProfileComposerSection.test.tsx`

- [ ] Write failing tests for shared disclosure, count, action slot, keyboard toggle, disabled/read-only state, and stable geometry hooks.
- [ ] Implement the shared base and refactor Profile composition to use it without changing behavior.
- [ ] Run focused Renderer tests and the UI component policy audit.

## Chunk 2: Product Vocabulary and Workspace Projection

### Task 3: Restore Profiles as the public saved-recipe name

**Files:**
- Modify: `src/renderer/i18n.tsx`
- Modify: `src/renderer/components/ProfileSidebar.tsx`
- Modify: `src/renderer/components/ProfileList.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: affected Renderer and Electron tests

- [ ] Write failing tests for sidebar order, headings, actions, help text, and no public Environment-object label.
- [ ] Change user-facing labels only; retain persisted Profile schema and service identifiers.
- [ ] Run translation, navigation, Profile, Quick Open, and Electron selector tests.

### Task 4: Rebuild Projects as Workspaces

**Files:**
- Modify: `src/renderer/components/ProjectsWorkspace.tsx`
- Modify: `src/renderer/components/ProjectEnvironmentPreviewDialog.tsx`
- Modify: `src/renderer/components/ProfileSidebar.tsx`
- Modify: `src/renderer/quickOpenItems.tsx`
- Modify: `src/renderer/ui/pages/projects.css`
- Test: `tests/renderer/ProjectsWorkspace.test.tsx`

- [ ] Write failing tests for Workspaces terminology, one primary action, explicit Open-with context, loaded-resource summary, compact disclosure sections, omitted unsupported empty categories, and unique empty state.
- [ ] Compose only shared PageHeader, list-detail, InspectorHeader, fields, menus, disclosure, row, dialog, and feedback primitives.
- [ ] Replace effective-environment language with loaded-resource details and remove Workspace/Profile sync semantics.
- [ ] Run focused Renderer, translation, style, and component-policy tests.

## Chunk 3: Git-aware Portable Workspace Copies

### Task 5: Add bounded Workspace Git observations

**Files:**
- Create: `src/main/projects/projectGitService.ts`
- Modify: `src/main/projects/projectEnvironmentService.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/schemas.ts`
- Test: `tests/main/projects/projectGitService.test.ts`
- Test: `tests/main/projects/projectEnvironmentService.test.ts`

- [ ] Write failing tests for non-Git, tracked, modified, untracked, ignored, nested worktree, unavailable Git, timeout, and redacted error states.
- [ ] Use system Git with argv arrays, bounded cwd, timeout, output limit, and no mutating commands.
- [ ] Expose only repository root relation and affected-path statuses to the Renderer.
- [ ] Run focused domain and schema tests.

### Task 6: Make Workspace copy and link conversion explicit

**Files:**
- Modify: `src/main/projects/projectMutationService.ts`
- Modify: `src/main/projects/projectRecoveryStore.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/components/ProjectsWorkspace.tsx`
- Test: `tests/main/projects/projectMutationService.test.ts`
- Test: `tests/renderer/ProjectsWorkspace.test.tsx`

- [ ] Write failing tests proving every copy is regular, no symlink is created, existing links remain inspect-only, and Git state is advisory.
- [ ] Add explicit file-impact preview before copy/update/remove and link-to-portable-copy conversion.
- [ ] Keep Import delegated to the existing Skill Library flow and exclude Library-private metadata.
- [ ] Run focused mutation, recovery, Renderer, and IPC tests.

## Chunk 4: Evidence and Release Proof

### Task 7: Update localization, feature evidence, and visual baselines

**Files:**
- Modify: `src/renderer/i18n.tsx`
- Modify: `docs/feature-evidence.json`
- Modify: `tests/visual/critical-captures.json`
- Modify: `scripts/capture-profiles.mjs`
- Modify: visual golden images

- [ ] Cover Profiles and Workspaces in English, zh-CN, and zh-TW.
- [ ] Capture empty/selected, collapsed/expanded, copy preview, Git/non-Git, partial, working, and error states at 920x620 and 1180x728.
- [ ] Cold-read sibling Profiles, Agents, Workspaces, and Skills captures for component and emphasis consistency.

### Task 8: Complete functional, persistence, desktop, visual, and packaged verification

**Files:**
- Modify: `tests/e2e/projects.e2e.test.ts`
- Modify: `scripts/test-packaged-app.mjs`
- Modify: `docs/verification-snapshot.json`

- [ ] Verify Add folder, restart persistence, inspect, regular-file copy, stale/no-op, recovery, remove-from-list safety, Git unchanged, and Open `cwd`.
- [ ] Run focused tests, `npm run test:quick`, Electron E2E, `npm run verify:visual`, packaged smoke, and final `npm run verify:release`.
- [ ] Record separate functional, persistence, visual, desktop-process, and packaged evidence.
