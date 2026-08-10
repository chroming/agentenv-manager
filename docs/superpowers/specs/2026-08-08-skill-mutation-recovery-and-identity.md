# Skill Mutation Recovery And Identity

## Feature admission

**Core user outcome:** A failed or interrupted Skill mutation never leaves AgentEnv free to
overwrite uncertain data, and one physical Skill exposed through several Agent paths is not
mistaken for several independent content copies.

**Objects and ownership:**

- A deployment path remains the independently mutable filesystem endpoint that must be backed
  up, restored, or removed explicitly.
- A canonical content path is the resolved directory identity used only to count and compare
  physical copies. It never replaces a deployment path in a mutation plan.
- The Skill cleanup manifest owns the durable phase and post-write receipts for Library import,
  update, merge, delete, cleanup, and migration operations.
- The Skill source merge manifest owns the equivalent recovery state for source-registry,
  observation, and Library metadata changes.
- The main-process mutation coordinator remains the only cross-process write lock.

**Support matrix:** Cleanup-manifest recovery and canonical identity apply to every Target because
they operate on Target-declared paths and shared runtime observations. Source-merge recovery is
transport-independent. No Renderer, language, Profile, or Target-adapter behavior changes.

## State and effects

| State | Meaning | Allowed effect |
|---|---|---|
| `prepared`, no changed paths | The process stopped before a write | Mark rolled back; no filesystem restore |
| `prepared`, every changed path has a matching durable receipt | Only verified operation writes remain | Restore only those paths from the verified backup |
| `prepared`, an unreceipted or changed-after-receipt path exists | Ownership is ambiguous | Preserve every path and enter `recovery-required` |
| `recovery-required` | Automatic recovery cannot prove ownership | Read and inspect normally; reject new Skill writes |
| terminal | Operation completed, rolled back, or was restored | No recovery gate |

Every mutation receipt records the canonical deployment path and the hash observed immediately
after the write. A receipt is persisted before the next path may be mutated. A crash between a
filesystem write and its receipt fails closed: startup preserves the path and marks recovery
required rather than guessing.

Canonical identity follows this order:

1. retain every lexical deployment path;
2. resolve a canonical content path for readable Skills;
3. group runtime observations by semantic Skill name;
4. count distinct physical copies by canonical content path;
5. compare contents by versioned content hash;
6. enrich with stable Library and source identities.

Broken links use their lexical deployment path as canonical identity because no target can be
resolved. Collection members retain both their member path and collection identity.

## No-op, stale, rollback, and return

- Startup recovery is a semantic no-op when no unresolved manifest exists.
- A completed manifest with a stale recovery marker is reconciled without touching user data.
- Source-merge archives created before transactional journals existed remain historical backups;
  they are not unresolved recovery work and never block later mutations.
- An externally changed path never gets overwritten by automatic recovery.
- Successful automatic recovery verifies restored hashes and leaves the existing recovery point
  available under the current retention policy.
- The recovery gate produces a diagnostic reference through the existing IPC wrapper; it does not
  introduce a new dialog or notification style.

## Evidence

- Unit: durable cleanup receipts, clean interruption, verified rollback, unreceipted write, and
  changed-after-receipt preservation.
- Unit: source-merge receipt recovery with the same state matrix.
- Integration: two lexical Skill paths resolving to one canonical directory remain two deployment
  locations but count as one physical copy.
- Closure: after cleanup, a rescan returns managed or explicitly unmanaged state and does not
  recreate the same duplicate/conflict decision.
- Regression: existing import, update, merge, delete, cleanup, Apply, and source-group tests remain
  unchanged and green.
