# Worktree Review Controls

## Changes

- AI analysis distinguishes truncated responses, invalid JSON, invalid fields and
  invalid envelopes without logging response content. Single JSON fences, optional
  empty fields and exact citation formatting are accepted. Unverifiable citations
  are removed and findings explicitly marked unverified, rather than discarding
  all findings. Unusable responses preserve prior results; no automatic retry.
- Worktree analysis actions use the fixed shared dialog footer, including progress,
  stop and regeneration. Errors retain inline diagnostic-copy support.
- Repositories use the shared disclosure component and persist collapsed state
  locally. Repository keep decisions cover existing and future linked worktrees;
  clearing them preserves individual decisions. Fresh cleanup checks enforce both.

## Evidence

- A failing regression reproduced the reported generic error using an unknown
  evidence ID before implementation. The user's original model response is not
  available, so its exact cause cannot be determined retrospectively.
- 163 targeted tests passed across AI parsing/cache, Worktree service, inventory
  cache, analysis, IPC, UI state and renderer workflows.
- Rebuilt Electron: three locale workflows passed (English, Simplified Chinese,
  Traditional Chinese), including 920x620, 1180x728 and 1440x900 geometry checks,
  visible fixed-footer analysis actions, collapse/expand and repository keep/unkeep
  persistence. Screenshots inspected at minimum size for the list and analysis
  entry/result. Fixtures use temporary repositories and a local fake AI service.
- Build/type check, module budgets, translations, CSS and UI-contract audits passed.
- Captures: `/tmp/agentenv-worktree-review-20261008/`.

## Boundaries

AI findings never authorize deletion or change Git safety rules. No real AI credits,
user worktrees, full-suite run or packaged release were used for validation.
