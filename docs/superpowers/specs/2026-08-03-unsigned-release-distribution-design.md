# Verified Desktop Release Distribution Design

## Goal

AgentEnv Manager publishes reproducible desktop packages through GitHub Actions,
installs on macOS through the official `chroming/tap/agentenv-manager` Cask,
removes quarantine only after Homebrew has verified the exact package checksum,
checks and installs updates without terminal interaction, and optionally reports a
small allowlisted set of anonymous reliability facts.

This release line does not use a Developer ID identity or Apple notarization.
Direct-download macOS assets use an ad-hoc resource seal so quarantine can enter
the ordinary explicit Open Anyway flow. The Homebrew-only DMG uses a fixed
project-created identity so Keychain and privacy identity remain stable after
the Cask verifies the checksum and removes quarantine. Neither signature provides
Apple-verified publisher identity or Gatekeeper trust. The public fixed-identity
certificate is pinned in the repository; its private key exists only in the
release maintainer's protected backup and GitHub Actions secrets. The distribution trust boundary
is the official GitHub repository, immutable versioned assets, the official Tap,
exact SHA-256 values, and package identity checks.

## Release Contract

- `package.json` is the version source of truth. A `vX.Y.Z` tag must match it.
- A release is assembled from already-tested workflow artifacts. Build jobs never
  publish public assets independently.
- macOS produces direct arm64/x64 DMG and ZIP artifacts plus a distinctly named
  `-homebrew.dmg` for each architecture. Windows produces NSIS and Linux produces
  AppImage and DEB artifacts.
- Direct and local macOS builds use `mac.identity: "-"`. The Homebrew package uses
  the fixed certificate in `build/macos-signing-certificate.pem`. Hardened runtime
  and notarization remain disabled. Release jobs require `codesign --verify` for
  both variants, require `Signature=adhoc` for direct assets, reject ad-hoc fallback
  for Homebrew assets, pin the Homebrew designated requirement, and require
  `spctl --assess` to reject both Apps.
- Every public asset is named with its version, platform, architecture, and the
  `homebrew` channel suffix where applicable.
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
- GitHub Release downloads keep quarantine. Users first copy the App to Applications
  and eject the DMG, then approve that installed copy through System Settings >
  Privacy & Security > Open Anyway and the final Open confirmation. This route is a
  best-effort fallback because organization-managed Macs may forbid the exception;
  the verified Cask is the reliable no-Developer-ID installation path.

## Update Contract

- The main process owns update network access and process execution. The renderer
  cannot provide repository URLs, executable paths, or command arguments.
- Update checks contact only `chroming/agentenv-manager`, ignore drafts and
  prereleases on the stable channel, reject downgrades, and validate expected
  asset identity before reporting an update.
- Homebrew installations update through the official Cask and preserve the
  directory containing the running App by passing it as an explicit `--appdir`.
  Direct installations in a writable Applications folder update from the exact
  architecture-specific ZIP named in the trusted Release response or manifest.
- A packaged GUI discovers Homebrew independently of shell `PATH` and invokes an
  absolute executable with argument arrays, never a constructed shell command.
- The app may prefetch an update. Installation runs only when no mutating AgentEnv
  operation is active and the user closes the app or explicitly chooses restart.
- Homebrew owns the application-bundle transaction and verifies the Cask SHA-256.
  After upgrade, AgentEnv verifies that Homebrew reports the exact expected
  version before restarting. The canonical data directory is outside the bundle
  and is never part of the update transaction.
- Direct updates stream to a private cache with a fixed size ceiling and SHA-256
  verification, then verify the extracted bundle identifier, version, and complete
  `codesign` resource seal. A detached helper preserves the current App, commits a
  same-directory staged bundle, and removes the backup only after the new process
  confirms startup. A failed launch or missing confirmation restores and relaunches
  the previous App. The helper never touches AgentEnv data.
- Browser-downloaded Release packages retain quarantine for their first install.
  The in-app updater may clear quarantine only from the already hash-verified,
  identity-verified replacement bundle. A read-only App location remains check-only
  and links to the official Release instead of requesting administrator credentials.
- Install-on-quit belongs only to Homebrew. Direct updates require the explicit
  `Restart and update` action so the replacement helper can observe and verify the
  complete process handoff.
- Update states are `disabled`, `idle`, `checking`, `up-to-date`, `available`,
  `downloading`, `ready`, `installing`, and `failed`. Failures are selectable and
  copyable and never block normal application use.

## Telemetry Contract

- Existing GitHub Release download counts and Homebrew aggregate analytics are
  the baseline distribution metrics.
- Official builds enable one anonymous daily startup event by default. Users can
  disable it at any time in `Settings > Data > Privacy`; an information popover
  and expandable preview disclose the complete field allowlist. Existing explicit
  opt-outs remain off. Update checks do not depend on telemetry state.
- The payload allowlist is limited to schema version, local event date, app
  version, OS family and major version, architecture, locale, and install channel.
- Paths, usernames, Agent names, Profile and Skill identity/content, source URLs,
  conversations, prompts, MCP data, environment values, account identity, raw
  command output, and raw stack traces are forbidden.
- Official builds send directly to the PostHog Cloud capture endpoint with no
  analytics SDK. The public project token is compile-time configuration and is
  never presented as a secret. Each application data directory receives a random
  installation identifier that is unrelated to hardware or account identity.
  Events disable person-profile creation and GeoIP enrichment.
- The client uses a short timeout, one-event-per-day local deduplication, and
  silent failure. Telemetry can
  never delay startup, shutdown, Apply, update, or recovery.
- Official builds opt into a compile-time PostHog project token and US/EU Cloud
  host. Forks without a token do
  not send data. Settings provides a human-readable payload preview.

## Evidence

- Domain tests cover version matching, release asset validation, Homebrew path
  discovery, direct ZIP size/hash/bundle validation, startup-confirmation path
  containment, update state transitions, downgrade rejection, telemetry allowlists,
  opt-out, and network failure.
- Renderer tests cover Settings controls and idle/working/result/error states.
- Electron E2E covers update checks with a fake GitHub endpoint and fake Homebrew,
  a generated signed direct-update ZIP through the ready-to-install boundary,
  persistence across restart, and update failure feedback.
- Cask tests install into a temporary app directory, verify the checksum-bound
  artifact, assert quarantine is absent, launch the packaged app, and exercise an
  upgrade fixture.
- Release verification binds the tag, commit, build fingerprint, pinned signing
  certificate, stable designated requirement, resource seal, expected Gatekeeper
  rejection, packaged smoke, asset hashes, manifest,
  and generated Cask into one evidence receipt.
