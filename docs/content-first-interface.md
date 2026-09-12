# Content-first desktop presentation

## Outcome and boundary

Make the resource being selected or read the visual focus. Do not replace useful
comparison lists with cards, hide ordinary management commands in overflow menus,
or change the Library, Profile, deployment, recovery, or synchronization models.

## Shared owners

| Surface | Owner | Contract |
| --- | --- | --- |
| Skills, sources, groups | `ResourcePanelToolbar`, `SkillMaintenanceAction` | Same check/update wording, control height and busy feedback. Checks are quiet commands; updating remains a distinct review action. |
| Skill rows | Library column template, `SkillMaintenanceStatus`, `IconButton` | Name gets priority; source text remains clickable/selectable; contextual menus do not repeat framed buttons. |
| Profile and Workspace | `SingleObjectWorkspace` reading width | Header and resource area share a centered maximum 1040px width. Minimum windows use all available width. Actions stay on the right. |
| Resource composition | `ResourceDisclosureSection`, `ResourceRow`, `Switch` | Stable headings, independent expansion, modest group emphasis, normal-weight members, subordinate commands. |
| Instructions | `InstructionContentPreview`, `InstructionDocumentDialog` | Markdown reading by default, Source code available, same preview/edit/maximize dialog. Mode changes never save or Apply. |
| Conversation content | `ReadOnlyMarkdown` | Shared safe Markdown rendering, while preserving conversation-specific code scrolling and layout. |

## Information allocation

- The Tags column exists if any Skill in the entire Library has tags. Filtering
  away tagged Skills must not change column geometry. Empty tag cells remain empty.
- Skill identity keeps its source/custom icon. The Source column does not repeat
  a leading folder/Git icon. Link/copy affordances and full source details remain.
- No update checks is a policy, not a failure or proof of being current. Present
  it as a quiet dash with its explicit accessible name and tooltip. Not checked,
  Up to date, Update available, failures, removals and Disabled remain distinct.
- Source names identify owner/repository or custom name. The second line retains
  the ref and exact directory once; full addresses remain available in overflow
  details. Same-repository directories must remain distinguishable.
- Skill table headers and rows share the same scrolling width, including native
  space-consuming scrollbars. The sticky header belongs inside that scroll owner.
- Keep Agents as a comparison list, Settings as preference rows, and Conversations
  as list/detail. Visual consistency does not require identical page structures.

## Default attention budget

- Opening a page is not a request to configure or clean up everything. Do not turn optional
  setup, ordinary pending changes, or routine discovery into persistent global tasks.
- Agents keeps configuration and pending state on each row. Shared findings have a direct
  neutral command. Only a failed scan adds a compact retry notice; no setup, checking, healthy,
  or duplicate Agent-review banner is rendered.
- Catalog column headings and local/remote location headings use
  `--catalog-header-background`, matching the ordinary content surface. Fine separators and
  typography establish hierarchy; stacked tinted bands are not a default grouping mechanism.
- Needs setup is neutral, not a warning. Unavailable/guarded states, destructive confirmation,
  outside changes, and recovery errors remain distinguishable and actionable.
- Preserve selected/disabled row treatments and actual status meaning. This contract removes
  redundant emphasis, not safety information or access to configuration.

## Discoverability and information access

Quiet presentation must retain a predictable route to both facts and actions.

| Surface | Default | On demand | Conditional action |
| --- | --- | --- | --- |
| Agents, including SSH | Agent, availability, clickable Profile or Configure, lifecycle | Local Skills and recovery in stable menus; runtime evidence in Diagnostics | Open Recovery for recovery-required, scoped shared review when needed |
| Profiles | Selected Profile, target, resource groups and readiness | Composition on expansion; analysis, comparison and recovery in More | Apply preview shows effects; readiness links to its remedy |
| Workspaces | Folder, Agent, Open and resource groups | Local resource content on expansion; recovery in More | Editing previews actual affected files |
| Skills | Name, source, tags and maintenance state | Name opens Files by default; Details exposes versions, provenance, update policy, usage and install paths | Update settings and Review Profiles from Details; update state opens diff |
| Instructions | Name and readable content | References in details | Shared edits disclose affected Profiles before saving |
| Conversations | Title, directory, timestamp and Continue | Copy and migration in object menu; technical metadata on demand | Unsupported continuation retains a reason and supported alternative |
| Settings | Current setting and command | Advanced configuration on expansion | Errors and remediation remain with the affected setting |

