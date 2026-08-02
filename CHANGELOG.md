# Changelog

All notable changes will be documented in this file.

The format follows Keep a Changelog conventions. AgentEnv Manager uses semantic
versioning after its first stable release.

## [Unreleased]

- Open-source repository governance, dependency audit gates, and signed release
  automation.

## [0.1.0] - Unreleased

Initial pre-release implementation.

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

### Security

- Previewed, backed-up, atomic, and recoverable filesystem changes.
- Secure GitHub OAuth token storage, diagnostic redaction, bounded comparison
  reports, temporary Agent homes, and source-folder integrity checks.
