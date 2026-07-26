# Privacy

AgentEnv Manager is a local-first desktop application. It does not include
telemetry, advertising, analytics, or an application-operated cloud service.

## Data Read Locally

Depending on the features you use, AgentEnv Manager may read:

- supported Agent instruction and Skill directories;
- supported Agent MCP definitions and enablement state;
- local Agent conversation indexes or history needed for read-only search;
- repositories or folders that you explicitly import;
- the private Git repository explicitly configured for Workspace Sync.

Conversation history remains owned by the source Agent. AgentEnv stores only a
local, deletable index and bounded handoff context.

## Data Written Locally

Application data is stored under `~/.config/agentenv-manager` by default. It
contains Profiles, the Skill Library, backups, recovery state, settings, and
rebuildable caches. Target files are changed only by confirmed operations
described in the Preview.

GitHub OAuth tokens are encrypted with macOS secure storage before being written
to the application data directory. Repository passwords, personal access
tokens, SSH private keys, and credential-helper secrets are not copied into the
application data directory.

## Network Access

Network requests occur only for user-requested or configured features:

- GitHub device authorization and GitHub API requests;
- repository checks, imports, and Workspace Sync through system Git;
- remote source icons or repository content selected by the user.

Background checks may inspect configured sources but do not automatically
Apply Profiles, pull Workspace changes, or push local changes.

## Removing Data

Sign out of GitHub in Settings to remove the saved OAuth token. Disconnect
Workspace Sync to remove its connection metadata. To remove all AgentEnv data,
quit the application and delete `~/.config/agentenv-manager`.

Deleting AgentEnv data does not remove files owned by external Agents. Use
Preview, recovery, or the relevant Agent's own tools before deleting data when
a Target is currently managed.
