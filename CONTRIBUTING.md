# Contributing

Thank you for helping improve AgentEnv Manager.

## Before You Start

- Search existing issues before opening a new one.
- Use a discussion or feature request before implementing a large product or
  Target-integration change.
- Keep filesystem mutations previewable, backed up, atomic where possible, and
  recoverable.
- Never use a real Agent home for automated tests.

## Development Setup

AgentEnv Manager currently targets macOS. Install Node.js 22.12 or newer and
use the repository lockfile:

```bash
npm ci
AGENTENV_DATA_ROOT=.agentenv-runtime npm run dev
```

See [docs/development.md](docs/development.md) for architecture and Target
integration guidance.

## Verification

Run the narrow tests relevant to your change while developing. Before opening
a pull request, run:

```bash
npm run build
npm test
npm run test:e2e
```

Changes to filesystem ownership, Profile Apply, backup, recovery, or packaged
runtime discovery should also run:

```bash
npm run verify:release
```

## Pull Requests

- Keep changes focused and explain the user-visible result.
- Add or update tests for behavior changes.
- Update product contracts when persistent or user-visible semantics change.
- Do not commit runtime data, credentials, signing material, build output, or
  private repository details.
- State which verification commands were run.

Contributions are licensed under the project's Apache-2.0 license. No separate
CLA is required.
