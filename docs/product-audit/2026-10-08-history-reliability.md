# History compatibility and observation reliability

## Scope and intent

Improve the existing unified search without a new navigation destination,
resource deployment matrix, MCP runtime manager, or model gateway. Original
Agent histories remain read-only; only the consented device-local index changes.

The application remains a local-first resource manager. Reference projects are
evidence for file formats and engineering failure cases, not feature roadmaps.

## Change evidence

- Codex discovery accepted JSONL only. It now discovers compressed JSONL locally
  and over SSH, decompressing on the desktop with the existing Node runtime.
- Local text indexing read a transcript once through its adapter and again for
  tool text. The supported text readers now parse one validated content snapshot.
- A damaged replacement could overwrite previously searchable text. Incomplete
  reads now preserve a more complete cached conversation.
- JSONL traversal swallowed parser exceptions along with malformed JSON. Only
  malformed JSON is skipped; actual consumer failures propagate to coverage.
- File observation retries transient missing/busy errors at most twice, without
  changing Apply, ownership, or mutation freshness rules.
- Compression comparisons bind to both file versions and history-source identity.
  Only matching sibling content or complete-line prefixes collapse. Divergent or
  unverified copies remain. A bounded in-memory proof cache avoids repeated full
  reads of unchanged pairs and never serves as a mutation precondition.

## WorkBuddy boundary

The reference JSONL format is implemented with isolated fixtures: user/assistant
text, native title precedence, per-message time, nested histories, and adjacent
workspace metadata. External metadata links are rejected. No resume or move
capability is implied.

The installed WorkBuddy version on this machine has a database rather than a
projects JSONL directory. A read-only schema inspection found session metadata,
not a verified transcript contract. Database history remains unsupported and is
reported explicitly. No database writes, private protocol, cloud requests, or
credential access were added. This is partial WorkBuddy history support, not a
claim that the installed desktop version's complete history is searchable.

## UI and impact decision

No Renderer production changes or new controls are needed. Conversations reuses
the existing HistorySearchSettings and coverage/details surfaces. Original-open
and move stay unavailable where adapters do not declare support.

Skill update already distinguishes Profile references, immediate linked changes,
and copied installs requiring Apply or explicit update opt-in. Preserve this
design and add a mixed-impact regression test instead of creating another usage
matrix or per-Agent deployment controls in Library.

## Evidence boundary

Domain tests cover compressed and corrupt inputs, transient reads, bounded decoded
size, same-ID divergent copies, version/device-scoped deduplication, title priority,
metadata containment, partial WorkBuddy capability, and cache retention.

The existing Electron history workflow now exercises a real compressed local
fixture alongside fake SSH, consent, search, pause, disable, original-file byte
preservation, and 920/1180/1440 English and Chinese captures. A separate desktop
case covers WorkBuddy JSONL search and absence of an unsupported native-open action.

No production Agent data was modified. No packaged installer, live customer SSH
server, or WorkBuddy database transcript is certified by these tests.

## Completion receipt

- Build and TypeScript: passed; Electron source identity `e1ad57c4a857`.
- Related domain/Renderer regression: 22 files, 176 tests passed.
- Electron history E2E: both tests passed against the rebuilt artifact, using
  isolated homes, an isolated Agent discovery path, and fake SSH.
- Target-boundary, feature-evidence, and module-budget audits: passed.
- Existing source dialog and search-result captures inspected at minimum width;
  desktop geometry checks cover 920/1180/1440 and English/Simplified/Traditional
  Chinese. No Renderer markup or CSS changed in production.
- Full repository suite and packaged distribution: not run for this scoped change.
- WorkBuddy database-backed full history remains a known compatibility gap.
