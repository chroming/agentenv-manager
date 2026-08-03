# AgentEnv Manager

English | [简体中文](README.md)

AgentEnv Manager is a local desktop app for organizing coding-agent Skills, Profiles, and conversation history, then applying the same working environment across different Agents.

It does not take ownership of models, accounts, or every native setting. Before writing anything, it shows the changes and creates a recovery point.

> Version `0.1.0` is a pre-release. Packaged-app checks run on macOS, Windows, and Linux. The macOS package is not signed or notarized yet. The official Homebrew Cask verifies its SHA-256 before removing quarantine.

## Install

The recommended macOS installation is the official Cask:

```bash
brew install --cask chroming/tap/agentenv-manager
```

Homebrew downloads an exact versioned asset for the current architecture and verifies its SHA-256 before installation. In-app automatic installation is available only for Homebrew-managed copies. Direct downloads can still check for updates and open the official Release page.

## Agents

AgentEnv detects installed Agents and shows which ones it manages, which Profile each Agent uses, and the result of the latest Apply.

![Agents overview](docs/images/agents.png)

Built-in integrations currently include:

- OpenCode
- Claude Code
- Codex
- Antigravity CLI
- Trae CLI 2.0 and the legacy layout
- Pi Coding Agent

MCP and conversation capabilities differ between Agents. The app reports unavailable features directly instead of silently running another Agent.

## Profiles

A Profile is a reusable working environment. It can contain Instructions, Skills from the Library, and enablement choices for MCP servers that already exist in an Agent. Capture the current Agent, start with an empty Profile, or duplicate an existing one.

![Profiles workspace](docs/images/profiles.png)

Before Apply, AgentEnv reads the target again, shows file changes and conflicts, and lists anything it will preserve. It writes only after confirmation, creates a backup first, and attempts recovery if the operation fails.

### Compare before Apply

Compare runs the same task once with the current Agent environment and once with the proposed Profile. Both runs use isolated temporary Homes and Workspaces. The result shows responses, file changes, duration, and token usage reported by the CLI.

![Profile comparison](docs/images/profile-compare.png)

Compare calls the selected Agent's model and may consume account quota. It does not Apply the Profile or modify the real Agent or original project. Resources that cannot be isolated are clearly marked as excluded.

## Skill Library

The Library keeps one reusable copy of each Skill. Import Skills from a local folder, ZIP archive, GitHub path, or regular Git repository, then install them into Agent-specific directories through Profiles.

The source view groups Skills from the same repository or folder. It shows additions, updates, and removals, and lets you check a source, merge related sources, or ignore entries you do not want to import.

![Skills grouped by source](docs/images/skills-by-source.png)

`Scan local` finds duplicate copies, content conflicts, broken links, and shared directories already on the machine. Cleanup actions show a preview and keep recovery records for changed files.

## Conversations

Conversations searches a read-only index of local Agent history. Search titles and visible messages, open the original conversation, or review the context before continuing it in another Agent.

![Conversation history](docs/images/conversations.png)

The source Agent still owns the original history. AgentEnv does not edit conversation databases or include conversations in Profiles, Backups, or Workspace Sync.

## Safety boundaries

- Profile writes follow Preview, Backup, Apply, and Verify.
- AgentEnv changes only the files or fields declared by each Target integration.
- Agents keep their MCP definitions and credentials. Profiles manage only supported enablement states.
- Repository scans use a separate cache and never modify an existing checkout.
- Workspace Sync includes portable Profile and Library data, not credentials, Target state, or backups.
- The app has no advertising or hosted service for user data. Anonymous reliability reporting is off by default, and Settings shows every field before opt-in.

See [Product contracts](docs/product-contracts.md) for exact behavior and [PRIVACY.md](PRIVACY.md) for local data and network access.

## Run from source

You need Node.js 22.12 or newer, npm 10 or newer, and Git.

```bash
npm ci
npm run dev
```

For filesystem development, isolate both application data and the Agent Home:

```bash
export AGENTENV_DATA_ROOT="$PWD/.agentenv-runtime/data"
export AGENTENV_HOME="$PWD/.agentenv-runtime/home"
npm run dev
```

## Test and package

```bash
npm run build
npm test
npm run test:e2e
npm run verify:release
```

Create an unpacked app for the current platform:

```bash
npm run pack
```

Create installers:

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Pushing a `vX.Y.Z` tag that exactly matches `package.json` runs the cross-platform release workflow. It produces an SBOM, checksums, a release manifest, and the Homebrew Cask. Publishing requires `HOMEBREW_TAP_DEPLOY_KEY`, a repository-scoped Deploy Key that can write only to `chroming/homebrew-tap`.

See [Development](docs/development.md) for architecture, Target integrations, test evidence, and the release workflow.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending changes. Report security issues privately through [SECURITY.md](SECURITY.md).

AgentEnv Manager is licensed under the [Apache License 2.0](LICENSE). Product names and logos belong to their owners; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This independent project is not affiliated with or endorsed by the Agent vendors listed above.
