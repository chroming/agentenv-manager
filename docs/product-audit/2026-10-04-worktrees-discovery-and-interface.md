# Worktrees discovery and interface review

## Change Evidence Card

- Outcome: find linked worktrees in existing conventional local locations without
  requiring every repository to be a saved Workspace. Keep cleanup reviewable and
  recoverable; never scan all Home or infer that clean means safe to delete.
- Discovery owner: Worktree service, Git registration, canonical filesystem paths.
  Add Codex, Claude, Cursor, Orca and conventional repository containers. Deduplicate
  realpaths and interleave traversal so one location cannot starve later locations.
- UI owner: one toolbar and stable aligned resource lanes. Scan locations, details,
cleanup confirmation and recovery use the shared modal shell. The list remains
  in place during review and background refresh.
- Component mapping: TabBar / SearchField / RefreshAction / IconButton in toolbar;
  AlignedResourceList + plain ResourceRow + TextAction in inventory; DetailList,
  Notice, DiagnosticMessage, DialogHeader/Body/Footer and ModalFrame in review.
  Page CSS controls composition and column tracks, not button geometry or colors.
- Safety unchanged: no network operations, no automatic deletion, no routine force,
  stale preview rejection, verified recovery for local files, retained Git history.
- Evidence required: isolated Git tests for conventional paths, aliases, nested
  repositories and cancellation; renderer tests for disclosure and review; rebuilt
  Electron workflow and pixels at minimum/regular/large sizes and translated labels.

## Initial findings

Only four automatic candidates existed. This machine has `.codex/worktrees` and
`orca/workspaces`, neither included. Repository containers were not searched unless
manually added. The global traversal budget was consumed serially by roots.

Rows used ResourceRow without AlignedResourceList. Branches, states and varying
action counts therefore determined independent column widths. Scan locations and
refresh text added extra horizontal bands. Review replaced the page instead of
using the application's common review dialog, and metadata used ad-hoc paragraphs.

## Completion receipt

- Discovery now checks 29 conventional candidate locations, using only existing
  directories and deduplicated realpaths. Roots advance round-robin; recursion and
  directory limits are reported, and an automatic alias or derived repository root
  cannot silently turn discovery into a whole-Home scan. Git registrations include
  worktrees outside those roots. Nested repositories remain discoverable.
- Legacy aliased scan locations can be removed from preferences without touching
  their folders. Passive Git status checks preserve index content and timestamps.
- One toolbar owns filters, search, scan locations, refresh, stop and recovery.
  Existing rows remain in place during refresh. Repeated name/path, branch, state
  and selection lanes are aligned. Main-only repositories do not become cleanup rows.
- Review, scope, cleanup and recovery share the modal shell, maximize and Escape.
  Metadata uses DetailList, errors support diagnostic copying, and each command
  owns its busy feedback. Long review content has one body scroll owner.
- Verification: 64 focused service/IPC/diagnostics/renderer tests; three rebuilt
  Electron workflows (en, zh_CN, zh_TW), each covering 920x620, 1180x728 and
  1440x900. Geometry checks cover horizontal lanes, vertically centered states,
  text fitting, selection toolbar width, long-list scrolling and modal bounds.
  Cleanup/restore uses real isolated Git repositories and preserves unrelated
  uncommitted files. Cancellation remains a normal logged outcome.
- Build and styles/modules/targets/translations/features/UI-contract audits pass.
  Screenshots were inspected, including long dirty details, scope, confirmation,
  recovery, and minimum/large inventories. Capture directory:
  `/private/tmp/agentenv-worktree-review-captures`.
- Limits: no whole-Home or arbitrary descendant-link crawl, no remote MR/value
  inference, no automatic cleanup. Full application suite and packaged Windows/Linux
  runs were not part of this scoped verification.
