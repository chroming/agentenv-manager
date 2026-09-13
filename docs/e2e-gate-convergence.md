# Desktop regression gate convergence

## Change evidence card

- Reported symptom: 31 desktop assertions and the Target boundary audit failed after the complete Skill reliability run.
- Contract: preserve all behavioral coverage; current command placement, icon-only controls and hidden secondary information are intentional. Tests must verify those contracts, not restore obsolete UI.
- Owners: shared dialog geometry assertions, command helpers and data-ready waits; Profile page grid tracks; history source adapter.
- Siblings: Skill list/source/group projections, Profile and Workspace dialogs, Agents, Conversations and Settings; minimum/default/large viewports and supported locales.
- Proof: rerun the failed scenarios, then the complete registered test pool and audits. Rebuild before native Electron checks; inspect populated and expanded Profile screenshots.

## Invariants

- Footer controls use the named dialog control height. Equal heights and non-overlapping header/body/footer remain mandatory.
- Removing the page heading must not leave the detail workspace in an intrinsic-height grid track. Expansion and loading keep the workspace bounds stable.
- Visible page readiness is distinct from asynchronous data readiness. Persistence tests wait for saved rows, not only their parent region.
- Compact commands retain accessible names and reachable menu actions. Icon buttons remain square, centered and aligned at every tested size.
- Source columns may receive more width than short Skill names. Row containment and header/cell alignment remain mandatory.
- Agent-specific history paths belong to adapters; the generic controller preserves consent and source identity.
- Hash migration processes at most four independent Library directories together and awaits every write before releasing the migration lock. Per-file preimage checks, atomic writes and failed-path retries remain intact.
- Tooltip checks enter from outside the target and wait for visibility before reading content. Native hover delivery is not equivalent to DOM readiness.

## Verification

- Completed 2026-09-13 against rebuilt source artifact `ab50860e324f` (597 source files). Build and TypeScript checks passed.
- Full registered non-Electron pool: 286 files, 2,038 tests passed, zero failed or skipped. Report: `/tmp/aem-final-parallel.json`.
- Full registered Electron pool: 182/182 passed, exact coverage verified by the scheduler, zero failed or skipped. Report: `/tmp/aem-final-electron.json`.
- All six audits passed: styles, module budgets, Target boundaries, translations, feature evidence and UI contracts.
- The first complete rerun exposed a native-hover timing failure; the existing bounded hover helper replaced a one-shot hover. The subsequent complete run passed, not only the isolated retry.
- The scale test covers 100/500 Skills at minimum/default viewports with unchanged startup and interaction budgets. Independent-directory migration removed cumulative serial startup latency; corrupt metadata and scoped retry tests still pass.
- Real layout corrections: stable Profile workspace grid tracks during expansion/loading, shared page-header vertical alignment, and Source child identity indentation. Tests retain containment, typography and geometry checks instead of restoring removed headings or secondary commands.
- Inspected rebuilt mock-data captures under `/tmp/aem-gate-captures/current/`: minimum-width Agents, expanded Profiles, English/Chinese catalog states and Workspace details. Multi-size geometry checks cover 920/1180/1440. These checks do not establish visual perfection for every possible user dataset.
- No packaged release smoke or real Windows/Linux/SSH machine validation was performed in this repair. Electron and SSH fixtures use isolated test data; no real Agent resources were changed.
