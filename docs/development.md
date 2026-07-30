# Development

AgentEnv Manager is an Electron application for macOS. Development and CI use
the npm lockfile and Node.js 22.12 or newer.

## Setup

```bash
npm ci
AGENTENV_DATA_ROOT=.agentenv-runtime npm run dev
```

Use `npm install` only when intentionally changing dependencies and commit the
resulting `package-lock.json`.

## Safe Local Data

The application can read and modify supported Agent directories. Do not use
your normal home while developing filesystem behavior.

Use both an isolated AgentEnv data root and an isolated Agent home:

```bash
export AGENTENV_DATA_ROOT="$PWD/.agentenv-runtime/data"
export AGENTENV_HOME="$PWD/.agentenv-runtime/home"
npm run dev
```

Automated tests create their own temporary homes. Test fixtures must never
depend on a contributor's real Agent configuration, credentials, repositories,
or conversation history.

## Architecture

```text
src/main/       Electron main process, filesystem ownership, backup and IPC
src/preload/    narrow context-isolated renderer API
src/renderer/   React interface
src/shared/     cross-process types and schemas
tests/main/     filesystem and domain tests
tests/renderer/ renderer behavior tests
tests/e2e/      Electron and packaged-runtime tests
```

Filesystem effects belong in the main process. Renderer code requests domain
operations through the preload contract and must not receive unrestricted
filesystem or shell access.

Large modules have executable growth budgets in
`scripts/audit-module-budgets.mjs`. Profile draft/activation/navigation,
Skill Library import, Target-state persistence, and device-local Skill management-boundary
persistence have dedicated owners instead of accumulating inside workspace
components or the main process entry point.

Renderer CSS is imported through `src/renderer/ui/index.css`. Shared controls,
overlays, accessibility behavior, and each page family have explicit owners.
Page styles must not redefine shared primitive roots, introduce page-owned
animation systems, or create unregistered cross-file selector ownership.
`npm run audit:styles` and `npm run audit:modules` enforce these boundaries.

Profile Apply follows this sequence:

1. read fresh Target state;
2. create a semantic Preview;
3. reject stale or unsafe ownership assumptions;
4. create a backup;
5. stage and atomically replace owned resources;
6. verify the result;
7. recover or roll back after failure.

## Target Integrations

Built-in integrations currently cover OpenCode, Claude Code, Codex,
Antigravity, and Trae CLI. Target-specific installation evidence, paths,
Instructions, Skills, native MCP behavior, capture, and deployment facts live
under `src/main/targets/integrations/`.

Shared activation, Library, Profile, and Renderer code must not branch on a
concrete Target ID. Start a new integration with:

```bash
npm run target:new -- example-agent
```

See [development/adding-a-target.md](development/adding-a-target.md) for the
contract and verification matrix.

## Verification

Fast development loop:

```bash
npm run build
npm test
```

Target, filesystem, or user-flow changes:

```bash
npm run test:e2e
```

Packaged discovery, signing-sensitive, or sparse-`PATH` changes:

```bash
npm run test:e2e:packaged
```

Complete product gate:

```bash
npm run verify:product
```

The gate runs tests and architecture/style/translation audits and refreshes
`docs/verification-snapshot.json`.

Before a release, include the packaged runtime smoke and record it in the same
snapshot:

```bash
npm run verify:release
```

See [README.md](README.md) for the authoritative document map, visual-baseline
review procedure, and the distinction between packaged smoke and signed public
distribution.

## Release Builds

Unsigned local application:

```bash
npm run pack
```

Signed and notarized release:

```bash
npm run dist:mac:signed
```

Signing credentials belong in Keychain or environment-backed CI secrets. Never
commit `.env` files, certificates, API keys, app-specific passwords, or private
repository credentials.
