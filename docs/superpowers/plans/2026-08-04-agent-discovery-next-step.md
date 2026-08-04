# Agent Discovery Next Step Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a newly enabled Agent continue into the existing safe configuration flow without automatically capturing, creating a Profile, applying resources, or modifying Agent files.

**Architecture:** Extend the existing discovery controller with an ephemeral `setup` phase that remembers only the Agents enabled by the just-completed action. Derive each Agent's next action from persisted Profile and Target state, render that action in the existing dialog, and delegate it to the canonical `openAgentConfiguration` path. No onboarding lifecycle is persisted and no second Profile implementation is introduced.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Electron E2E, existing AgentEnv UI primitives.

---

## Chunk 1: Behavior Contract And State

### Task 1: Derive the next setup action

**Files:**
- Create: `src/renderer/agentSetup.ts`
- Test: `tests/renderer/agentSetup.test.ts`
- Modify: `docs/product-contracts.md`

- [ ] Write failing tests for new, captured, active, and malformed Profile states.
- [ ] Run the focused Vitest file and confirm the missing helper failure.
- [ ] Implement the pure derivation helper.
- [ ] Record the enable/configure/apply persistence boundaries in the product contract.
- [ ] Run the focused test until green.

### Task 2: Preserve the post-enable phase for one session

**Files:**
- Modify: `src/renderer/hooks/useAgentDiscovery.ts`
- Test: `tests/renderer/App.test.tsx`

- [ ] Add a failing Renderer test proving successful Enable advances the same dialog instead of closing it.
- [ ] Add an ephemeral setup phase and recently-enabled Agent IDs.
- [ ] Prove `Set up later` closes without persisting onboarding state or changing Agent files.

## Chunk 2: Canonical Configuration Handoff

### Task 3: Render one executable next action per Agent

**Files:**
- Modify: `src/renderer/components/AgentDiscoveryDialog.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/i18n.tsx`
- Modify: `src/renderer/ui/pages/settings.css`
- Test: `tests/renderer/App.test.tsx`

- [ ] Add failing tests for `Review current setup`, `Continue setup`, and `Open Profile`.
- [ ] Render the setup phase with the explicit `Agent files have not changed` boundary.
- [ ] Delegate every row action to `openAgentConfiguration` and close the onboarding dialog first.
- [ ] Keep multiple Agents as independent rows; never auto-chain Capture operations.
- [ ] Verify Escape and `Set up later` dismiss safely.

### Task 4: Prove desktop behavior and zero mutation

**Files:**
- Modify: `tests/e2e/electronUiProfileSwitching.e2e.test.ts`
- Modify: `scripts/feature-test-groups.mjs`

- [ ] Extend the existing discovery E2E to verify the post-enable state at minimum viewport.
- [ ] Open the canonical Create from Target dialog from `Review current setup`.
- [ ] Verify Instructions and config bytes remain unchanged before Apply.
- [ ] Register the scenarios in the `agent-discovery` feature test group.

## Chunk 3: Verification

### Task 5: Run applicable evidence

- [ ] Run focused Renderer tests.
- [ ] Rebuild and run the registered `agent-discovery` feature suite.
- [ ] Run TypeScript, translation, module, style, and feature-evidence audits.
- [ ] Run `git diff --check` and inspect the dirty worktree without reverting unrelated changes.
- [ ] Do not commit during weekday daytime per the user's explicit repository workflow.
