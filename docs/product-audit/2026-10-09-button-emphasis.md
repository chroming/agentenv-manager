# Button emphasis refinement

## Contract

Routine checks and copying use named IconButton controls with hover and busy feedback.
Consequential commands keep explicit text. Rare connection administration belongs in
ToolbarOverflowMenu; it is not a competing primary action.

Continue retains its text and disclosure arrow, matching its sibling control height,
but uses a neutral surface and intrinsic width instead of a fixed 112px primary button.
Device Sync Check and app-update Check use IconButton. Disconnect moves to the sync
overflow menu. History location copying has local copied/error feedback. Footer rules
target text buttons rather than overriding every descendant button, including icons.

## Evidence

Build/type check, 55 renderer tests, UI contract and translation audits passed. Three
native Electron scenarios passed for Conversations, Device Sync and desktop refresh;
the sync scenario was rerun with explicit overflow-menu assertions. Reviewed minimum
window captures under `/tmp/agentenv-button-refinement-20261009`.

Apply, recovery, restart/update, deletion and AI generation retain text. No real
history, remote environment or sync repository was modified by these isolated tests.
This is targeted verification, not a complete packaged-release validation.
