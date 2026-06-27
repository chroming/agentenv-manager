# Development

## Commands

```bash
npm install
npm run dev
npm test
npm run build
```

## Runtime Data

The Electron app stores profile, backup, and target-state data under the app data directory by default. Set `AGENTENV_DATA_ROOT` to use a predictable local runtime directory:

```bash
AGENTENV_DATA_ROOT=.agentenv-runtime npm run dev
```

## Targets

Target-specific file handling lives in `src/main/targets/`. Adding a new agent should usually mean adding one adapter module plus tests, then registering it in `src/main/targets/registry.ts`.

OpenCode is the first real target. It writes to:

```text
~/.config/opencode/AGENTS.md
~/.config/opencode/opencode.json
~/.config/opencode/agents
~/.config/opencode/skills
```

Codex remains available as a locked adapter. Its default paths are routed to a fake home:

```text
<app-data>/data/fake-home/.codex
<app-data>/data/fake-home/.agents/skills
```

## Real Codex Writes

Real Codex writes are disabled by default in `activationService`. Applying a Codex profile to the actual `~/.codex` or `$HOME/.agents/skills` requires constructing the service with `allowRealHomeWrites: true`.

Do not enable real writes until:

```bash
npm test
npm run build
```

both pass, and the preview diff has been inspected.