- Hover is a preview, not the only route to version, ownership, policy or usage.
- Configuration must be discoverable without hovering the Agent name. Names remain
  shortcuts, and the same intent also has an explicit object-menu entry.
- Diagnostics is read-only information. Stop managing is an object-menu command and
  retains its existing preview, confirmation, backup and recovery behavior.
- Local Skills and recovery do not disappear when the environment summary changes.
  Historical backups alone do not justify a permanent primary-toolbar button.
- File/detail tab changes never fetch an upstream source, mutate data or lose the
  selected file. Details wrap long values and support selection/copy and maximization.
- Verification must test retrieval and action routes, not only absence of banners.

### Change evidence card

- Intent: reduce default attention without removing configuration, provenance or recovery.
- Owner: `TargetEnvironmentSummary`, `TargetWorkspace`, `SkillFileBrowserDialog`.
- Reuse: `TextAction`, `ActionMenuItem`, `ToolbarOverflowMenu`, `DocumentDialogFrame`,
  `TabBar`, `DialogBody`, `ControlGroup`; `DetailList` owns wrapping metadata geometry.
- Scope: local/SSH Agent rows and Library files/details; existing sibling workflows
  retain their context-specific information allocation above.
- Evidence: Renderer routes and tab transitions; rebuilt mock Electron minimum/default/
  wide windows and localized captures; stop-managing/restore end-to-end workflows.

## Reading safety

Markdown uses the existing React Markdown/GFM renderer without raw HTML execution.
Images remain text references, never automatic remote fetches. Only explicit HTTP(S)
link activation can open the external browser. Instructions wrap code and long text;
the original source remains available and editing retains syntax highlighting.

## Evidence required

- Renderer: global Tags predicate across filters, truthful update policies,
  Markdown/source/edit behavior, no image/HTML execution, source scope distinction.
- Electron: 920/1180/1440 (or larger), English/Simplified/Traditional Chinese,
  single/multiple Agents, mixed update states, 0px/15px scrollbars, group toggles
  and scrolling, instruction edit/save/restart persistence.
- Captures: actual rebuilt Electron with mock data, checking content hierarchy as
  well as containment. Geometry passing is not a claim of visual perfection.
- No dependency, native Agent file or deployment-policy changes are part of this work.

## Completion evidence (2026-09-12)

- Rebuilt source fingerprint: `aa7b9540ac65546f6b78145e7de5734c6bf75dedf1d3c9dfa1cb868bec64618f`.
- Tested artifact fingerprint: `12f0e0154b201e9e71ecb4c35ce9377a2bf052e846fb9949bd947a1970c0b636`.
- All 657 Renderer tests passed across 96 files. Fourteen focused Electron tests
  passed, covering catalog geometry, scrolling, group controls, instruction
  editing and persistence, Workspace operations, and AI tag interactions. The
  isolated comparison workflow was also exercised by its capture runner.
- Alignment coverage includes 920/1180/1440 widths, English, Simplified and
  Traditional Chinese, single/multiple Agents, and 0px/15px native scrollbars.
- Generated 207 mock Electron screenshots. Reviewed expected changes and updated
  52 stale visual baselines; retained the other 27 and all existing tolerances.
  A separate fresh Electron capture passed all 79 critical pixel comparisons.
- A deliberately incorrect same-size screenshot was rejected (9.582% difference
  against a 1.200% limit), verifying that the pixel gate still detects regressions.
- Build, style, UI-contract, module, translation, and feature audits passed.

This is macOS Renderer and isolated Electron evidence, not a packaged release,
full backend-suite run, or verification on Windows/Linux. Fixtures and fake CLI
runners do not modify real Agent resources or consume model quota. Pixel and
geometry checks guard known regressions; they do not establish universal visual
correctness or cover every possible user dataset.

### Default-attention refinement evidence

The initial content-first pass still promoted optional setup and review state into a
permanent task strip. This refinement removes that duplicate presentation rather than
only recoloring it. Agent row entry points and the scoped Shared Skills workflow remain.

- Artifact `7560e187c8fd2f60e141cb05474605869011fb53cbac6f503fae0041fedeaf9c`,
  source `d4a824ea369953f36991dea7f89c190157f1084e2f69f727653456c3401aa7e0`.
- All 664 Renderer tests (97 files), six focused Electron tests, build/typecheck,
  style/UI-contract/module/translation/feature audits passed. Comparison captures use
  the existing isolated fake CLI workflow.
- Tests explicitly reject a global strip for checking, setup, ready, no-agents,
  shared-review, and agent-review. Failure/retry and direct configuration remain covered.
