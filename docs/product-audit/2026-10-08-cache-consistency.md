# Cache Consistency Follow-up

## Scope

- Shared freshness coordination now preserves invalidations created during a read.
  Manual/post-mutation refreshes queue a coalesced latest follow-up, even if the old
  read fails. Old completions cannot overwrite newer explicit freshness state.
- Workspace snapshot caching has a one-minute session TTL, shared in-flight reads,
  versioned invalidation and queued forced reads. Page changes do not discard useful
  results; only the current selection/request can update visible state or progress.
- Failed Worktree repository reads retain last-known rows within unchanged scan scope.
  Retained rows are unavailable for cleanup and partial inventories are not fresh.
- Display-cache removal failures no longer prevent resource mutations. Memory is
  invalidated first, disk invalidation is attempted, and failure is logged. Restarted
  display caches still require revalidation and grant no cleanup authorization.

## Evidence

Targeted tests cover mutation during refresh, failed older requests, explicit freshness
updates, snapshot expiry, page reopen, late manual refresh after selection changes,
invalidated late reads, unreadable repositories and cache removal failures.

Production build/type check and module budgets passed. Native Electron workflows cover
Worktrees, Workspace editing/recovery and refresh layout. Tests use isolated fixture
directories, not user repositories. Full-suite and packaged-app validation were not run.

## Boundaries

This change does not force all resources to use the same TTL or persist every cache.
Conversation indexing and Skill update candidates retain their domain-specific storage
and safety contracts. No new settings or visual components were introduced.
