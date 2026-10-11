# Worktree exclusion controls

## Change evidence

- Problem: a verbose batch action and bookmark metaphor obscured cleanup selection and repository exclusion; excluded repositories stayed mixed with actionable ones.
- Contract: retain all data and existing exclusion safety while making scope and reversal discoverable.
- Owners: Worktree presentation and ordering, shared IconButton, SectionLabel and ResourceDisclosureSection. No new page CSS or storage schema.
- Batch selection is icon-only with tooltip and accessible name. Ignore uses EyeOff; its inverse uses Eye.
- Ignored repositories follow active repositories in a named section. Individually kept trees follow normal rows within their repository. Existing user sort remains stable within partitions.
- Repository ignore does not erase individual keep markers or change scan coverage.

## Evidence receipt

- Build/type checking passed; UI contracts, module budgets and translation audits passed.
- Worktree renderer: 34 tests passed, including exclusion ordering, icon-only selection and reversal.
- Native Electron: 3 locale cases passed with 920/1180/1440-width checks using isolated Git fixtures.
- Captures: `/tmp/agentenv-worktree-ignore-20261009`; reviewed Chinese minimum-width ignored section pixels.
- No real user Worktrees or Git history changed. Full release suite and packaged build were not run.
