# Testing Strategy

AgentEnv Manager changes local Agent files, so selector coverage alone is not a
release argument. Verification is layered by the claim it can prove.

## Target contract gate

`npm run test:targets` runs the same conformance suite against every built-in
Target adapter:

- command-based installation detection;
- read-only Capture;
- Profile A to B replacement;
- restart persistence and semantic no-op;
- Instructions, Skills, and MCP ownership policies;
- stale Preview rejection;
- exact rollback after an injected late failure.

The suite snapshots file type, content hash, permissions, and symbolic-link
target. An automatic rollback passes only when the complete Agent filesystem
tree matches its pre-Apply state.

The validated machine-scenario corpus in
`tests/fixtures/target-homes/compatibility.json` covers current and legacy
directories, shared roots, plugin-owned Skills, broken and collection links,
duplicates, nested discovery, environment overrides, and alternate layouts.
Fixture inspection compares bytes and timestamps and must remain read-only.
Use `npm run test:scenario -- <scenario-id>` to reproduce one topology. The
catalog contract and contribution workflow are documented in
`docs/customer-environment-testing.md`.

The same gate runs on macOS, Windows, and Linux. Platform-specific scenarios
declare that boundary explicitly; every built-in Target retains at least three
native scenarios on each supported platform.

## Mutation and upgrade safety gate

The Activation failure matrix injects failure at six transaction phases from
backup creation through final state persistence. A failure passes only when the
complete Agent tree and canonical Skill source match their pre-operation
snapshots. Read-only and semantic no-op checks additionally compare size and
modification time.

The application-data upgrade matrix covers fresh, unversioned, v1, partially
damaged, unsafe, and future-format roots. Failed migrations must restore the
exact active tree. Startup recovery fixtures verify that interrupted Apply,
rollback, and corrupt Target state remain fail-closed without touching live
Agent files.

## Specialized integration tests

Target-specific parsers and edge cases remain in `tests/main/targets`. Capture,
Apply, shared-location migration, backup, and recovery have service-level tests
under `tests/main` and `tests/e2e`.

`npm test` is the complete source-level gate. New Targets must pass the common
contract before Target-specific tests are accepted as sufficient.

## Test scheduling

Development verification has four explicit levels:

| Command | Purpose | Electron coverage |
|---|---|---|
| `npm run test:quick` | Type-check and run tests related to the current worktree changes, plus applicable audits | Deferred and stated in the result |
| `npm run test:feature -- <name>` | Verify one registered feature through unit, Renderer, and selected desktop evidence | Only the registered feature scenarios |
| `npm run verify:commit` | Complete source suite and every static product audit | Complete |
| `npm run verify:release` | Commit gate plus visual and packaged-runtime evidence | Complete plus packaged smoke |

`npm test` remains an alias for the complete `test:full` gate. Quick and feature
commands never replace commit, CI, or release verification, and their output
must state that unselected Electron scenarios were not run.

`test:quick` reads tracked and untracked changes relative to `HEAD` (or
`AGENTENV_TEST_BASE`), always runs TypeScript, uses Vitest's dependency graph
for related tests, widens shared IPC/Renderer boundaries to their contract
tests, and selects architecture audits from the changed ownership area. It
never launches Electron. Shared UI primitive or token changes additionally run
the primitive fixture tests and `audit:ui-contracts`; the complete commit gate
then proves the registered sibling-page geometry in rebuilt Electron.

Most Vitest files are parallel-safe. Files that launch a real Electron process
share operating-system resources such as application lifecycle, focus, native
dialogs, ports, and process teardown, so they are a separate scheduling class.

`scripts/vitest-groups.mjs` is the single owner of that class. `npm test`,
`npm run test:e2e`, and the product verifier all:

1. run the parallel-safe files;
2. exclude every real-Electron file from that pass;
3. list the complete real-Electron test inventory through Vitest;
4. distribute the large Electron UI file across two isolated Vitest processes;
5. after the first UI shard completes, use that released process slot to run
   the remaining Electron files individually while the slower shard finishes;
6. compare the union of executed assertions with the original inventory and
   fail on any missing, duplicate, or unexpected test.

