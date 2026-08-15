# Customer Environment Testing

AgentEnv Manager cannot reproduce every customer machine as a hand-written
test. Instead, customer compatibility is represented as deterministic synthetic
homes that exercise the same Target adapters, filesystem code, and migration
services used by the application.

## Compatibility corpus

`tests/fixtures/target-homes/compatibility.json` is the source of truth for
supported machine layouts. Every scenario declares:

- the Agent Target and supported operating systems;
- files, directories, symbolic links, and environment overrides;
- optional command-discovery evidence;
- the expected configuration root, runtime root, Skills, ownership, and issues.

The catalog is validated before tests run. Paths cannot escape the synthetic
home, scenario IDs are unique, and every built-in Target must keep at least
three scenarios on macOS, Linux, and Windows.

Run the complete Target and customer-environment gate:

```bash
npm run test:targets
```

Reproduce one customer topology:

```bash
npm run test:scenario -- codex-private-shared-duplicate
```

A scenario that cannot be materialized safely on the current operating system
fails explicitly instead of passing with zero tests.

## Mutation safety oracle

Filesystem assertions snapshot entry type, permissions, content hash, symbolic
link target, and, for read-only/no-op checks, size and modification time.

The Apply failure matrix injects failures after:

1. backup creation;
2. the persisted recovery marker;
3. instruction and MCP file changes;
4. Skill deployment;
5. final-state preparation;
6. final-state persistence.

Every failure must restore the complete Agent home and preserve canonical Skill
sources. Previewing a semantic no-op must not change bytes or timestamps.

## Upgrade and startup recovery

`tests/fixtures/app-data/upgrade-matrix.json` contains fresh, unversioned, v1,
partially damaged, unsafe, and future-format data roots. Successful migrations
verify the resulting data and retained resources. Failed migrations compare the
complete active data tree with its pre-migration state.

Startup recovery scenarios cover interrupted Apply and rollback state plus an
invalid Target state. They must remain visible as recovery-required, block a
new mutation at Apply, and leave live Agent files untouched.

## Adding a customer regression

1. Export or manually reduce the report to topology only. Never commit user
   names, absolute paths, repository URLs, file contents, or credentials.
2. Add the smallest scenario that reproduces the failure.
3. Confirm the scenario fails before the product fix.
4. Fix the owning adapter or shared filesystem contract.
5. Run the single scenario, `npm run test:targets`, and the applicable complete
   commit gate.

Do not weaken an existing scenario to make a product change pass. If a support
boundary changes, update the product contract and the platform matrix together.
