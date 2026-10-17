# Conversation deletion and recovery

## Feature Admission: Recoverable Conversation Deletion

Core job: manage searchable Agent history with recoverable, explicit deletion.
Reuse verified BackupStore payloads and BackupManagerDialog; distinguish recovery
points (undo changes) from recently deleted conversations (restore objects).

Contract:
- Local file-backed adapters explicitly enumerate the transcript and associated
  files. Database-backed and SSH histories remain read-only for deletion.
- Preview binds the exact file set and hashes. Reject changed/recently written
  files, symlinks and paths outside declared history roots.
- Verify a private backup before removing originals. Persist phase before writes;
  incomplete operations are protected from retention cleanup and remain restorable.
- Serialize history indexing with mutations; remove matching cached records and
  search entries after deletion. No model calls and no native Agent config writes.
- Restore never overwrites an occupied destination. Retain recovery payloads on
  every failure. Restored files become searchable on the next permitted refresh.
- Recently deleted retention defaults to 30 days independently of recovery points;
  support never-expire. Expiration applies only to completed operations.
- Native Agent shared history/title databases are not rewritten; their recent
  session lists may retain stale entries. State this in the deletion preview.

UI: existing context menu -> shared confirmation dialog; More -> Recently deleted
opens the shared backup manager. Settings exposes Recovery points / Recently deleted.
Use existing dialog, button, diagnostic, file-list and filter primitives.

Evidence: isolated file fixtures, stale previews, related files, backup corruption,
partial deletion/recovery, occupied destinations, retention separation, indexing
serialization, and renderer actions. Never delete real development histories.

Support: local Codex, Claude Code and Pi file-backed histories. Other Agents,
SSH histories and user-added arbitrary source folders do not expose Delete.
Native recent-session databases are deliberately outside this file-deletion scope.
The recent-write check is a guard, not proof of inactivity: users must close the
original Agent session before deletion. No universal cross-process lock is assumed.

Shared surfaces use BackupRecoveryManager and BackupManagerDialog from both
Conversations and Settings. ConversationDeletionDialog uses ModalFrame,
DialogHeader/Body/Footer, Button and DiagnosticMessage. There is no separate
trash manager or page-specific control styling.

## Completion Evidence Receipt

- Electron source fingerprint: `92232c28925f` (641 source files); TypeScript and
  production build passed. No third-party dependency was added.
- Related domain/renderer run: 28 files, 311 tests passed; the additional persisted
  interrupted-deletion recovery test passed in the focused deletion suite.
- Existing App recovery tests: 15 passed (other App cases were not selected).
- Electron: English and Simplified Chinese deletion/Undo/restart/restore flows,
  occupied-destination protection, and the existing Settings backup cleanup flow
  passed (3 cases). All use isolated Fake Home fixtures, not real histories.
- Viewports: deletion at 920/1180/1440; shared recovery at 920/1440; restore and
  restore errors at 920. Full captures were visually inspected; critical baselines
  mask only random fixture paths and timestamps. No extra page CSS was introduced.
- Style ownership, module budget, Target boundaries, translations, feature
  registration and UI contract audits passed. Capture scripts use the new shared
  dialog title and generate the registered deletion/recovery baselines.
- Highest verified layer: current macOS Electron desktop process and persisted
  files/index. Packaged artifacts and Windows/Linux desktop runs were not tested.
  Agent-native cached recent lists may retain stale entries; active external
  writers cannot be proven absent by an mtime check alone.
