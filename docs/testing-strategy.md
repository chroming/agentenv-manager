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

Machine-layout fixtures in
`tests/fixtures/target-homes/compatibility.json` cover current and legacy
directories, shared root links, plugin-owned Skills, broken links, and Trae CLI
v1/v2 selection. Fixture inspection must remain read-only.

## Specialized integration tests

Target-specific parsers and edge cases remain in `tests/main/targets`. Capture,
Apply, shared-location migration, backup, and recovery have service-level tests
under `tests/main` and `tests/e2e`.

`npm test` is the complete source-level gate. New Targets must pass the common
contract before Target-specific tests are accepted as sufficient.

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

## Desktop and packaged evidence

The Electron UI E2E covers visible workflows, supported viewport geometry,
feedback, dialogs, navigation, and persisted effects.

`npm run test:e2e:packaged` rebuilds the macOS application and then verifies:

- all built-in Agent commands are discovered from Finder-like launch paths;
- all six built-in Targets can Apply Instructions and a Skill through the
  packaged preload/IPC/main-process boundary;
- Target lifecycle state survives an application restart;
- the Repository import workflow works with the packaged system Git path;
- the default viewport has no page-level horizontal overflow.

Passing source tests does not imply packaged behavior passed. Release evidence
must state both results separately.

## Installed Agent probe

`npm run test:compat:installed` reports the locally installed command and
version for every supported Agent without mutating its files. It is advisory by
default. To require selected Agents:

```bash
AGENTENV_REQUIRE_REAL_AGENTS=codex,opencode npm run test:compat:installed
```

This probe proves executable compatibility only. It does not replace isolated
filesystem tests or packaged Apply verification.
