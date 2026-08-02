# Privacy

AgentEnv Manager is a local-first desktop application. It does not include
telemetry, advertising, analytics, or an application-operated cloud service.

## Data Read Locally

Depending on the features you use, AgentEnv Manager may read:

- supported Agent instruction and Skill directories;
- supported Agent MCP definitions and enablement state;
- local Agent conversation indexes or history needed for read-only search;
- repositories or folders that you explicitly import;
- the local folder selected for Profile Compare, excluding known credential
  files and generated directories;
- the private Git repository explicitly configured for Workspace Sync.

Conversation history remains owned by the source Agent. AgentEnv stores only a
local, deletable index and bounded handoff context.

## Data Written Locally

Application data uses the platform location documented in the README by
default. It contains Profiles, the Skill Library, backups, recovery state,
settings, and rebuildable caches. Target files are changed only by confirmed
operations described in the Preview.

Profile Compare creates two temporary, permission-restricted Agent homes and
Workspace snapshots. To authenticate the selected Agent, it may copy that
Agent's existing local credential file into each temporary home or pass
relevant credential environment variables to the child process. These copies
are used only for the comparison run and are removed with the temporary
workspace. AgentEnv verifies that the original Agent files and selected folder
did not change during the run.

Only the latest comparison report is retained under the application data
directory. The report can include the entered prompt, model response, changed
file names, and text diffs. It excludes the original folder path, strips
terminal control sequences, redacts detected secrets and private paths, and
applies bounded size limits. The report file is written with owner-only
permissions on supported platforms.

Bounded, rotating runtime diagnostics are stored in the application's local log
directory. They contain operation names, allowlisted identifiers, timings, and
redacted error chains. They do not contain instruction text, Skill contents,
Conversation text, MCP definitions, environment values, credentials, or
clipboard contents. Diagnostic reports are written only to a location selected
by the user and are not included in Workspace Sync.

GitHub OAuth tokens are encrypted with the operating system's secure storage
before being written to the application data directory. AgentEnv refuses to
persist them as plaintext when secure storage is unavailable, including
Electron's unprotected `basic_text` fallback on Linux. Repository passwords, personal access
tokens, SSH private keys, and credential-helper secrets are not copied into the
application data directory.

## Network Access

Network requests occur only for user-requested or configured features:

- GitHub device authorization and GitHub API requests;
- repository checks, imports, and Workspace Sync through system Git;
- remote source icons or repository content selected by the user;
- Profile Compare calls made by the selected Agent CLI to its configured model
  provider. The prompt and included Workspace/Profile context are handled under
  that provider's terms and may consume account quota.

Background checks may inspect configured sources but do not automatically
Apply Profiles, pull Workspace changes, or push local changes.

## Removing Data

Sign out of GitHub in Settings to remove the saved OAuth token. Disconnect
Workspace Sync to remove its connection metadata. To remove all AgentEnv data,
quit the application, delete `~/.config/agentenv-manager`, and remove the
diagnostic directory opened by `Settings > Data > Diagnostics > Open logs`.
Exported diagnostic reports remain at the user-selected destination until
deleted there.

The latest Profile Compare report is removed with the application data
directory. Temporary comparison homes and Workspace snapshots are deleted when
a run finishes or is cancelled; stale temporary directories are removed the
next time Compare starts after an interrupted process.

Deleting AgentEnv data does not remove files owned by external Agents. Use
Preview, recovery, or the relevant Agent's own tools before deleting data when
a Target is currently managed.
