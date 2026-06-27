# Development

## Commands

```bash
npm install
npm run dev
npm test
npm run build
```

## Runtime Data

The Electron app stores profile data under the app data directory by default. In development, all Codex targets are routed to a fake home under that data root:

```text
<app-data>/data/fake-home/.codex
<app-data>/data/fake-home/.agents/skills
```

Set `AGENTENV_DATA_ROOT` to use a predictable local runtime directory:

```bash
AGENTENV_DATA_ROOT=.agentenv-runtime npm run dev
```

## Real Codex Writes

Real writes are disabled by default in `activationService`. Applying a profile to the actual `~/.codex` or `$HOME/.agents/skills` requires constructing the service with `allowRealHomeWrites: true`.

Do not enable real writes until:

```bash
npm test
npm run build
```

both pass, and the preview diff has been inspected.

