# AgentEnv Manager

English | [简体中文](README.md)

[![Latest release](https://img.shields.io/github/v/release/chroming/agentenv-manager)](https://github.com/chroming/agentenv-manager/releases/latest)
[![CI](https://github.com/chroming/agentenv-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/chroming/agentenv-manager/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/chroming/agentenv-manager)](LICENSE)

AgentEnv Manager is a local desktop app for organizing Skills, Instructions, MCP enablement, and conversation history across coding agents. Save a reusable Profile, preview and compare it before writing to an Agent, and recover from a restore point when needed.

The app does not take ownership of models, accounts, credentials, or entire native configuration files. Each Agent integration exposes only the resources it is designed to manage.

![Agents overview](docs/images/agents.png)

## Install

The recommended macOS installation is the official Homebrew Cask:

```bash
brew install --cask chroming/tap/agentenv-manager
```

Homebrew downloads the official Release for your architecture, verifies its SHA-256, and removes quarantine. Future updates can be installed from inside the app.

Installers for macOS, Windows, and Linux are also available from [GitHub Releases](https://github.com/chroming/agentenv-manager/releases/latest). Direct macOS downloads are ad-hoc signed, without a Developer ID or notarization. Copy the app to Applications and eject the DMG before following [Apple's instructions](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) to choose Open Anyway. Direct downloads can check for updates, but you install the new version manually.

## First run

1. Launch the app and confirm the Agents it detected. Agents that are not installed stay disabled by default.
2. Configure one Agent from the Agents page. Save its current setup as a Profile, or start with an empty Profile.
3. If the machine already has many Skills, open `Skills > Local Skills` before the first Apply to review duplicate copies, conflicts, shared directories, and broken links.
4. Choose how the Profile should handle Instructions, Skills, and MCP state, then save it and open the Apply preview.
5. Confirm the changes before Apply. AgentEnv creates a restore point first, attempts an automatic rollback after a failed write, and keeps recovery records.

## Profiles

A Profile contains reusable Instructions, Skills from the Library, and enablement choices for MCP servers already known to a supported Agent. Each resource type can use the saved content, be turned off, or keep the Agent's current state.

![Profiles](docs/images/profiles.png)

Before Apply, AgentEnv reads the target again and lists resources that will be added, replaced, removed, preserved, or need confirmation. It writes only after confirmation and verifies the result.

### Compare before Apply

Compare runs the same task once with the current Agent setup and once with the proposed Profile. Both runs use isolated temporary Homes and Workspaces. Results show responses, file changes, duration, and token usage reported by the CLI.

![Profile comparison](docs/images/profile-compare.png)

Compare consumes quota from the selected Agent account. It does not Apply the Profile or modify the real Agent or original folder. Isolated comparison currently requires macOS. OpenCode, Claude Code, Codex, Antigravity CLI, and Pi have verified implementations; Trae CLI does not currently expose a reliable one-shot command.

## Workspaces

Workspaces keeps references to frequently used local folders and shows the Instructions, Skills, and MCP names each selected Agent can load there. You can edit explicitly supported Instructions, copy Library Skills into ordinary folder-owned files, and open the folder with an installed Agent.

The original folder remains the source of truth and is never bound to or overwritten by a Profile. AgentEnv does not create Library links in Workspaces or stage and commit Git changes. Writes verify the current file and create a separate recovery point first. Removing a Workspace deletes only the app reference, never the folder.

## Skill Library

The Library keeps one reusable copy of each Skill. Import from a local folder, ZIP archive, GitHub path, or regular Git repository, then install Skills into Agent-specific directories through Profiles.

![Skills grouped by source](docs/images/skills-by-source.png)

The source view shows additions, updates, and removals within the same repository or folder. You can check a source for updates, merge sources, ignore entries you do not want to import, or disable automatic checks for a source.

`Local Skills` handles duplicate copies, content conflicts, broken links, and shared collections already on the machine. Every cleanup action has a preview and keeps recovery records for changed files.

## Conversations

Conversations maintains a read-only index of local Agent history. Search titles and messages, filter by folder, return to the original conversation, or review its context before continuing in another Agent. When a conversation folder is already a Workspace, you can jump directly to it.

![Conversation history](docs/images/conversations.png)

The source Agent still owns the original history. AgentEnv does not edit conversation databases or include conversations in Profiles, Backups, or Workspace Sync.

## Supported Agents

- OpenCode
- Claude Code
- Codex
- Antigravity CLI
- Trae CLI 2.0 and the legacy layout
- Pi Coding Agent

Instructions, MCP, Conversations, and Compare support differs between Agents. The app exposes actions according to the detected capability and never substitutes another Agent behind the scenes.

## More features

- Workspace Sync uses a dedicated private Git repository for portable Profiles and Skill Library data. Pull and publish both require review, and sync never Applies changes to a local Agent.
- Recovery collects restore points created by Apply, Skill cleanup, and sync. You can inspect the files before restoring them.
- GitHub sign-in raises API limits for repository imports and update checks. Regular Git and SSH repositories continue to use system Git credentials.
- The interface supports English, Simplified Chinese, and Traditional Chinese.

## Safety and privacy

- Profile writes follow Preview, Backup, Apply, and Verify. A semantic no-op does not write files.
- AgentEnv changes only the files or fields declared by each Target integration.
- Agents keep their MCP definitions and credentials. Profiles manage only supported enablement states.
- Repository scans use a separate cache and never modify an existing checkout.
- Workspace Sync excludes credentials, Target state, Backups, and local absolute paths.
- Official builds send at most one anonymous installation event per day by default. It contains a random installation ID, app version, operating-system family and major version, architecture, interface language, and install channel. You can disable it and preview every field in Settings.

See [Product contracts](docs/product-contracts.md) for exact behavior and [PRIVACY.md](PRIVACY.md) for local data and network access.

## Run from source

You need Node.js 22.12 or newer, npm 10 or newer, and Git.

```bash
npm ci
npm run dev
```

When developing filesystem operations, isolate both application data and the Agent Home:

```bash
export AGENTENV_DATA_ROOT="$PWD/.agentenv-runtime/data"
export AGENTENV_HOME="$PWD/.agentenv-runtime/home"
npm run dev
```

Common verification commands:

```bash
npm run test:quick       # Tests selected from the current diff
npm run verify:commit    # Full pre-commit verification
npm run verify:release   # Packaged app and release gates
```

Create installers:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

See [Development](docs/development.md) for architecture, Target integrations, testing strategy, and the release workflow.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending changes. Report security issues privately through [SECURITY.md](SECURITY.md).

AgentEnv Manager is licensed under the [Apache License 2.0](LICENSE). Product names and logos belong to their owners; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This independent project is not affiliated with or endorsed by the Agent vendors listed above.
