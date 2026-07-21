# Adding a Target

AgentEnv uses an explicit, statically bundled Target Integration registry. A basic new Agent should require one integration directory, one manifest entry, and tests for that Agent. Core activation, capture, Library, and Renderer code must not branch on its ID.

## Start

```bash
npm run target:new -- example-agent
```

The command creates `src/main/targets/integrations/example-agent/index.ts`. Complete its five drivers, then add its adapter factory to `src/main/targets/integrations/index.ts`.

## Integration contract

- `descriptor` owns the stable ID, executable, display metadata, config format, and capabilities.
- `paths` owns every live config, Instructions, Skill, Agent, and discovery location.
- `profile` owns the default Profile, capture, and persisted Profile files.
- `config` owns a read-only preview of live changes and conflict detection.
- `mcp` owns conversion from Library MCP entries into the Agent's native format.
- `assets` owns Target-specific validation and deployment behavior. Reuse shared deployment helpers whenever the ownership semantics match.

Skill ownership semantics belong to the shared deployment Planner. A Target asset driver receives only explicitly approved unmanaged paths with their expected content hashes; it must re-check those hashes before writing and must not infer takeover permission from Target-specific conditions.

Do not load code dynamically at runtime. Static registration keeps Electron packaging deterministic and makes every supported Agent auditable.

## Required behavior

Before enabling `realWritesEnabled`, cover:

1. Declared installation evidence present and missing, including sparse GUI `PATH`, supported desktop-only installation, and configuration residue that MUST remain undetected.
2. Default Profile read/write round trip and legacy file compatibility.
3. Capture that excludes credentials and unsupported native values.
4. Preview with no filesystem writes, no-change behavior, drift, and conflicts.
5. Full replacement Apply, backup, rollback, partial-failure recovery, and Stop Managing.
6. Skills using copy and symlink, shared compatibility roots, ignored copies, and ownership markers.
7. MCP stdio/http/sse support, environment references, unsupported transports, and name conflicts.
8. Generic icon fallback, Target name, Profile counts, Apply selector, and History labels in the UI.

## Verification

```bash
npm run audit:targets
npm run build
npx vitest run tests/main/targets tests/main/targetDiscovery.test.ts
npx vitest run tests/main/profileStore.test.ts tests/main/activationService.test.ts
npx vitest run tests/main/skillLibraryStore.test.ts tests/main/targetCaptureService.test.ts
npx vitest run tests/main/skillDeploymentPlanner.test.ts tests/main/targets/skillRefs.test.ts
npm run test:e2e
```

`audit:targets` fails when a concrete Target ID appears in shared main or Renderer code. Target-specific paths and formats belong inside the integration.
