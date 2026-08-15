# Documentation Guide

The documentation is split into current product authority and engineering
verification. This index is the starting point for deciding which document
governs a change.

## Current Authority

Read these documents in order:

1. [`../README.md`](../README.md) describes the current user-facing product,
   supported platform, and common commands.
2. [`product-contracts.md`](product-contracts.md) is the normative source for
   product semantics, ownership, persistence, safety, and recovery.
3. [`product-quality-checklist.md`](product-quality-checklist.md) defines the
   cross-page interaction, visual, accessibility, and release review gates.
4. [`testing-strategy.md`](testing-strategy.md) explains what each evidence
   layer proves and how the desktop test suite is scheduled.
5. [`development.md`](development.md) describes the current architecture and
   contribution workflow.
6. [`development/feature-delivery.md`](development/feature-delivery.md) is the
   admission gate for substantial new capabilities and their executable evidence.
7. [`verification-snapshot.json`](verification-snapshot.json) is generated
   evidence for the exact source and Electron artifact last exercised by the
   product gate.

When documents disagree, `product-contracts.md` governs product behavior.
Executable tests and audits must be updated with the contract; passing an old
test does not override a newer contract.

Historical specs and implementation plans under `docs/superpowers/` record why
a change was made; they do not override the current contracts. Public mock
screenshots under `docs/images/` are generated from an isolated synthetic Home
and contain no contributor Agent data. Current behavior must be represented by
contracts, tests, changelog entries, issues, or pull requests rather than an
obsolete plan.

## Verification Commands

```bash
npm run test:quick
npm run test:feature -- agent-discovery
npm test
npm run test:e2e
npm run verify:commit
npm run verify:visual
npm run verify:product
npm run verify:release
npm run verify:current
```

- `npm run test:quick` type-checks and runs worktree-related tests and audits
  without launching Electron.
- `npm run test:feature -- <name>` runs one registered feature's selected
  source and desktop evidence.
- `npm test` runs the complete source suite. The large Electron UI suite uses
  two process-isolated shards with an exact missing/duplicate coverage check;
  all remaining Electron files retain isolated execution.
- `npm run test:e2e` runs the same scheduling policy for end-to-end files.
- `npm run verify:commit` runs the complete suite and every static audit.
- `npm run verify:visual` rebuilds, captures the critical desktop states, and
  compares them with the checked-in pixel baselines.
- `npm run verify:product` binds source, compiled artifact, tests, audits,
  captures, and visual results into the verification snapshot.
- `npm run verify:release` adds the isolated packaged-application smoke.
- `npm run verify:current` proves that the recorded source, build, captures, and
  snapshot still refer to the current checkout.
- `npm run audit:features` rejects registered capabilities with missing Target
  coverage, state semantics, executable evidence, or critical visual baselines.

## Visual Baseline Changes

Visual baselines are product evidence, not snapshots to update automatically.
An intentional change follows this sequence:

1. Rebuild the exact Renderer, preload, and main-process artifact.
2. Capture the applicable default/minimum viewport, language, and state pairs.
3. Cold-read the pixels without relying on selectors or implementation intent.
4. Repeat the capture to distinguish a product change from nondeterminism.
5. Run a deliberate visual fault and confirm the comparator rejects it.
6. Replace only the reviewed baseline files and run `verify:visual` again.

The comparator tolerates small antialiasing and one-pixel rasterization shifts;
it must still reject a different page, missing content, clipping, or meaningful
layout movement.

## Release Meaning

The packaged smoke proves the current platform binary can start and complete
supported workflows inside an isolated environment. It runs natively on
macOS, Windows, and Linux before those platforms are described as packaged-app
verified. This evidence does not prove compatibility with every real Agent
version or exercise each graphical installer.

The current macOS release is not notarized. Direct and distinctly named Homebrew
assets use the same fixed project-created identity so application grants remain
stable across upgrades. Every complete App seal must pass `codesign --verify`, while `spctl --assess` must
reject both because neither has Developer ID or notarization. The official Homebrew
Cask pins its channel-specific immutable Release URLs and SHA-256 values, then removes quarantine only after
Homebrew verifies the download. Direct GitHub Release downloads keep quarantine;
after copying the App to Applications and ejecting the DMG, they use the complete
system Open Anyway plus final Open flow where device policy permits it. None of this claims an Apple Developer ID,
notarization, or Gatekeeper trust decision.
