# Skill read and mutation reliability

## Change evidence card

- Intent: inspect all readable Skills without confusing an incomplete scan with absence; change only reviewed resources and preserve recoverability.
- Owner: Library reader, content snapshot/hash, runtime inventory, update checker and existing mutation journal.
- Surfaces: Library list/source groups, Local Skills, Profile/Workspace consumers and Apply.
- Effects: reading does not authorize deployment or cleanup. Library identity, content identity, source identity and runtime path remain distinct.
- UI reuse: existing Local Skills scan issues and row status/detail; no new persistent banner or control styles.
- Evidence: isolated filesystem tests for failed siblings, links, partial reads, stable hashes, stale writes and recovery; renderer and rebuilt Electron checks for visible feedback.

## Contracts

1. Inspection returns healthy entries plus per-path issues. Missing SKILL.md inside a present Library directory is an issue, not an empty Library. Last-good entries may be displayed as stale, never used to authorize writes.
2. Mutation planning requires fresh, complete evidence for its affected resources. Operations whose reference/identity scope cannot be proven remain conservative; partial inventories never authorize removal.
3. Skill hashes retain v2 framing and copied/linked content equivalence. Reads have bounded work and verify file identity, content length and filesystem stamps after traversal. Changing trees are retried once; persistent changes fail explicitly.
4. Links can be read as content, but do not confer ownership of their destinations. Existing deployment/collection contracts continue to decide exact write paths. Cycles and unsupported filesystem entries fail closed.
5. Update failures are not 'current'. Missing upstream Skills are not updates. Failed/incomplete source scans do not replace a complete observation.
6. Candidate content, Library content and metadata are revalidated before commit. Backups must match the preimage accepted for mutation. External changes observed during recovery are preserved, not overwritten.
7. A successful Library update, optional Agent copy propagation and later Apply remain separate outcomes. No-op content does not rewrite deployed resources.
8. Recovery records are retained. Unproven recovery scope blocks potentially overlapping writes, never read-only inspection. Users receive recovery IDs and an actionable recovery destination.

## Limits

Filesystem stamp revalidation detects ordinary concurrent changes but cannot create an OS-wide atomic snapshot or prevent a hostile process racing every system call. No claim of absolute data safety is made. Tests use isolated homes, not real Agent deployments.

## Implemented boundaries

| Case | Result |
| --- | --- |
| One unreadable Library entry | Healthy siblings remain usable; the unreadable entry retains display context and a path-specific issue |
| Unreadable Agent inventory or ownership state | Inspection reports incomplete coverage; mutation planning cannot treat the missing evidence as an empty Agent |
| Broken/cyclic link, oversized or changing tree | Bounded read fails explicitly; no partial content hash is published |
| One invalid member of a source group | Only that member loses its update action; healthy members remain independently reviewable |
| Source check fails after a successful check | Previous observation stays visible with failure status, not a new successful checkpoint |
| Candidate or deployed copy changes after review | Commit refuses the changed preimage; existing recovery handling preserves external edits |
| No-op metadata update | Metadata content and modification time remain unchanged |
| Legacy hash upgrade partially fails | Original bytes stay intact; retry revisits failed paths without adopting later edits to healthy migrated resources |
| Recovery scope can be verified | Proven disjoint metadata changes may proceed; unknown or overlapping effects remain blocked |

The recovery relaxation is deliberately limited to single-Skill icon, tag, availability and update-policy metadata plus their source-registry effects. Import, merge, removal, Apply and synchronization still require the existing broader recovery checks.

## Regression evidence

- Reader isolation and display-only cache: `tests/main/skillLibraryReader.test.ts`.
- Content framing, links, bounds and changing files: `tests/main/skillContentHash.test.ts`.
- Metadata corruption and scoped migration retry: `tests/main/skillContentHashMigration.test.ts`.
- Backup/preimage checks and scoped recovery: `tests/main/skillMutationRecovery.test.ts`.
- Multi-Agent receipt propagation and external edits: `tests/main/skillLibraryUpdatePropagation.test.ts`.
- Shared source state and summaries: `tests/shared/skillSourceGrouping.test.ts`, `tests/renderer/skillUpdateSummary.test.ts`.
- Rebuilt Electron startup with damaged metadata, healthy siblings, repair, refresh and persisted-file checks: `tests/e2e/skillReadReliability.e2e.test.ts`.

## Initial completion evidence (2026-09-13)

The desktop and Target-audit failures recorded below were subsequently repaired. The complete registered gate now passes: 2,038 non-Electron tests, 182 Electron tests and all six audits. See [Desktop regression gate convergence](e2e-gate-convergence.md) for the rebuilt artifact, reports and verification boundaries. The initial results remain below as historical evidence.

- Source artifact: `959a01f24e0b`; build and TypeScript checks passed.
- Full non-Electron pool: 285 files, 2,035 tests passed.
- New Electron read/repair test passed in the complete desktop run. Repository import, startup recovery, Profile evaluation, Workspace editing and history-search suites also passed.
- English failure/repaired state pairs captured at 920, 1180 and 1440 pixels in `/tmp/aem-skill-read-evidence/`; inspected status containment and unchanged sibling rows. No page-specific CSS was added.
- CSS, module, translation, feature and UI-contract audits passed.
- Full Electron gate is **not green**: 31 assertions failed. Several tests still target removed headings, old refresh entries and old toolbar structure; other layout assertions also need review. These failures were not deleted or relaxed.
- A clean archive of pre-change commit `ede94ab0` reproduced five representative failures: ambiguous Language selector, obsolete Refresh Profiles entry, both status-lane scrollbar variants, and the scale test's removed header node. Baseline report: `/tmp/aem-skill-baseline-e2e.json`; scale comparison: `/tmp/aem-skill-baseline-scale.json` and `/tmp/aem-skill-current-scale.json`. This establishes those failures as pre-existing, not every other desktop failure.
- Target-boundary audit also fails on the existing `pi` literal in `conversations/historySearchController.ts`; reproduced in the pre-change archive.
- Release/whole-product visual approval remains incomplete. Packaged smoke and real Windows/Linux/SSH environments were not tested in this change; fixtures never authorize modifying a user's actual Agent data.
