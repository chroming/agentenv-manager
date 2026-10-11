# Stable metadata across sorting

## Contract and ownership

Sorting must not remove source actions, substitute a resource's identity, or move
last-reply timestamps. Required decision information remains visible; supplemental
sort metrics may appear without introducing another row.

- Worktrees retain branch and size, with repository total size independent of sort.
- Skill source labels and source open/copy actions remain available under every sort.
- Skill groups show nonzero update counts under every sort, without zero-update noise.
- Conversation last-reply time stays in the primary trailing position; message-count
  sorting adds its metric to secondary metadata.
- Instructions use the existing selectable-row status slot for a stable short date.

CatalogSortMetric owns compact date formatting. Its accessible name and hover detail
retain the full timestamp. Unknown sizes remain unavailable, not zero. No additional
filesystem scans, resource writes, or automatic update checks were introduced.

## Evidence receipt

Build/type check and 89 renderer tests passed. Eight native Electron scenarios across
Worktrees, catalogs, Instructions and Conversations passed; Worktrees/catalogs cover
English, Simplified and Traditional Chinese, and 920/1180/1440 widths. Initial native
checks caught squeezed date and size metrics; those were corrected before approval.
UI contracts, CSS and translation audits passed.

Reviewed minimum-window Skills, Worktrees and Instructions captures under
`/tmp/agentenv-sort-stability`. Tests use synthetic data and isolated homes. This is
targeted verification, not a full release or packaged-runtime certification.
