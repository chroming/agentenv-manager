# AgentEnv Manager

English | [简体中文](README.md)

[![Latest release](https://img.shields.io/github/v/release/chroming/agentenv-manager)](https://github.com/chroming/agentenv-manager/releases/latest)
[![CI](https://github.com/chroming/agentenv-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/chroming/agentenv-manager/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/chroming/agentenv-manager)](LICENSE)

AgentEnv Manager keeps coding agent environments in one place. Its main features are:

- **Profile switching:** Save combinations of Instructions, Skills, and MCP servers, then apply them to Codex, Claude Code, OpenCode, and other supported Agents.
- **Skills management:** Import Skills from local folders, ZIP archives, GitHub, or Git repositories, manage them in one Library, and keep checking their sources for updates.
- **Project environments:** Save frequently used project folders, manage their Instructions and Skills, and open them with an installed Agent.
- **Conversation history:** Search local conversations from multiple Agents, return to the original session, or continue with another Agent.
- **Try before Apply:** Preview Profile changes and run the same task with the current setup and a proposed Profile before deciding whether to apply it.

It does not take over models, accounts, credentials, or entire configuration files. It only manages the Instructions, Skills, and MCP switches explicitly supported by each Agent integration.

![Agents overview](docs/images/agents.png)

## Install

The recommended macOS installation is the official Homebrew Cask:

```bash
brew install --cask chroming/tap/agentenv-manager
```

Upgrade an existing installation with:

```bash
brew upgrade --cask chroming/tap/agentenv-manager
```

Homebrew downloads the official Release for your architecture, verifies its SHA-256, and removes quarantine. Installers for macOS, Windows, and Linux are also available from [GitHub Releases](https://github.com/chroming/agentenv-manager/releases/latest).

Direct macOS downloads are ad-hoc signed, without a Developer ID or notarization. Copy the app to Applications and eject the DMG before following [Apple's instructions](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) to choose Open Anyway. After first install, both Homebrew and direct downloads can check, verify, and install updates from Settings when the application folder is writable. A failed direct-update launch restores the previous version automatically.

## First run

1. Launch the app and confirm the Agents it detected. Agents that are not installed stay disabled by default.
2. Configure an Agent from the Agents page. Save its current setup as a Profile, or start with an empty Profile.
3. If the machine already has many Skills, use `Skills > Local Skills` to handle duplicate copies, conflicts, shared directories, and broken links.
4. Save the Profile and review the Apply preview before writing to the Agent. AgentEnv creates a recovery point first and attempts an automatic rollback after a failed write.

## Profiles

A Profile contains a reusable Agent setup: Instructions, Skills from the Library, and enablement choices for MCP servers already known to a supported Agent. Each resource type can use the Profile, be turned off, or keep the Agent's current state.

![Profiles](docs/images/profiles.png)

Before Apply, AgentEnv reads the target again and lists resources that will be added, replaced, removed, preserved, or need confirmation. It writes only after confirmation and verifies the result.

### Compare before Apply

Compare runs the same task once with the current Agent setup and once with the proposed Profile. Results show both responses, file changes, duration, and token usage reported by the CLI.

![Profile comparison](docs/images/profile-compare.png)

Both runs use isolated temporary Homes and Workspaces. Compare does not Apply the Profile or modify the real Agent or original folder, but it consumes quota from the Agent account. It currently requires macOS. OpenCode, Claude Code, Codex, Antigravity CLI, and Pi have verified implementations; Trae CLI does not expose a reliable one-shot command.

## Workspaces

Workspaces keeps references to frequently used local folders and shows the Instructions, Skills, and MCP names a selected Agent can load there. You can edit supported Workspace Instructions, copy Library Skills into ordinary folder-owned files, or open the folder with an installed Agent.

![Workspace resources](docs/images/workspaces.png)

The folder remains the source of truth. A Workspace is not bound to a Profile, does not contain Library links, and does not stage or commit Git changes. Removing a Workspace deletes only the app reference.

## Skill Library

The Library keeps one reusable copy of each Skill. Import from a local folder, ZIP archive, GitHub path, or regular Git repository, then install Skills into Agent-specific directories through Profiles.

![Skills grouped by source](docs/images/skills-by-source.png)

The source view shows additions, updates, and removals within a repository or folder. It also supports merging sources, ignoring entries, and disabling update checks. `Local Skills` handles existing duplicate copies, content conflicts, broken links, and shared collections. Every cleanup action has a preview and keeps recovery records for changed files.

## Conversations

Conversations maintains a read-only index of local Agent history. Search titles and messages, filter by folder, return to the original conversation, or review its context before continuing in another Agent.

![Conversation history](docs/images/conversations.png)

The source Agent still owns the original history. AgentEnv does not edit conversation databases or include conversations in Profiles, Backups, or Workspace Sync.

## Supported Agents

- OpenCode
- Claude Code
- Codex
- Antigravity CLI
- Trae CLI
- Pi Coding Agent

Instructions, MCP, Conversations, and Compare support differs between Agents. The app shows only actions supported by the current Agent.

## More features

- Workspace Sync uses a dedicated private Git repository for portable Profiles and Skill Library data. Pull and publish both require review, and sync never Applies changes to a local Agent.
- Recovery collects recovery points created by Apply, Skill cleanup, and sync. You can inspect files before restoring them.
- GitHub sign-in raises API limits for repository imports and update checks. Regular Git and SSH repositories use system Git credentials.
- The interface supports English, Simplified Chinese, and Traditional Chinese.

## Safety and privacy

- Profile writes follow Preview, Backup, Apply, and Verify. A semantic no-op does not write files.
- AgentEnv changes only files or fields declared by each Agent integration. Agents continue to own MCP definitions and credentials.
- Repository scans use a separate cache and never modify an existing checkout. Workspace Sync excludes credentials, Agent state, Backups, and local absolute paths.
- Official builds send at most one anonymous installation event per day by default. It contains a random installation ID, app version, operating-system family and major version, architecture, interface language, and install channel. You can preview every field or disable reporting in Settings.

See [Product contracts](docs/product-contracts.md) for exact behavior and [PRIVACY.md](PRIVACY.md) for local data and network access.

## Run from source

You need Node.js 22.12 or newer, npm 10 or newer, and Git.

```bash
npm ci
npm run dev
```

Common commands:

```bash
npm run test:quick       # Tests selected from the current diff
npm run verify:commit    # Full pre-commit verification
npm run verify:release   # Packaged app and release gates
npm run dist:mac         # macOS installers
npm run dist:win         # Windows installer
npm run dist:linux       # Linux installers
```

Use isolated application data and an isolated Agent Home when developing filesystem operations. See [Development](docs/development.md) for setup, architecture, testing, and releases.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending changes. Report security issues privately through [SECURITY.md](SECURITY.md).

AgentEnv Manager is licensed under the [GNU General Public License v3.0](LICENSE). Product names and logos belong to their owners; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This independent project is not affiliated with or endorsed by the Agent vendors listed above.
