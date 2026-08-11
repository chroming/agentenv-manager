# Minimal-footprint takeover

## Feature admission

**Outcome:** A user can let AgentEnv manage a saved Profile while changing the fewest possible Agent paths and seeing the exact local footprint before confirmation.

**Ownership:** Profiles own portable intent. The selected Agent owns its native files. AgentEnv owns only its Library, backups, Target-state receipts, and the exact Agent paths confirmed by Apply.

**Source of truth:** Device-local deployment receipts live under the AgentEnv data root. New deployments never place ownership markers, sidecars, or support files in Agent or project directories.

**External effect:** Preview is read-only. Apply may adopt, create, replace, or remove only the paths named by its immutable plan. Anonymous statistics remain unresolved until the user explicitly confirms or rejects the first-run choice.

**Recovery:** Every actual Agent-path mutation and Target-state update is protected by the existing operation Backup, stale-input check, post-write verification, and compensating rollback.

## Resource outcome matrix

| Observed state | Planned result | Agent-path write |
|---|---|---|
| Missing and required | Create a reviewed managed copy by default | Yes |
| Existing and byte-equivalent | Adopt in place and record a central receipt | No |
| Existing and different, replacement approved | Back up and atomically replace the exact path | Yes |
| Managed but absent from Profile | Back up and remove the exact path | Yes |
| Covered by `Leave unmanaged` | Preserve | No |
| Existing legacy ownership marker | Record the central receipt and remove only the legacy marker | Marker only |

An unchanged Apply is a semantic no-op: it creates no Agent-path write or Target backup. A receipt-only adoption may write AgentEnv Target state, but it must not replace the adopted Agent directory or change its timestamps.

## Deployment receipts

Each managed resource receipt records its normalized path, resource identity, content hash, Library source, materialization (`copy` or `link`), and origin (`adopted`, `created`, `replaced`, or `unknown`). These are separate dimensions: an adopted resource can remain an ordinary copy, and a created resource can be either a copy or a link. Receipts are device-local, excluded from Workspace Sync, and revalidated against current content before destructive operations.

Legacy `.agentenv-owner.json` files remain read-only migration evidence. New deployment paths do not create them. A fresh explicit Apply migrates valid legacy evidence into Target state and removes the old marker through the same Backup transaction.

## Library updates

Automatic checks remain read-only. An explicit Library update previews affected linked and copied installs. Linked installs change with the Library by definition. Managed copies remain Apply-pending unless the user enables the default-off `Also update Agent copies` choice; that choice re-checks clean receipts and updates the Library and copies in one rollback-protected transaction.

Managed copy is the default and keeps deployed Skills as ordinary folders. Live link remains an explicit advanced policy. A policy change is applied only through an Agent Preview and Apply, where every topology conversion is visible; the application never creates a mixture opportunistically under one automatic mode.

Apply Preview exposes the same Local Skills Manager scoped to the current Profile and Agent. Closing it returns to that Profile and regenerates Preview from current disk state. The manager can widen its scope to the current Agent or all local Skills without introducing a second cleanup workflow.

## Stop managing

`Keep current` removes AgentEnv state while preserving resource content. A live link is materialized because otherwise the Agent would still depend on AgentEnv Library data. An adopted or copied regular directory is not rebuilt. `Restore pre-takeover` continues to use the first valid takeover Backup.

## First-run anonymous statistics

In a configured official build, the first shell asks before creating a random installation ID or sending a request. The suggested choice may be on, but the persistent state remains unresolved until `Continue` is pressed. `Not now`, close, and Escape skip only the current launch. Existing opt-outs migrate as resolved and remain off.

The dialog names every allowlisted field and the destination. No action, result, path, Profile, Skill, repository, conversation, prompt, or file content is sent.

## Evidence matrix

| Layer | Evidence |
|---|---|
| Domain | Telemetry consent gate; markerless deploy; central receipt scan; exact-copy adoption; update propagation; stale and rollback tests |
| Renderer | First-run disclosure, opt-out, session dismissal, Apply local-footprint summary |
| Desktop | First-run ordering, Profile Apply, restart persistence, minimum and large viewport Preview |
| Persistence | Target-state receipt survives restart; no marker is created; previous telemetry opt-out survives migration |
| Package | Packaged official build shows consent before optional onboarding and performs no request before confirmation |
