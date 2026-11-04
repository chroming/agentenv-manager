# Worktree cleanup: local recovery checks

## Change Evidence Card

- Report: cleanup fails while resolving a pre-existing REBASE_HEAD, or reports an
  unrelated commit-graph error while validating the staged recovery tree.
- Core job: remove explicitly selected working directories to release space while
  protecting their current local content. This is not a repository-repair operation.
- Defect class: local recovery validation accidentally became whole-repository
  health certification. A cached graph and missing historical metadata were promoted
  to deletion prerequisites.
- Owner: Worktree Git-state reads and operation-object recovery. No Agent, Profile,
  shared Git runner, permission, or repository configuration changes.
- Red: two real temporary-repository tests fail on the old implementation: missing
  REBASE_HEAD rejects removal, and an invalid commit-graph breaks recovery fsck.
- Boundary: pin HEAD and existing recovery objects; require current staged objects
  to exist. Distinguish a confirmed already-absent full object ID from a timeout,
  permission error, ambiguity, or wrong-type existing object. Only the former can
  become a durable non-blocking recovery limitation. Metadata itself is still saved.
- Effects: preserve available objects under recovery refs, archive local content
  and operation metadata, record unavailable IDs in the recovery journal. Restore
  reproduces that earlier state and does not promise to repair missing history.
- Performance: traverse only the new recovery tree, not all repository objects or
  cached graphs. Worktree reads retry a derived commit-graph failure without that cache;
  no config or graph file is written. No remote lazy fetch is introduced.
- UI: reuse ResourceRow, InteractiveStatus and Notice. Successful cleanup remains
  Removed; the recovery limitation is information, not a request to fix the repo
  and not a reason to skip later selected worktrees. Recovery retains an info hint.
- Evidence: service removal/restore, missing staged-data protection, wrong-type and
  timeout counterexamples, batch continuation, native minimum-window confirmations
  and results in en/zh_CN/zh_TW, current build identity.

## Space-Reclamation Boundary

This fix scopes the preserved legacy archive path. New cleanup commands have their
own ownership and consent contract in `2026-11-04-worktree-trash-and-delete.md`:
same-volume reversible Trash and explicitly irreversible permanent deletion. They
do not run legacy file-copy or history-object certification. Existing archive
payloads remain protected; their retained size is never reported as freed space.

## Completion Receipt

The two reported failure classes were reproduced in real temporary repositories,
then fixed. Full regression (2,718 tests) and the final rebuilt native Worktree/
legacy-recovery workflows passed; see the companion disposal receipt for the exact
artifact and limits. Domain counterexamples still reject missing staged data,
wrong-type, ambiguous and timed-out object reads. Existing legacy restoration retains
its original metadata without claiming to repair pre-existing missing Git history.
Only isolated fixtures were used; no user Worktree was removed.
