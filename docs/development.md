# Development

AgentEnv Manager is an Electron application for macOS, Windows, and Linux. Development and CI use
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

## Substantial Features

Before implementing a new workflow, persistent object, external effect, or
user-visible surface, complete the admission gate in
[development/feature-delivery.md](development/feature-delivery.md). Register
the capability in `docs/feature-evidence.json` before relying on the existing
suite: an old passing suite cannot prove a state it does not know exists.

`npm run audit:features` verifies Target coverage, state semantics, evidence
paths, and critical visual artifacts. A partially supported capability must be
presented and registered as partial; shared interfaces do not imply support.

## Target Integrations

Built-in integrations currently cover OpenCode, Claude Code, Codex,
Antigravity CLI, Trae CLI, and Pi Coding Agent. Target-specific installation
evidence, paths, Instructions, Skills, native MCP behavior, capture, and
deployment facts live under `src/main/targets/integrations/`.

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
npm run test:quick
```

Registered feature checkpoint:

```bash
npm run test:feature -- agent-discovery
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

Before creating a commit, run the complete source and audit gate:

```bash
npm run verify:commit
```

The gate runs tests and architecture/style/translation audits and refreshes
`docs/verification-snapshot.json`.

Before a release, include the packaged runtime smoke and record it in the same
snapshot:

```bash
npm run verify:release
```

See [README.md](../README.md) for the authoritative document map and
visual-baseline review procedure.

## Release Builds

Ad-hoc signed local application:

```bash
npm run pack
```

Platform installers:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

`npm run test:platform` owns pure platform-policy tests. Native macOS, Windows,
and Linux CI build platform packages and run packaged workflows against an
isolated home with fake Agent commands. This proves the packaged Electron
binary starts and exercises the tested preload, IPC, persistence, Git import,
and six-Agent Apply paths. It does not prove every real third-party CLI version
or each graphical installer flow.

The tag workflow in `.github/workflows/release.yml` is the public release owner.
It requires an exact `vX.Y.Z` match with `package.json`, builds macOS arm64 and
x64 plus Windows and Linux packages on native runners, and assembles one draft
Release. It publishes only after downloading the complete artifact set and
verifying checksums, the release manifest, and the generated Cask. The final
step updates `chroming/homebrew-tap` with the repository-scoped
`HOMEBREW_TAP_DEPLOY_KEY`.

Every tag must also include non-empty, user-facing notes at
`docs/releases/vX.Y.Z.md`. Summarize observable fixes and improvements, call out
important limitations, and include the update commands users need. The workflow
publishes that file verbatim as the GitHub Release description and rejects tags
that only provide generated commit links.

The current macOS distribution is not notarized. Direct Release and local
`dist:mac` builds are ad-hoc signed. Release jobs also produce a distinctly named
Homebrew DMG with the fixed project-created certificate in
`build/macos-signing-certificate.pem`. They import the matching private identity
from `MACOS_SIGNING_P12_BASE64` and `MACOS_SIGNING_P12_PASSWORD`, require both
resource seals to pass `codesign --verify`, pin the Homebrew designated requirement,
and require Gatekeeper to reject both variants through `spctl --assess`.
For a locally shared package, run `npm run signing:mac:trust` once while at the
Mac to approve the signing certificate, then use `npm run dist:mac:stable`.
That command uses the persistent keychain under
`~/.config/agentenv-manager/release-signing`, pins the same certificate as CI,
and verifies the Homebrew variant does not fall back to ad-hoc signing.
`dist:mac:release` is the low-level dual-asset CI entrypoint. The generated Cask binds
each architecture to its immutable `-homebrew.dmg` URL and SHA-256, then removes
quarantine only after Homebrew verifies the downloaded DMG. Direct GitHub Release
downloads keep quarantine: documentation MUST tell users to copy the App to
Applications and eject the DMG before approving that installed copy through both
Open Anyway and the final Open confirmation. Managed-device policy may still forbid
that exception, so this route MUST NOT be described as equally reliable to Homebrew.
After first install, a direct App in a writable Applications folder can update in
app from the official ZIP. The updater verifies the immutable Release URL, size,
SHA-256, bundle ID, version, and complete resource seal before a detached helper
replaces the bundle. The helper retains the old App until the new process confirms
startup and rolls back automatically if confirmation fails. This does not change
the first-install quarantine contract or grant administrator privileges.
The pinned certificate SHA-256 is
`2D7F57ABF24737A6880D98E9684ABF3B553EB95D896A4D31627B2626D6F09837`.
Changing this certificate changes the macOS code identity and can cause Keychain
or privacy permission prompts. Treat rotation as a deliberate migration. Users
switching from a direct ad-hoc installation to the Homebrew channel may show one
Keychain confirmation; subsequent Homebrew releases share the same designated requirement.
Never commit tokens, private certificates or keys, API keys, app-specific
passwords, or private repository credentials. The public signing certificate is
intentionally committed so Release verification can pin the expected signer.
