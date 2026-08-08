# Incremental Architecture Hardening

## Product decision

Harden the current architecture in small, behavior-preserving stages. The work reduces failure blast radius and module ownership ambiguity without changing what users can do, where data is stored, or how any Agent is managed.

```text
Core outcome -> existing workflows remain reliable while future changes become easier to isolate and verify
Constraint -> preserve persistence, IPC channels, Target contracts, and visible product behavior
Boundary -> extract owners behind existing facades; do not redesign workflows during this work
Completion -> each stage lowers an enforced module budget and passes the evidence appropriate to its layer
```

## Feature Admission Card

### Core user outcome

An unexpected Renderer failure produces a recoverable diagnostic screen instead of a blank window. All normal workflows otherwise retain their current states, effects, and recovery behavior.

### Object, owner, scope, and source of truth

- The top-level Renderer boundary owns only uncaught render failures and their recovery commands.
- `App.tsx` remains the composition root. Extracted controllers own orchestration state for backup recovery, GitHub connection, and settings workflows.
- `SkillLibraryPanel` remains the public Skill Library surface. This stage replaces its wide public prop surface with one typed model/actions contract; deeper task-view extraction remains separately releasable work.
- IPC registration remains the bridge between the preload channel contract and main services. Domain registrars group handlers; central diagnostic and mutation wrappers continue to own operation logging, serialization, locking, and error normalization.
- Main-service facades remain the source of truth for Skill Library and activation behavior. Internal modules may split planning, reading, execution, verification, cleanup, and recovery responsibilities without changing their public interfaces.

### Non-goals

- No persistence schema, data-root, migration, Backup, rollback, or recovery-format change.
- No IPC channel, preload API, payload schema, or error-envelope change.
- No Target capability, discovery, Capture, Preview, Apply, no-op, ownership, or rollback behavior change.
- No new dependency, global state library, router, page model, or Context replacement for prop drilling.
- No dynamic i18n loading, translation-bundle split, or startup loading-state change.
- No visual redesign beyond the Renderer failure fallback.

### Capability matrix

| Area | macOS | Windows | Linux | Agent-specific behavior |
|---|---|---|---|---|
| Renderer recovery boundary | supported | supported | supported | none |
| Renderer controller and panel extraction | supported | supported | supported | unchanged |
| IPC domain registrars | supported | supported | supported | channel contracts unchanged |
| Main-service internal split | supported | supported | supported | all registered Target facades unchanged |

## Architecture boundaries

### Renderer error boundary

Add one application-level error boundary outside the normal workspace tree. It catches uncaught render errors, reports the sanitized failure through the existing diagnostics path, and shows a stable fallback with `Reload`, `Export diagnostics`, and `Quit` actions where supported.

The fallback must not attempt to render the failed page tree or mutate persisted product data. Reload is explicit; repeated failures remain on the fallback. Event-handler and main-process failures continue through their existing feedback and diagnostic paths because React error boundaries do not own them.

### `App.tsx` controller extraction

Extract three focused hooks while keeping `App.tsx` as the composition root:

- backup recovery: listing, selection, preview, restore, delete, and local operation state;
- GitHub connection: availability, device flow, polling, cancellation, refresh, and disconnect;
- settings: draft settings, validation, save/no-op, refresh, and section operation state;

Each controller exposes `{ state, actions }`. It may call existing preload APIs and domain helpers, but must not own JSX, duplicate persisted data, introduce a global Context, or conceal cross-domain side effects. Existing Profile controllers remain unchanged unless a mechanical call-site adjustment is required.

### `SkillLibraryPanel` public boundary

The public boundary receives exactly one `SkillLibraryViewModel` and one `SkillLibraryActions` object.
The view model groups derived display state and operation identity; actions group stable commands. The
panel does not call `window.agentEnv` directly. Existing internal presentation remains in place in this
stage so contract extraction is not mixed with a large JSX move that would need its own visual evidence.

### IPC domain registrars

Split handler registration by domain, such as conversations, workspaces, Skills, Profiles, settings, and recovery. Registrars receive the already-created services and the shared registration helpers.

