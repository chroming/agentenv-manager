# Resource Composer Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Profiles and Workspaces use one stable resource disclosure and expanded-content
grammar, including a regression gate that prevents sibling header resize and reflow.

**Architecture:** Keep `ResourceDisclosureSection` as the semantic primitive, share the independent
expansion-set controller and the composition needed for toolbar/children/empty-state parity, and make
Profile/Workspace code thin semantic adapters. Move geometry into the shared pattern owner,
remove the geometry slot escape hatch, and delete page/legacy redraws.

**Tech Stack:** React, TypeScript, shared UI primitives, CSS cascade layers, Vitest, Electron E2E,
visual capture tooling; no new dependency.

---

## Chunk 1: Contract and shared owner

### Task 1: Lock shared disclosure geometry

**Files:**
- Modify: `src/renderer/components/ui/ResourceDisclosureSection.tsx`
- Modify: `src/renderer/ui/patterns.css`
- Test: `tests/renderer/uiPrimitives.test.tsx`
- Test: `tests/e2e/electronUiProfileSwitching.e2e.test.ts`
- Test: `tests/e2e/projects.e2e.test.ts`

- [ ] Add failing tests for composer variant semantics and one shared header/action structure.
- [ ] Add paired Electron assertions that sibling header size and internal lanes do not change;
      later inline headers may move only by the active panel height.
- [ ] Implement the shared composer variant without page-specific geometry.
- [ ] Verify keyboard toggle, independent actions, and reduced-motion behavior.

### Task 2: Add shared expanded-content composition

**Files:**
- Create: `src/renderer/components/ui/useDisclosureSet.ts`
- Reuse: `src/renderer/components/ui/ResourcePanelToolbar.tsx`
- Reuse: `src/renderer/components/ui/ResourceRow.tsx`
- Modify: `src/renderer/components/ui/index.ts`
- Modify: `src/renderer/ui/patterns.css`
- Modify: `scripts/audit-renderer-css.mjs`
- Test: `tests/renderer/uiPrimitives.test.tsx`

- [ ] Lock optional toolbar, nested inset, compact empty state, and child-row geometry in the
      existing shared primitives instead of introducing a second wrapper component.
- [ ] Compose both pages from `ResourceDisclosureSection`, `ResourcePanelToolbar`, and
      `ResourceRow` so semantic differences remain page-owned without visual redraws.
- [ ] Add style-audit gates preventing page/legacy ownership of disclosure internals.

## Chunk 2: Profiles and Workspaces parity

### Task 3: Migrate Profiles

**Files:**
- Modify: `src/renderer/components/ProfileComposerSection.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/ui/pages/profile-composer.css`
- Modify: `src/renderer/ui/pages/profile-skills.css`
- Modify: `src/renderer/ui/pages/profile-mcp.css`
- Modify: `src/renderer/ui/pages/profiles.css`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer/ProfileComposerSection.test.tsx`

- [ ] Characterize policy modes and effective read-only content.
- [ ] Migrate Profile groups to the shared composer presentation.
- [ ] Remove legacy/page rules that redefine shared disclosure geometry.
- [ ] Remove the Profile geometry slot mapping and verify inactive sibling headers do not resize,
      reflow, or perform a second jump.

### Task 4: Migrate Workspaces

**Files:**
- Modify: `src/renderer/components/ProjectsWorkspace.tsx`
- Modify: `src/renderer/ui/pages/projects.css`
- Test: `tests/renderer/ProjectsWorkspace.test.tsx`

- [ ] Add a failing test for independent multi-group expansion using the shared controller.
- [ ] Use the same shared expanded-content composition for all three resource types.
- [ ] Preserve Workspace-specific edit/copy/remove and detected-only MCP semantics.
- [ ] Verify zero, one, and many rows retain the canonical density.

## Chunk 3: Paired evidence and release gate

### Task 5: Add cross-surface parity evidence

**Files:**
- Modify: `scripts/capture-profiles.mjs`
- Modify: `tests/visual/critical-captures.json`
- Modify: `tests/e2e/electronUiProfileSwitching.e2e.test.ts`
- Modify: `tests/e2e/projects.e2e.test.ts`
- Modify: `docs/feature-evidence.json`

- [ ] Capture paired Profile/Workspace Instructions, Skills, and MCP states at supported sizes;
      pair identity includes surface, kind, state, viewport, locale, fixture, and artifact hash.
- [ ] Cover collapsed/expanded, zero/one/many, long text, policy modes, and translated labels.
- [ ] Assert header baselines, stable sibling lanes, toolbar/row heights, panel inset, no overlap,
      independent multi-group expansion, focus retention, and one scroll owner on both surfaces.
- [ ] Cover loading, partial/error, actionless MCP, zero/one/many rows, and Profile policy modes.
- [ ] Rebuild, run focused Renderer/Electron tests, verify pixels, and cold-read paired captures.
- [ ] Run `npm run verify:commit`, `npm run verify:visual`, and packaged smoke if shell behavior changed.
- [ ] Record separate Renderer, desktop-process, visual, persistence (`not applicable`), and
      packaged (`not run` or result) evidence, then commit by responsibility.
