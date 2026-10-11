# Conversation size metadata

Size is basic row metadata, not a size-sort-only metric. Every conversation row
shows its known byte size (including zero) or Unavailable without triggering extra
file reads. Agent identity remains the metadata alignment anchor, followed by size
and existing origin/workspace details. Sorting does not hide or duplicate size.

Verified build/type check, UI contracts, 38 renderer tests and the native Electron
conversation workflow. Native geometry covers 920x620, 1180x728 and 1440x900;
captures are under `/tmp/agentenv-conversation-size-20261009`. Reviewed the 920px
capture for text containment and unchanged row density. A deferred refresh fixture
was limited to one invocation to prevent an unresolved operation leaking into the
next renderer test. No history source or indexing behavior changed.
