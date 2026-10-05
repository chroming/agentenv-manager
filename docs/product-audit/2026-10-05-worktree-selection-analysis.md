# Worktree Selection and Retention Review

## Change Evidence Card

- Outcome: repository selection includes only visible Clean trees; review-needed
  trees remain individual decisions even when Git can prepare a cleanup preview.
- Reproduction: `WorktreeDialog.test.tsx -t 'never batch-selects'` selected two
  trees instead of one. Cleanup capability was mistaken for reviewed eligibility.
- Owner: shared batch-selection predicate, not Git removal capability. Preserve
  manual review, recovery, fingerprints and fresh pre-removal validation.
- UI owners: Button/ControlGroup, SectionLabel, ResourceRow/AlignedResourceList,
  existing AIAnalysisReview and ModalFrame/DialogHeader/DialogBody/DialogFooter.
- Shell stays unchanged. Repository titles and selection controls share the row
  inset; use a short visible selection label instead of an ambiguous checkbox icon.
- Evidence: renderer regression, real temporary Git fixtures, AI gates/cache tests,
  Electron geometry and rendered captures in en/zh_CN/zh_TW at 920/1180/1440.

## Feature Admission: Worktree Retention Analysis

- Manual optional AI analysis in the existing Worktree review dialog. No network
  request on open, scan or selection; reuse configured service and AI settings.
- Input: a freshly registered, previously discovered local linked worktree; bounded
  local status, local commits, comparison with the main tree and text diffs. No
  remote MR lookup, shell tools, file writes or generated deletion commands.
- Exclude untracked/ignored file bodies and external diff/textconv execution.
  Redact secrets and clearly report omitted evidence and unknown integration.
- Idle: Analyze retention. Working: local progress and Stop. Success: concise
  evidenced recommendation and cached result. Error: same-dialog error/retry.
- Cancellation uses existing analysis cancellation. Disabled AI cannot send requests.
- Same evidence reuses results. Changed evidence changes cache identity; generation
  rechecks identity. Incomplete evidence is partial, never a cleanup authorization.
- Persist only analysis under app-owned ai-analyses; no worktree/Git/branch mutation.
- Recovery: failed requests retain previous results. Closing cancels active requests.
- Safety boundary: AI never checks the manual removal confirmation, selects trees,
  clears a keep marker or bypasses the existing Preview/Remove recovery checks.

## Completion Evidence

- Build: source `f40b851b47134d5e3342dcc5ede5c15d4a75c2ce4b9a8167fddb8eb422b17069`,
  artifact `1130841943b1b3a713618840b13ab9b19e3e7652dd277181a1ae39f271085bd9`.
- `npm run verify:commit`: 2269 non-Electron assertions and 196 desktop assertions
  passed. Style, module, Target, translation, feature and UI-contract audits passed.
- Original batch regression was reproduced before the fix. Tests now exclude a
  review-needed tree even when preview capability is true, and reject freshly
  changed review-needed entries from batch confirmation.
- Native Electron used real isolated Git repositories and a local mock AI endpoint.
  Opening performs zero model requests; manual analysis performs one, leaves the
  removal confirmation unchecked, and reuses persisted advice after restart.
- Runtime action/checkbox right-edge and title/action center deltas are zero at
  920/1180/1440 in en/zh_CN/zh_TW. Dialog and analysis containment assertions passed.
- Inspected nine retention captures plus the updated AI settings capture. Independent
  regeneration passed all nine critical pixel comparisons with 0% changed pixels;
  the comparison thresholds were not changed. Both visual verification commands
  now collect these scenarios, and reviewed hashes are registered.
- Scope: local macOS Electron build, not a packaged Windows/Linux run. AI transport,
  evidence, cancellation and caching use simulated responses; no paid model was
  called and recommendation quality is not claimed. Analysis does not mutate
  original files or Git state; existing deletion and recovery safeguards remain.
