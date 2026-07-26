# Security Policy

## Supported Versions

AgentEnv Manager is currently pre-release software. Security fixes are applied
to the latest commit and the newest published release only.

## Reporting a Vulnerability

Do not open a public issue for a vulnerability that could expose local files,
credentials, repository access, or destructive filesystem behavior.

Use GitHub Private Vulnerability Reporting for this repository. Include:

- affected version or commit;
- operating system and architecture;
- reproduction steps using an isolated home when possible;
- expected and observed filesystem effects;
- whether credentials or private repository data may have been exposed.

Maintainers will acknowledge a report as soon as practical, coordinate a fix,
and publish an advisory when users need to take action.

## Security Boundaries

AgentEnv Manager reads and may modify local Agent instructions, Skills, and
supported MCP enablement fields only after a Preview and confirmation. Profile
Apply uses backups and recovery journals. Reports should treat bypasses of
Preview, ownership checks, backup, atomic replacement, or rollback as security
issues.

The application does not need Agent API keys. GitHub OAuth tokens are encrypted
with Electron `safeStorage`. System Git credentials and SSH keys remain owned
by the operating system and Git tooling.
