# UI Quality Infrastructure

## Outcome

Shared desktop UI changes must fail verification before they can introduce a
local alignment, typography, overflow, or visual hierarchy regression in a
sibling page.

This work does not change persisted data, Agent files, or filesystem behavior.
It owns renderer structure and evidence only.

## Ownership

The ownership chain is fixed:

1. `tokens.css` owns dimensions and typography values.
2. UI primitives own component anatomy and named variants.
3. `AlignedResourceList` owns repeated row tracks.
4. Pages own resource content and arrangement, not primitive geometry.
5. E2E helpers own cross-page geometry assertions.
6. Visual contracts own cold-read evidence for dense regions.

Pages must not recreate aligned row tracks with local CSS variables or copy
geometry-reading logic into individual tests.

## Required State Matrix

Every aligned resource list must remain coherent across:

- states: normal, update, pending, disabled, error, and unavailable;
- actions: none, icon, switch, text fallback, and overflow menu;
- content: zero, one, and many rows, including long translated labels;
- locales: English, Simplified Chinese, and Traditional Chinese;
- supported widths: 920 and 1180 pixels.

The invariant is structural: state lanes share a left edge, action lanes share
a left edge, rows remain contained, and visible control text does not clip.

## Evidence

- Renderer: primitive anatomy and named list variants.
- Geometry: shared E2E assertions used by Profiles and Workspaces.
- Visual: region captures for Profile resources, Workspace resources, and the
  Conversation list with a stricter per-capture threshold.
- Desktop: rebuilt Electron tests at both supported widths.
- Persistence: not applicable; no persisted schema or write path changes.
- Package: not required for this renderer-only contract.

## No-op And Failure Semantics

The audit succeeds silently when all owners and evidence are present. It fails
with the missing owner or capture name when a page bypasses the shared list,
when a critical region loses its strict threshold, or when the shared geometry
helper is no longer exercised by both owning pages.
