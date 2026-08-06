# Conversation Sorting Design

## Feature Admission

**Feature and core user outcome:** Find recent, largest, or longest indexed conversations without rescanning Agent history files.

**Domain object, owner, scope, and source of truth:** `ConversationSummary` remains a derived local-index projection. The conversation index owns sorting; original Agent history files remain read-only and authoritative.

**Non-goals:** Advanced analytics, arbitrary ascending/descending controls, date-range filters, archive management, source-file mutation, or new navigation.

**Capability/support matrix:**

- Updated-time and message-count sorting: supported for every indexed Agent.
- File-size sorting: supported when the adapter exposes a verified file fingerprint; unavailable sizes sort after known sizes.
- macOS, Windows, Linux: supported through the shared SQLite index and renderer.
- `en`, `zh_CN`, `zh_TW`; 920x620 minimum and larger windows: supported.

**State/effect matrix:** Sort changes acknowledge immediately, reload the first indexed page, retain the current selection when still present, and show existing list loading/error feedback. Search, Agent, Workspace, and sort compose. No source files or durable user configuration change; the in-memory workspace view retains the selected sort across navigation. A no-result sort is an ordinary empty result, and stale requests cannot replace a newer selection.

**Shared primitives and rule owners:** `IconButton` and `ActionMenu` own the compact sort control; the search row owns sort placement, while `conversation-list-meta` remains a count-only information row. The existing conversation list row owns size display; the detail metadata row owns message count and size. No new shared component is required.

**Evidence registration:**

- Domain: conversation index store tests cover complete ordering, pagination, unknown sizes, and composed filters.
- Renderer: ConversationWorkspace tests cover sort IPC input, date-group removal, view-state retention, and detail metadata.
- Desktop: Conversations Electron E2E covers minimum-window containment and sorting against indexed fixtures.
- Pixel: a 920x620 capture covers the default and largest-first list states.
- Persistence and packaged mutation evidence are not applicable because this is a read-only index projection.

**Completion boundary:** Sorting is correct across the full filtered index, not only the loaded page; size values are never guessed; original Agent history remains unchanged.

## Interaction Design

The list toolbar keeps search and one fixed-size sort icon on its first row, two symmetric filters on its second row, and the result count alone below them. The sort icon opens a checked menu:

- `Recent` when no query is active; the same default mode reads `Best match` during search.
- `Largest` sorts verified source size descending.
- `Most messages` sorts message count descending.

The trigger's accessible name and tooltip include the current mode, and a non-default mode receives only a restrained active treatment. Date group headers appear only in the default recent/best-match mode. The detail header adds `N messages` and the verified source size. Unknown size is omitted rather than rendered as zero.
