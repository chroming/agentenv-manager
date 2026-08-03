# Unsigned Release Distribution Design

## Goal

AgentEnv Manager publishes reproducible desktop packages through GitHub Actions,
installs on macOS through the official `chroming/tap/agentenv-manager` Cask,
removes quarantine only after Homebrew has verified the exact package checksum,
checks and installs updates without terminal interaction, and optionally reports a
small allowlisted set of anonymous reliability facts.

This release line does not use a Developer ID identity or Apple notarization.
The trust boundary is the official GitHub repository, immutable versioned assets,
the official Tap, exact SHA-256 values, and package identity checks.

## Release Contract

- `package.json` is the version source of truth. A `vX.Y.Z` tag must match it.
- A release is assembled from already-tested workflow artifacts. Build jobs never
  publish public assets independently.
- macOS produces arm64 and x64 DMG and ZIP artifacts. Windows produces NSIS and
  Linux produces AppImage and DEB artifacts.
- Every public asset is named with its version, platform, and architecture.
- The release includes `SHA256SUMS`, a CycloneDX SBOM, and
  `release-manifest.json` containing repository, tag, version, asset size,
  SHA-256, architecture, and build fingerprint.
- Mutable download URLs, `version :latest`, and `sha256 :no_check` are forbidden.
- The release is created as a draft and becomes public only after the complete
  asset set has been downloaded and verified.
- Existing tags or Releases are immutable and are never replaced in place.

## Homebrew Contract

- The source template lives in this repository and is published to
  `chroming/homebrew-tap/Casks/agentenv-manager.rb` after a Release succeeds.
- Tap publication uses an Ed25519 Deploy Key with write access only to
  `chroming/homebrew-tap`. The workflow pins GitHub's published host key and
  never stores an account-wide GitHub token.
- Users install with one command:

  ```sh
  brew install --cask chroming/tap/agentenv-manager
  ```

- The Cask selects an architecture-specific, exact-tag DMG and exact SHA-256.
- `postflight` removes `com.apple.quarantine` from the installed
  `AgentEnv Manager.app` using the configured `appdir`, never a hard-coded
  `/Applications` path.
- Quarantine removal happens only after Homebrew's checksum verification.
- Uninstall removes the application but never removes AgentEnv canonical data.

## Update Contract

- The main process owns update network access and process execution. The renderer
  cannot provide repository URLs, executable paths, or command arguments.
- Update checks contact only `chroming/agentenv-manager`, ignore drafts and
  prereleases on the stable channel, reject downgrades, and validate expected
  asset identity before reporting an update.
- Homebrew is the only macOS update installer in the first release. The app may
  check for updates when installed directly, but automatic installation requires
  a Homebrew-managed installation.
- A packaged GUI discovers Homebrew independently of shell `PATH` and invokes an
  absolute executable with argument arrays, never a constructed shell command.
- The app may prefetch an update. Installation runs only when no mutating AgentEnv
  operation is active and the user closes the app or explicitly chooses restart.
- Homebrew owns the application-bundle transaction and verifies the Cask SHA-256.
  After upgrade, AgentEnv verifies that Homebrew reports the exact expected
  version before restarting. The canonical data directory is outside the bundle
  and is never part of the update transaction.
- Update states are `disabled`, `idle`, `checking`, `up-to-date`, `available`,
  `downloading`, `ready`, `installing`, and `failed`. Failures are selectable and
  copyable and never block normal application use.

## Telemetry Contract

- Existing GitHub Release download counts and Homebrew aggregate analytics are
  the baseline distribution metrics.
- Application telemetry is disabled by default and requires an explicit Settings
  choice. Update checks do not depend on telemetry consent.
- The payload allowlist is limited to schema version, app version, OS family and
  major version, architecture, locale, install channel, a daily startup outcome,
  update outcome codes, and stable startup failure categories.
- Paths, usernames, Agent names, Profile and Skill identity/content, source URLs,
  conversations, prompts, MCP data, environment values, account identity, raw
  command output, and raw stack traces are forbidden.
- The client uses a short timeout, bounded queue, and silent failure. Telemetry can
  never delay startup, shutdown, Apply, update, or recovery.
- Official builds opt into a compile-time endpoint. Forks without an endpoint do
  not send data. Settings provides a human-readable payload preview.

## Evidence

- Domain tests cover version matching, release asset validation, Homebrew path
  discovery, update state transitions, downgrade rejection, telemetry allowlists,
  opt-out, and network failure.
- Renderer tests cover Settings controls and idle/working/result/error states.
- Electron E2E covers update checks with a fake GitHub endpoint and fake Homebrew,
  persistence across restart, and update failure feedback.
- Cask tests install into a temporary app directory, verify the checksum-bound
  artifact, assert quarantine is absent, launch the packaged app, and exercise an
  upgrade fixture.
- Release verification binds the tag, commit, build fingerprint, packaged smoke,
  asset hashes, manifest, and generated Cask into one evidence receipt.