- Electron asserts equal catalog-header/content backgrounds at 920/1180/1440 widths,
  in addition to geometry checks. This is necessary because subtle gray/white changes
  may fall below the pixel comparator's existing per-channel tolerance.
- Inspected fresh mock screenshots including English/Simplified/Traditional Chinese,
  local/SSH Agents, setup, shared findings, scan failure, Skills and source updates.
  Updated four reviewed baselines for removed strips and affected modal backgrounds;
  a fresh repeat passed all 79 critical pixel checks without tolerance changes.
- Capture waits for the preceding bulk-update success message to expire before unrelated
  AI-tag/Import captures, avoiding a transient message becoming an accidental baseline.
- Scope remains macOS isolated Electron presentation. No backend/full-release suite,
  packaged distribution, or Windows/Linux runtime approval is claimed.

### Discoverability refinement evidence

- Source `34b9c65e7a5cdf29b833b9ee7f9a620f8791b9d997f1c1f848bbff65437300a6`;
  artifact `b21e3fcbf2f04eaca43bb5e102d74830868bbd34304cda26751e1499f7735e11`.
- All 667 Renderer tests across 97 files passed. Six focused Electron tests cover
  local/SSH action parity, catalog geometry, Skill inspector interaction, and both
  Stop Managing outcomes; the isolated Workspace capture test also passed.
- Fresh mock captures exercise Files/Details switching, selectable wrapped metadata,
  maximization, Agent menus, and 920/1180/1440 layouts. Comparison captures use the
  existing fake CLI runner. All 82 critical pixel checks passed at unchanged tolerances.
- Added three reviewed baselines for Skill details and Agent actions; updated four
  existing baselines for the explicit configuration action and affected modal background.
- Build/typecheck and translation, style, module, UI-contract, and feature audits passed.
- Recovery-required actions open recovery tools directly; Agent history is filtered
  to that Agent, while global history and Local Skills remain available from More.
  Skill facts remain reachable without hover, and opening details makes no mutations.
- Evidence covers macOS isolated Electron, not a packaged release or Windows/Linux.
  No backend ownership, deployment, or real Agent resources were changed.

### Follow-up audit: asynchronous detail states

Change evidence card:

- Intent: inspect the current Skill and its usage without turning unknown data into
  a reassuring claim. Preserve quiet catalogs and existing configuration workflows.
- Defect class: asynchronous projections used empty inventory as installation evidence,
  retained an old settings entry, or reused a previous Skill's file selection.
- Owners: Library panel inventory projection and the shared Skill file inspector.
  Siblings: name-hover usage, Details, Update settings, Files and read-error recovery.
- Invariants: checking/failed/partial scans are not zero installs; known copies remain
  visible. An object switch resets file state, and Retry retries the selected file
  (or reloads a failed tree), not a different default document.
- Effects: read-only file and inventory inspection; existing Update settings Save remains
  the sole settings mutation. No Agent, ownership, Apply, or Library mutation changes.
- Proof: delayed/empty/failed tree and fresh-metadata Renderer cases, native Electron
  long-error containment/selection/Retry/Escape at 920/1180/1440, plus sibling captures.

Final source: `c667e385facbc4aafa34e907bbbd80e5da17db9edac6159aef3b63227fa67537`.
Final artifact: `778a361e773eaf5c0e75b3721f4cc4ddd5581c8274e3d22462ee6bf8fb694d85`.

- 671 Renderer tests (97 files) and eight focused Electron tests passed, including
  the isolated Workspace test. Comparison captures exercised the fake CLI runner.
- Long read errors remain selectable and contain their Retry action. Failed trees
  no longer present the empty-folder message. Known copies survive incomplete scans.
- Build/typecheck, translations, shared UI contracts, CSS/module budgets and feature
  evidence audits passed. No new dependency was introduced.
- A fresh serial capture run on the final artifact passed all 82 critical pixel
  comparisons without tolerance changes. Reviewed the seven destinations and updated
  only the two inspector baselines whose empty-inventory wording changed. Separate
  captures cover long errors at 920/1180/1440 and successful recovery.
- Earlier overlapping capture attempts interfered through the capture runner's fixed
  temporary fixture directory and were discarded. Do not overlap `capture-profiles`
  invocations; those failed attempts are not evidence of product behavior.
- This is macOS isolated Electron evidence, not a packaged or Windows/Linux release
  approval, full backend-suite run, or a guarantee against all possible user datasets.
