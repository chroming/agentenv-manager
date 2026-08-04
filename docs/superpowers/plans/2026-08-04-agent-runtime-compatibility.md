# Agent Runtime Compatibility Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable, diagnosable Agent command discovery with per-Agent command overrides while preserving the existing Profile and resource-management boundary.

**Architecture:** Store ordered executable candidates in each Target descriptor, normalize safe per-Target overrides in Settings, and let Target discovery resolve the override before declared candidates. Expose command probe state and evidence through `TargetHealth`; keep Agent-specific conversation resume behavior in existing conversation adapters.

**Tech Stack:** Electron, TypeScript, React, Vitest, Testing Library, existing AgentEnv UI primitives.

---

## Chunk 1: Runtime contract and discovery

### Task 1: Define executable candidates and probe state

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/targets/defineTargetIntegration.ts`
- Modify: built-in Target integrations
- Test: `tests/main/targetIntegrationContract.test.ts`

- [ ] Add failing contract tests for ordered candidates, safe names, and primary-command alignment.
- [ ] Add the shared runtime declaration and probe result types.
- [ ] Declare candidates for every built-in Target.
- [ ] Run the contract tests until green.

### Task 2: Add safe command overrides and three-state discovery

**Files:**
- Modify: `src/main/settingsStore.ts`
- Modify: `src/main/targetDiscovery.ts`
- Modify: `src/main/targets/types.ts`
- Test: `tests/main/settingsStore.test.ts`
- Test: `tests/main/targetDiscovery.test.ts`

- [ ] Add failing settings tests for basename, absolute path, tilde path, unsupported Target, and shell syntax.
- [ ] Add failing discovery tests for override precedence, candidate fallback, and unknown probe results.
- [ ] Normalize settings and resolve overrides without invoking a shell.
- [ ] Expose command status and diagnostic evidence without changing resource write authority.
- [ ] Run focused tests until green.

## Chunk 2: Settings and product evidence

### Task 3: Add the advanced command setting

**Files:**
- Modify: `src/renderer/components/AgentSettingsSection.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/i18n.tsx`
- Modify: `src/renderer/ui/pages/settings.css`
- Test: `tests/renderer/AgentSettingsSection.test.tsx`

- [ ] Add failing tests for saving and resetting an override.
- [ ] Render the control under an Advanced commands disclosure.
- [ ] Use shared input and button primitives with local pending feedback.
- [ ] Explain that this changes detection and launch only.
- [ ] Run focused renderer tests until green.

### Task 4: Verify the compatibility contract

**Files:**
- Modify: `tests/main/targets/installationDiscovery.test.ts`
- Modify: `docs/product-contracts.md`

- [ ] Cover Windows path semantics and executable symlinks where applicable.
- [ ] Record detected versus manageable capability semantics.
- [ ] Run focused Main and Renderer tests.
- [ ] Run TypeScript, translation, module-boundary, and diff checks.
- [ ] Do not commit during weekday daytime.
