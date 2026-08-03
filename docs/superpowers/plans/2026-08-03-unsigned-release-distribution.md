# Unsigned Release Distribution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish verified unsigned desktop packages, install and update the macOS app through an official self-hosted Homebrew Cask, and add optional minimal reliability telemetry.

**Architecture:** GitHub Release remains the release source of truth. Focused main-process services own release metadata, Homebrew execution, and telemetry; typed preload IPC exposes read-only state and explicit commands to the renderer. The Homebrew Cask performs the final checksum-bound install and quarantine removal.

**Tech Stack:** Electron, TypeScript, React, Vitest, Playwright Electron, electron-builder, GitHub Actions, Homebrew Cask DSL, Node built-ins.

---

## Chunk 1: Release And Cask

### Task 1: Release manifest and Cask generation

**Files:**
- Create: `scripts/release-manifest.mjs`
- Create: `scripts/render-homebrew-cask.mjs`
- Create: `packaging/homebrew/Casks/agentenv-manager.rb.template`
- Test: `tests/main/releasePackaging.test.ts`

- [ ] Write failing tests for version/tag matching, exact asset identity, SHA-256 generation, architecture-specific Cask URLs, and forbidden mutable Cask fields.
- [ ] Run the focused test and confirm it fails because the scripts do not exist.
- [ ] Implement deterministic manifest and Cask generation using Node built-ins.
- [ ] Re-run the focused test and package metadata tests.

### Task 2: Gated cross-platform release workflow

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `package.json`
- Modify: `scripts/verify-product.mjs`
- Test: `tests/main/packagePackaging.test.ts`

- [ ] Replace signed-release assertions with failing tests for build jobs, draft assembly, exact asset validation, SBOM, manifest, Cask artifact, and no signing secrets.
- [ ] Run the test and verify the old signed-only workflow fails the new contract.
- [ ] Implement build-artifact jobs and a single publish job, preserving pinned Actions and least privileges.
- [x] Add a Tap publication step guarded by a repository-scoped Deploy Key.
- [ ] Run packaging, workflow, and release-verification tests.

## Chunk 2: Update Runtime

### Task 3: Update types and settings

**Files:**
- Create: `src/shared/appUpdates.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/settingsStore.ts`
- Test: `tests/main/settingsStore.test.ts`

- [ ] Write failing tests for update defaults, persisted settings, and schema migration.
- [ ] Add typed update states, install channels, release metadata, and settings fields.
- [ ] Run focused settings tests.

### Task 4: Trusted release client and Homebrew adapter

**Files:**
- Create: `src/main/appUpdates/releaseClient.ts`
- Create: `src/main/appUpdates/homebrewAdapter.ts`
- Create: `src/main/appUpdates/updateService.ts`
- Test: `tests/main/appUpdates/releaseClient.test.ts`
- Test: `tests/main/appUpdates/homebrewAdapter.test.ts`
- Test: `tests/main/appUpdates/updateService.test.ts`

- [ ] Write failing tests for official repository enforcement, stable SemVer ordering, architecture matching, malformed releases, offline behavior, packaged PATH discovery, direct argument spawning, and state isolation.
- [ ] Implement the smallest release client, Homebrew capability adapter, and update coordinator.
- [ ] Add bounded automatic checks and ensure concurrent checks coalesce.
- [ ] Run all focused update tests.

### Task 5: IPC and lifecycle integration

**Files:**
- Modify: `src/main/activationService.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/appUpdates/updateIpc.test.ts`

- [ ] Write failing tests for narrow IPC methods, startup scheduling, settings changes, install gating, and quit/restart handoff.
- [ ] Wire services into activation without delaying the initial window.
- [ ] Expose read/check/download/install operations and state events.
- [ ] Run IPC and startup tests.

### Task 6: Settings and update feedback

**Files:**
- Create: `src/renderer/components/AppUpdateSettings.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/i18n.tsx`
- Modify: `src/renderer/ui/pages/settings.css`
- Test: `tests/renderer/AppUpdateSettings.test.tsx`
- Test: `tests/renderer/App.test.tsx`

- [ ] Write failing tests for install-channel copy, update toggles, Check now, working feedback, Ready to update, failure detail, and unsupported direct-install state.
- [ ] Build the Settings section from existing preference rows, switches, buttons, and global feedback primitives.
- [ ] Add English, Simplified Chinese, and Traditional Chinese strings.
- [ ] Run renderer and translation tests at default and minimum widths.

## Chunk 3: Minimal Telemetry

### Task 7: Allowlisted telemetry service

**Files:**
- Create: `src/shared/telemetry.ts`
- Create: `src/main/telemetry/telemetryService.ts`
- Modify: `src/main/settingsStore.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/telemetryService.test.ts`

- [ ] Write failing tests proving opt-out sends nothing and forbidden values cannot enter the payload.
- [ ] Implement a compile-time endpoint, native fetch transport, short timeout, daily coalescing, and stable result codes.
- [ ] Verify network failure never rejects startup or user commands.

### Task 8: Privacy settings and documentation

**Files:**
- Create: `src/renderer/components/TelemetrySettings.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/i18n.tsx`
- Modify: `PRIVACY.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Test: `tests/renderer/TelemetrySettings.test.tsx`

- [ ] Write failing tests for explicit consent, payload preview, persistence, and independent update controls.
- [ ] Add the Settings surface using existing preference primitives.
- [ ] Update privacy and installation documentation without overstating platform trust.
- [ ] Run renderer, translation, and documentation audits.

## Chunk 4: End-To-End Evidence

### Task 9: Update and Cask E2E

**Files:**
- Create: `tests/e2e/electronAppUpdates.e2e.test.ts`
- Create: `scripts/test-homebrew-cask.mjs`
- Modify: `scripts/test-packaged-app.mjs`
- Modify: `scripts/verify-product.mjs`
- Modify: `docs/product-contracts.md`
- Modify: `docs/feature-evidence.json`

- [ ] Add a fake official Release service and fake Homebrew executable to packaged Electron E2E.
- [ ] Cover no update, available, checking persistence, download, install handoff, failure, direct-install limitation, opt-out telemetry, and unsupported platform states.
- [ ] Test generated Cask installation into a temporary appdir and assert quarantine removal.
- [ ] Register idle/working/result/error visual and desktop evidence.
- [ ] Run `npm run verify:release` and inspect the final package evidence receipt.

## Commit Note

The repository instruction normally requests commits after changes, but the user
has explicitly requested that weekday daytime work remain uncommitted for an
evening batch. Do not commit or push this plan's implementation during that window.
