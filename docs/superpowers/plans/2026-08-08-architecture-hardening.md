# Architecture Hardening Implementation Record

**Date:** 2026-08-08
**Design:** `docs/superpowers/specs/2026-08-08-architecture-hardening-design.md`

## Delivered scope

This stage hardens the highest-risk ownership boundaries without changing persisted schemas,
IPC channel names, preload APIs, Target behavior, or normal product workflows.

- [x] Add an application-level Renderer error boundary outside the startup and workspace trees.
- [x] Preserve a usable recovery surface when diagnostic reporting itself fails.
- [x] Reuse the existing diagnostic export, reload, quit, localization, and shared Button owners.
- [x] Extract Backup/recovery orchestration from `App.tsx` into a tested controller.
- [x] Extract GitHub device-flow orchestration from `App.tsx` into a tested controller.
- [x] Extract Settings persistence/orchestration from `App.tsx` into a tested controller.
- [x] Replace the public Skill Library prop surface with one typed `model` and one typed `actions` contract.
- [x] Keep Skill Library presentation free of direct preload calls.
- [x] Split conversation, dialog, Profile, Project, recovery, Settings, and Target IPC registration by domain.
- [x] Keep diagnostic, mutation, and workspace-sync wrappers singular in the IPC composition root.
- [x] Centralize IPC identifier validation for extracted registrars.
- [x] Extract activation preview/fingerprint normalization behind the unchanged activation facade.
- [x] Extract Skill update preview lifetime and recent-check caching behind the unchanged Library facade.
- [x] Ratchet module budgets for every changed aggregation point and new owner.
- [x] Register the new recovery boundary and architecture owners in feature evidence.
- [x] Remove high-severity transitive dependency findings without adding a dependency.

## Verification contract

The stage is complete only when the final working tree passes:

```bash
git diff --check
npm audit --audit-level=high
npm run verify:commit
npm run verify:visual
npm run test:e2e:packaged
```

The packaged run must prove application launch, preload-backed workflows, all supported Agent cards,
Profile Apply, Skill import, Project persistence, Target-state persistence, clean close, and restart.

## Deliberately separate follow-up work

The following are valid future refactors, but they are not silently mixed into this behavior-preserving
stage because each needs its own characterization coverage and independently releasable boundary:

- split the remaining Skill Library catalog, source, import, cleanup, and dialog JSX into task views;
- move the remaining Skill Library orchestration out of `App.tsx`;
- split Skill IPC registration below the current subdomain boundaries;
- split activation execution and Skill Library mutation services beyond the pure helpers extracted here;
- migrate legacy CSS, translation storage, and shared types by domain.

These items must not be represented as completed merely because the current full suite is green.
