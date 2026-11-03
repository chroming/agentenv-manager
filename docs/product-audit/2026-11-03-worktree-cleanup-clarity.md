# Worktree cleanup clarity

## Change Evidence Card

- Outcome: find unwanted working directories, choose them, review actual effects once,
  remove safely, and recover when needed. Risk 9, frequency 5, density 7,
  visual expression 2, motion 2.
- Defect class: opaque review state, misleading automatic-selection scope,
  lifecycle-oriented commands, and incomplete disk/recovery feedback.
- Ownership: Git remains registration/content truth; device-local settings own
  exclusions; inventory/cache/measurements and AI are advisory, never deletion authority.
- Goal preservation: simplify user decisions, not backup/stale checks. Dirty and
  unconfirmed trees remain manually selectable; automatic picks stay strict.
- Persisted chain: selection (no writes) -> fresh previews -> explicit confirmation
  -> verified recovery copy/reference -> Git removal -> verification -> recovery.
- Excluded effects: no branch/remote removal, automatic AI calls, unapproved force,
  omission of ignored files, or expiry of unique uncommitted recovery content.

## UI contract and component map

- Keep the current shell, catalog toolbar, grouped list, body scroll owner and modal.
- ResourceDisclosureSection / ResourceRow / AlignedResourceList retain group/row geometry.
- One WorktreeSelectionMenu composition uses ToolbarOverflowMenu's named button
  trigger variant for global and repository scope. No duplicate selection checkbox.
  The shared wrapped-label variant keeps consequential menu labels readable without
  widening the page or changing unrelated menus.
- ChoiceInput remains the per-tree manual selection control. Automatic selection
  explicitly requires integrated, unchanged trees without ignored local content.
- No zero-selection batch strip. Selected actions are contextual and use Button;
  destructive confirmation retains a visible verb, count, and danger treatment.
- InteractiveStatus shows concrete facts, not a generic backend classification.
- DetailList, ResourceDisclosureSection and AIAnalysisReview separate local changes,
  optional on-demand analysis and collapsed Git details.
- WorktreeCleanupReview composes existing rows, notices and progress; opens before
  preparation finishes, keeps failures visible, and allows per-item retry. Removal
  stays disabled until preparation completes. Failed items are excluded explicitly.
- DialogHeader/Body/Footer, DiagnosticMessage and OperationStatusBar retain their owners.
- Default emphasis: worktree identity -> concrete local state -> selected removal.
  Dates/sizes remain neutral. Refresh/filter/sort/recovery stay familiar utilities.
- Backups are inventory-visible in the existing backup manager, not a new destination.
  Incomplete/unique recovery copies cannot expire under ordinary backup retention.

## Evidence map

Domain: automatic/manual origins; protected states; full source/copy hashes; stale
previews; recovery inventory/path integrity; progress must be best effort and bounded.
Renderer: zero/many selected; filtered/repository selection; streaming preparation;
per-item failure/retry; no destructive call before confirmation; concrete status;
unknown metrics remain actionable; unrelated progress ignored.
Native: rebuilt artifact, fake Home and real temporary Git repositories; en/zh_CN/zh_TW
at 920x620, 1180x728 and 1440x900; default/selected/preparing/error/confirm/results,
expanded/collapsed details, ignore/recovery and safe scrolling/control containment.
Existing user data must not be touched by verification. Packaged and other-platform
runtime evidence is separate from local native evidence.

## Completion receipt

- Implemented with the existing destructive safety gates unchanged: exact issued
  preview, fresh Git/content fingerprints, full verified local-copy and index backup,
  retained commit refs, sequential repository mutations and post-removal verification.
- Build: source `64427d492d91f338ae274ede10788fc3e9542c2fe4b64f79208f3d41860b8d0a`,
  artifact `cd353d7c783300315e3edd104d469247993b9fd5a65d95edff1ab621e3026285`.
- Domain/Renderer/non-Electron integration: 333 files, 2648 tests passed. The reviewed
  visual-hash configuration and shared menu tests were also checked separately.
- Native Electron: en/zh_CN/zh_TW Worktree workflows passed at 920/1180/1440 widths;
  separate protected-recovery manager workflow passed on the same artifact. Includes
  real temporary Git removal/restore, staged and ignored-file restoration, restart,
  partial preview failure/retry and native Settings navigation during a cleanup.
- Navigation leaves the current transaction to finish and stops the remaining queue.
  A normal unchanged journal is not labeled incomplete merely because redundant
  payloads were deliberately discarded. Both review findings have regression tests.
- Visual: inspected default/selected, selection menus, preparing/error/retry, mixed
  confirmation, collapsed/expanded Git details, results and protected recovery at
  minimum size. Ten reviewed critical captures match the final captures byte-for-byte;
  no pixel tolerance was increased. Captures: `/tmp/aem-worktrees-clarity-final`.
- Native evidence uses fake Home and temporary repositories; model responses are
  fixture-local. No real Agent resources or user worktrees were changed.
- Remaining boundary: logical sizes are not physical allocated blocks; bounded
  backup metrics may be lower bounds. Unique/incomplete recovery content remains
  protected from ordinary expiry and manual disposal. Packaged and native Windows/
  Linux runtime approval, and the unrelated full visual suite, were not run here.
