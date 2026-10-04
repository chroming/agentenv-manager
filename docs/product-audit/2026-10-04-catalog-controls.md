# Catalog Control Composition

## Defect and Ownership

The pages reused buttons and inputs but independently composed their toolbars. Search widths,
control density, filter reset actions and page-specific CSS consequently drifted. Replacing
individual controls was insufficient; their composition needs a shared owner.

`CatalogToolbar` now owns two layouts:

- `wide`: bounded search, adjacent sort/filter controls, and trailing collection actions.
- `pane`: full-width search above a compact count/context and controls row.

Skills, Sources, Groups and Worktrees use `wide`. Instructions and Conversations use `pane`.
Backups retains its search-free dialog header and reuses the shared filter/reset primitives.
View tabs remain view tabs; Worktrees All/Review/Kept are now status filter options, not a
competing tab treatment. Settings category navigation is unchanged.

## Invariants

- SearchField owns its default search icon. Controls share the default height token.
- Filters use a quiet active dot, with the selected value in the popover and trigger hover
  description. Sort is a menu trigger, not a pressed toggle; custom sort uses accent ink.
- Clear filters has one label, footer placement and size. It does not reset search or sorting.
- Conversation counts remain visible as loaded/total plus size; the complete localized
  explanation is available on hover. Pagination and size calculation are unchanged.
- Sorting criteria, visible sort metrics, saved preferences and backend operations are unchanged.
- Page CSS must not redefine shared toolbar internals. The CSS ownership audit and UI contract
  audit enforce the shared owner; Electron assertions verify actual geometry and overflow.

## Evidence

- Current Electron source identity: `ec92c5289b40`; current-build verification passed.
- TypeScript and production Electron build passed.
- 192 targeted unit/renderer tests passed across 15 files, covering the affected pages,
  sort/filter behavior, persistence helpers, keyboard dismissal and shared primitives.
- Seven Catalogs, Worktrees and Conversations Electron scenarios passed. Catalogs and Worktrees
  cover en/zh_CN/zh_TW at 920/1180/1440 widths. Geometry checks assert shared heights, search
  widths, adjacent controls, containment and cross-view column positions.
- Source merge selection, selected Worktree actions, filter popovers, compact Conversation
  counts and visible sort metrics are included in the current-build desktop evidence.
- Four additional existing Electron scenarios passed: collection commands in en/zh_CN,
  100/500-Skill library behavior at supported viewports, and opt-in local/SSH history search.
  The filtered run skipped 162 unrelated scenarios; this was not a full release test run.
- Fresh mock captures are under `/private/tmp/agentenv-catalog-controls/` in `catalog`,
  `worktrees` and `conversations`. Pixel inspection covered minimum-width Skills, filters,
  traditional-Chinese source merge, Worktrees, compact Conversation counts and wide Instructions.
- CSS ownership, UI contract and module audits passed. No dependencies were added and no real
  Agent resources or histories were modified by the isolated test fixtures.
- Packaged builds and native Windows/Linux visual validation were not run for this change.
