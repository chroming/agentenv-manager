# Worktree Inventory Lifetime

## Problem and ownership

Opening Worktrees mounted a new component, discarded its previous inventory and
unconditionally scanned all locations. Leaving the page cancelled the scan. The
main process now owns the shared scan and a validated, versioned display cache.

## Behavior

- Fresh results are reused for five minutes across page navigation.
- Persisted results display immediately after restart but trigger revalidation.
- Navigation does not cancel work; explicit Stop still does.
- Background refresh reuses known repository identities for thirty minutes when
  roots match, while rereading registrations and Git status. Manual refresh discovers
  all locations again, including when requested during a lighter background scan.
- Background size/modified-time estimates can reuse a fifteen-minute measurement.
  Manual refresh and cleanup fingerprinting do not use that measurement cache.
- Mutation invalidates display freshness. Root changes, removal and restoration
  additionally discard repository and measurement reuse.
- Cached files never populate the discovered/authorized directory set. Cleanup
  still requires current Git checks and content/Git fingerprint validation.

## Verification

- Type checking and production build passed.
- 98 tests across WorktreeService, WorktreeInventoryCache, WorktreeIpc and
  WorktreeDialog passed, including remount, StrictMode, restart, expiry, invalid
  cache, concurrent request reuse and newly registered worktrees.
- Electron Worktrees tests cover en, zh_CN and zh_TW, navigation reuse, cancellation,
  cleanup/recovery and process restart; multi-size capture is available through
  AGENTENV_CAPTURE_WORKTREES_DIR.
- No real user repositories were scanned or modified by verification.
- Full-suite and packaged-artifact testing were not run for this change.

## Scope

The first full scan still performs bounded Git checks and directory measurement.
This change removes redundant scans and reuses expensive display measurements;
it does not introduce filesystem watchers or a separate streaming measurement UI.
