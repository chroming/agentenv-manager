# Substantial Feature Delivery

This gate applies to a new workflow, persistent object, external mutation,
Target capability, dialog family, or other substantial user-visible surface.
It prevents a feature from inheriting an unearned completion claim from the
existing suite.

## 1. Admit the feature before implementation

Record a compact Feature Admission Card:

```text
Core user outcome:
Object, owner, scope, and source of truth:
Non-goals:
Target/platform capability matrix:
State and effect matrix:
Existing shell, primitive, and feedback owners:
Required evidence and critical captures:
Completion boundary:
```

The capability matrix covers every registered Agent and marks it `supported`,
`partial`, `unsupported`, or `not-applicable`. Do not render an unavailable
capability as an enabled command. Do not call partial execution complete.

The state matrix must decide idle, working, success, error, cancellation,
semantic no-op, stale input, partial result, persistence, rollback, and return.
For each state, define the visible status, executable command, durable effect,
and external effect. A no-op is a successful semantic result and must not be
converted into a failed mutation.

## 2. Reuse rule owners

Inventory the existing shell, toolbar, dialog, row, action, progress, feedback,
tab, diff, empty-state, and recovery primitives before adding markup or CSS.
New workflows compose the product language; they do not introduce a local
button scale, tab indicator, status vocabulary, or modal hierarchy.

If the existing primitive cannot express the feature, change its owner and
sweep sibling surfaces. Do not hide a shared rule in a page override.
Repeated resource rows use `AlignedResourceList`; pages select a named action
track and may not recreate state/action columns with local CSS. A shared UI
change must keep its mixed-state fixture, cross-page geometry helper, and strict
region captures registered with `audit:ui-contracts`.

## 3. Register executable evidence

Add the feature to `docs/feature-evidence.json` before implementation is called
complete. Every entry must bind:

- the normative section in `docs/product-contracts.md`;
- all registered Target IDs and their support status;
- explicit no-op, stale, rollback, cancellation, partial, and persisted-result
  semantics;
- domain, Renderer, desktop-process, persistence, and visual evidence;
- critical pixel artifacts for the layout-changing state pairs.

Tests must prove user-visible meaning and durable effects, not only that a
selector exists, a button can be clicked, or geometry remains in bounds.
Critical visual states belong in `tests/visual/critical-captures.json` and the
checked-in golden directory. Optional screenshot environment variables are
debug aids, not product-gate evidence.

## 4. Implement in evidence order

1. Add the normative product contract and failing domain tests.
2. Add the capability and state matrices.
3. Implement the main-process behavior and persistence verification.
4. Compose existing Renderer primitives and add behavior tests.
5. Add desktop-process E2E for real workflow and failure/no-op paths.
6. Capture and cold-read minimum/default viewport state pairs.
7. Run `npm run verify:product`; use `npm run verify:release` when packaged
   discovery, permissions, signing, or native shell behavior is affected.

## 5. Close with a receipt

Report function, persistence, visual, desktop-process, and packaged evidence
separately. A user-visible contradiction revokes the corresponding claim. Find
the missing invariant, update the contract and executable gate, and reopen
sibling features that share the same owner before closing the defect class.
