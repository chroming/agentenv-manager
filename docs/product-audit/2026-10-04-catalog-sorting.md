# Catalog Sorting and Filtering

## Scope

Add useful presentation-only controls to existing catalogs, without adding navigation or changing
resource ownership, manual Profile/Workspace/Agent order, or Conversation queries.

| View | Sorting | Filtering |
| --- | --- | --- |
| Skills | Name, source modification time, distinct Profile references | Existing filters, persisted independently |
| Sources | Name, actionable change count | Existing monitoring/kind/result scopes |
| Groups | Name, eligible update count | All or updates |
| Instructions | Name, recent modification | All, referenced, unreferenced |
| Backups | Newest, oldest, largest | Type, Agent, eligible, protected |

## Invariants

- Use shared SortMenu, CatalogFilters/FilterPopover, and SelectControl. No new dependencies.
- Sort existing inventories only; do not rescan, fetch, or modify canonical resources.
- Merge partial device-local preferences per view. Keep search transient and preserve selection.
- Unknown source dates sort last; do not manufacture dates from import/check times.
- Count distinct references and group members. Disabled/removed/failed Skills are not updates.
- Backup visibility never narrows retention cleanup or changes deletion eligibility.
- Filtering within a modal owns focus and Escape without dismissing the parent.
- Instructions keeps full-width search at minimum size; control geometry remains standard.

## Evidence

Tests use only synthetic data, isolated Agent homes, and fake executables; no production resources
are touched.

- Current build: `5aa39f56bf15`; `npm run build` passed (TypeScript, main, preload, renderer).
- 109 affected unit/renderer tests passed across ten files, including stable sorting, unknown dates,
  distinct references, 500-record catalogs, per-view preference merging, retained selection,
  eligibility invariance, and shared modal controls.
- Three new Electron scenarios passed: English, Simplified Chinese, Traditional Chinese; Skills,
  sources, Groups, Instructions at 920/1180/1440; backup modal at 920/1440. Assertions cover input
  width, adjacent button height/center/gaps, overflow, menus in viewport, Tab/Escape ownership,
  restart persistence, and unchanged Skill content.
- Three existing Electron workflows passed: Skills navigation context, tag filtering, individual
  backup deletion and retention cleanup. Seven component-policy/product-contract checks passed.
- Styles, module budgets, Target boundaries, translations, feature evidence, UI contracts, and
  `git diff --check` passed.
- Fresh screenshot evidence: `/private/tmp/agentenv-catalog-sort-captures`, including expanded sort
  and filter menus. Pixel inspection covered minimum Instructions, minimum Groups, maximum Sources,
  backup catalog/menu, and minimum backup filters. It caught and corrected compressed search and
  incorrectly separated toolbar controls before completion.
- The new Electron file is registered with the serialized full-suite scheduler. This change was
  not validated with the entire release suite, a packaged build, or Windows/Linux native pixels.
