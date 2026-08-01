# Documentation Guide

The documentation is split into current product authority, engineering
verification, and dated historical evidence. This index is the starting point
for deciding which document governs a change.

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

## Historical Material

The following directories are retained as design and implementation history:

- `design-briefs/`
- `product-audit/`
- `superpowers/plans/`
- `superpowers/specs/`
- dated files under `verification/`

They are useful for understanding decisions and comparing prior interfaces,
but they are not current requirements or open-work trackers. An unchecked item
inside a dated plan or audit does not become current work unless it is also
present in the product contract or current quality checklist.

## Verification Commands

```bash
npm test
npm run test:e2e
npm run verify:visual
npm run verify:product
npm run verify:release
npm run verify:current
```

- `npm test` runs the complete source suite. Tests that launch real Electron
  processes are isolated and serialized after the parallel-safe suite.
- `npm run test:e2e` runs the same scheduling policy for end-to-end files.
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
supported workflows inside an isolated environment. It must run natively on
macOS, Windows, and Linux before those platforms are claimed as verified. A
valid DMG checksum and mount prove macOS container integrity only. Neither
proves public distribution trust.

A public macOS release additionally requires a Developer ID Application
identity, hardened-runtime signing, Apple notarization, stapling, Gatekeeper
assessment, and a clean-Mac packaged smoke. An ad-hoc or unsigned package may
be used for local testing but must not be described as signed or notarized.
