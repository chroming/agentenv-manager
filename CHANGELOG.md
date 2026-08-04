# Changelog

All notable changes will be documented in this file.

The format follows Keep a Changelog conventions. AgentEnv Manager uses semantic
versioning after its first stable release.

## [Unreleased]

## [0.1.1] - 2026-08-05

### Fixed

- Prompt for installed Agents once on upgraded installations as well as clean
  installations, then persist the reviewed selection.
- Apply a captured Profile after resolving duplicate runtime Skill names without
  blocking again on the copy already scheduled for backup and removal.
- Align Agents and Skill Library list headers at every supported window size.
- Publish separate ad-hoc direct-download and fixed-identity Homebrew macOS
  assets so direct downloads can use macOS Open Anyway while Homebrew retains a
  stable Keychain identity.

## [0.1.0] - 2026-08-04

Initial public release.

### Added

- Reusable Profiles with capture, Preview, Apply, drift detection, backup,
  rollback, and per-resource management modes.
- A shared Skill Library with local and Git imports, source groups, update
  review, duplicate cleanup, global disabling, and safe Agent deployment.
- OpenCode, Claude Code, Codex, Antigravity CLI, Trae CLI, and Pi Coding Agent
  integrations behind independent Target adapters.
- Read-only conversation search and explicit cross-Agent continuation.
- Portable Profile and Skill Workspace Sync through a user-owned Git repository.
- Isolated two-run Profile Compare for supported Agents, with responses, file
  changes, duration, and CLI-reported usage.
- English, Simplified Chinese, and Traditional Chinese interfaces.
- Native packaging targets for macOS, Windows, and Linux, plus packaged runtime
  and visual verification gates.
- Open-source repository governance, dependency audit gates, verified unsigned
  release automation, and an official Homebrew Cask.

### Security

- Previewed, backed-up, atomic, and recoverable filesystem changes.
- Secure GitHub OAuth token storage, diagnostic redaction, bounded comparison
  reports, temporary Agent homes, and source-folder integrity checks.