The existing central wrappers remain authoritative:

- diagnostic wrapper: operation identity, duration, sanitized context, result classification, and diagnostic reference;
- mutation wrapper: exclusive mutation coordination and shared refresh/invalidation behavior;
- workspace-sync mutation wrapper: existing synchronization transaction semantics.

Registrars must reuse those wrappers. Channel names, payload validation, return values, preload exposure, logging semantics, and registration order dependencies remain unchanged.

### Main-service internals

Split only behind unchanged facades and only where characterization tests establish current behavior:

- Skill Library internals may separate reads/indexing, source inspection, update planning, import, cleanup, and recovery;
- activation internals may separate planning, execution, post-write verification, and compensating recovery.

The facade remains the only caller-visible API. Internal extraction must not change ordering, hashes, path normalization, ownership decisions, error text relied on by contracts, mutation locking, Backup timing, atomic-write guarantees, or stale-input checks.

## State and effect contract

| State | Required meaning | Durable or external effect |
|---|---|---|
| Idle | Current product state and commands match the existing UI | None |
| Working | The initiating control retains operation-local progress and cancellation rules | Existing effect only |
| Success | Existing result and refresh semantics are preserved | Existing verified write, if any |
| Semantic no-op | Equivalent input produces the same user-visible no-op and no write | No write, Backup, history churn, or Target change |
| Stale input | Existing freshness check rejects or refreshes the operation at the same boundary | No unverified write |
| Error | Existing domain errors retain their actionable feedback; uncaught render errors use the new fallback | No additional mutation |
| Cancelled | Existing cancellation boundary and partial-work cleanup remain intact | No new partial persistence |
| Recovery | Existing Backup, rollback, startup recovery, and compensating restore remain authoritative | Restores the previously defined state |

Controller extraction must preserve in-flight operation identity across rerenders and navigation where the current product does. Moving code must not turn a no-op into an error, make an error global when it was local, or add retries that repeat a mutation.

## Module budget ratchet

`scripts/audit-module-budgets.mjs` is an architectural gate, not a target to game.

1. Record the current line count before each stage.
2. After extracting an owner, lower the original module's ceiling to its new count or a slightly smaller reviewed ceiling.
3. Add focused extracted modules to the budget only when they could plausibly become new aggregation points.
4. Never raise an existing ceiling in the same change that exceeds it.
5. Count reduction alone is insufficient: tests must prove that state and effects still belong to the intended owner.

The sequence for this stage is Renderer boundary, selected `App.tsx` controllers, the `SkillLibraryPanel`
public contract, IPC registrars, then narrow pure main-service helpers. Deeper view and mutation-service
splits remain independent follow-up stages.

## Evidence and completion boundary

Every stage records evidence at the layers it can affect:

- Domain: characterization and unit tests for state derivation, no-op, stale, error, cancellation, and recovery semantics.
- Renderer: controller/component tests for idle, working, result, error, and fallback commands.
- Geometry and pixels: rebuilt Electron captures for the error fallback and any mechanically changed Skill Library state at minimum, default, and large supported viewports in all three locales.
- Desktop process: Electron E2E proves the current preload bridge, operation feedback, navigation, diagnostics export, and affected end-to-end workflows.
- Persistence: fake-home tests compare files, hashes, Backups, history, and Target state before and after representative success, no-op, failure, and rollback paths.
- Package: packaged smoke is required only when startup, preload, native discovery, or process behavior changes; pure internal extraction still requires a rebuilt current artifact before Electron evidence.

`docs/feature-evidence.json` and critical captures must be updated when a stage adds a new fallback state or changes an evidence owner. Existing green tests cannot prove a newly introduced boundary without an explicit test at that boundary.

This hardening stage is complete when the Renderer can recover from an uncaught render failure, the named
orchestration and public-boundary responsibilities have explicit owners, central IPC safety wrappers remain
singular, service facades preserve every observable contract, module ceilings ratchet downward, and the full
product verification suite passes against the rebuilt artifact with no persistence, IPC, Target, or normal-workflow
behavior change. Remaining monolith decomposition is tracked as follow-up work, not implied complete by this stage.