The Electron UI shards change scheduling only. Test bodies, timeouts, Fake Home
isolation, assertions, and the total executed count remain unchanged. Set
`AGENTENV_ELECTRON_WORKERS=1` to diagnose focus-sensitive host behavior with
the original single-process ordering. Values above two are supported for local
experiments but are not the default verification contract.

The verification snapshot records both groups and their assertion totals.
Adding a desktop-process test requires adding its file to the shared group
definition; ad hoc duplicate include/exclude lists are not allowed. A launch
helper may retry a bounded startup once to absorb a failed process spawn, but
an assertion, product error, or persistence failure is never retried.

## Electron artifact identity

`npm run build` writes `out/.agentenv-build.json` after compilation. It binds:

- the Renderer, main, preload, build configuration, TypeScript configuration,
  package manifest, and lockfile used as build inputs;
- the exact compiled files under `out/`.

Electron E2E and UI capture entry points reject a missing, modified, or stale
identity before launching the desktop process. `npm test` builds first so the
complete suite cannot accidentally exercise an older `out/`.

`npm run verify:product` binds the source fingerprint, compiled-artifact
fingerprint, tests, audits, and capture manifest into
`docs/verification-snapshot.json`. `npm run verify:current` is the inexpensive
check that all three identities still match. A source, E2E, screenshot, or
packaged claim is invalid when the corresponding identity is stale.

## Visual regression gate

`npm run verify:visual` captures the critical states declared in
`tests/visual/critical-captures.json` and compares them with checked-in golden
images. The fixture clock and repository commit dates are fixed, and Chromium
uses a fixed device scale factor so timestamps and raster scale do not create
false changes.

The pixel comparator allows a small per-channel tolerance and a one-pixel
neighborhood match for platform antialiasing. The configured changed-pixel
ratio remains intentionally low enough to reject a different page, missing
content, clipping, or meaningful layout movement. Dense, high-risk regions are
captured independently and use stricter per-image thresholds so a small local
regression cannot hide inside an otherwise unchanged window. A baseline may be updated
only after a cold pixel review, a repeat capture, and a deliberate fault that
proves the comparator still fails.

The critical pixel set complements the complete capture manifest. It does not
replace geometry, keyboard, localization, overlay, or persistence assertions.

## Desktop and packaged evidence

The Electron UI E2E covers visible workflows, supported viewport geometry,
feedback, dialogs, navigation, and persisted effects.
Each Electron E2E file or deterministic UI shard runs in a fresh Vitest process
so Electron, Playwright, timers, and native handles cannot leak into another
execution boundary. Smaller Electron files remain serial with each other; they
may overlap only with the final heavy shard, keeping the global limit at two
Electron processes.

`npm run test:e2e:packaged` rebuilds the application for the current operating
system and then verifies:

- all built-in Agent commands are discovered from Finder-like launch paths;
- all six built-in Targets can Apply Instructions and a Skill through the
  packaged preload/IPC/main-process boundary;
- Target lifecycle state survives an application restart;
- the Repository import workflow works with the packaged system Git path;
- the default viewport has no page-level horizontal overflow.

Passing source tests does not imply packaged behavior passed. Release evidence
must state both results separately and must come from a native runner for each
claimed operating system. Linux uses Xvfb only as a display host; Windows,
Linux, and macOS all execute the packaged Electron binary.

DMG checksum and mount verification establish package-container integrity only.
The current macOS release is not notarized. Direct and distinctly named Homebrew
DMGs use the same fixed project-created identity. Release validation requires
`codesign --verify` to accept every complete application resource seal, confirms
the same certificate and designated requirement across channels and architectures,
and requires `spctl --assess`
to reject both because neither has Developer ID or notarization. The official Cask
pins only the Homebrew asset and SHA-256, then removes quarantine after verification.
This must not be described as Developer ID signed, notarized, or approved by Gatekeeper.

## Installed Agent probe

`npm run test:compat:installed` reports the locally installed command and
version for every supported Agent without mutating its files. It is advisory by
default. To require selected Agents:

```bash
AGENTENV_REQUIRE_REAL_AGENTS=codex,opencode npm run test:compat:installed
```

This probe proves executable compatibility only. It does not replace isolated
filesystem tests or packaged Apply verification.
