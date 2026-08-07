# Visual Center And Composition

## Outcome

AgentEnv keeps fixed global navigation while each destination chooses content geometry from its repeated task. Profiles and Workspaces use a single-object workspace; Skills uses a dense catalog; Agents uses a continuous management list; Conversations keeps a persistent history list and transcript; Settings uses preference rows. Each page has one obvious visual center without deleting or compressing semantically necessary panes.

This is a renderer-only composition change. It does not change Profile, Skill, Agent, Workspace, Conversation, Settings, Apply, or filesystem ownership.

## Composition Contract

| Surface | Primary visual center | Supporting structure | Must not compete |
| --- | --- | --- | --- |
| Profiles | selected Profile identity and current commit action | quiet Profile switcher and flat resource composer | full-height frame, multiple filled actions |
| Skills | Skill collection and maintenance state | one compact control deck | primary Import fill, separate repeated action rail, action button overlaid in Status |
| Agents | installed Agent rows and actionable exceptions | quiet detected/Profile summary | healthy status banner, ambiguous trailing navigation arrows |
| Workspaces | selected directory identity and Open | quiet workspace switcher and local resources | full-height frame around empty space |
| Conversations | selected transcript | persistent, usable-width history list and Continue | over-compressed history pane, stacked filter controls, boxed routine messages |
| Settings | current preference group | shared line TabBar and natural-height preference rows | full-height outer card, fixed outer measure that leaves the workspace unused |

## Shared Owners

- `SingleObjectWorkspace` owns framed and open surface variants.
- `PageHeader` owns page identity and quiet global context.
- `InspectorHeader` owns selected-object identity and commands.
- Shared `Button`, `IconButton`, `ControlGroup`, and row patterns own control geometry.
- Shared `TabBar` owns peer-view navigation. A page must not restyle `SegmentedControl` into tabs.
- Shared interactive status owns non-mutating review and error-detail entry. It keeps truthful state wording and never executes the mutation itself.
- Page styles may arrange these primitives but must not create a second primitive implementation.

## State And Viewport Matrix

- Empty, loading, healthy, actionable warning, error, dirty, saved, and working states retain stable bounds.
- English, Simplified Chinese, and Traditional Chinese copy must remain contained.
- `920 x 620`, `1180 x 728`, and `1440 x 900` are required desktop viewports. Settings uses the available workspace while constraining copy and control lanes rather than clipping the entire page to one fixed measure.
- A page may have at most one enabled filled primary commit action in its visible object context.
- Removing a decorative frame must not move scrolling to the document. Lists and detail bodies retain their existing internal scroll owners.
- At minimum width, the Skill catalog uses `Identity / Source / Status / More`; Usage may disappear. `Update available` and `Check failed` may open a non-mutating review/detail surface, but no independent button shares that lane.
- Conversations retains three semantic panes at supported widths. Its history list remains at least 280 px wide; search occupies its own row and secondary filters use one shared filter surface.

## Evidence

- Renderer tests cover ready-versus-actionable Agent status and neutral Library import.
- Electron geometry verifies shared page origins, open versus framed surfaces, one-primary-action budgeting, internal scrolling, stable row lanes, and containment at all supported viewports.
- Deterministic Electron captures cover all six pages at minimum, default, and large sizes plus affected collapsed/expanded and idle/working pairs; pixel cold-read checks hierarchy, whitespace, action emphasis, and stable bounds.

## Cross-Surface Parity Gate

| Contract pair | Required equal state | Evidence |
| --- | --- | --- |
| Profiles / Workspaces | selected object, header switcher, populated resources | framed trigger geometry and populated expanded captures at all three viewports |
| Skill list / By source | update available | shared semantic tone plus paired renderer and Electron assertions |
| Agents / Skills | ready page header | title-action center delta and common content origin |
| Profile Skills / Workspace resources | populated and expanded | shared disclosure and resource-row anatomy, not empty-state substitution |

Page styles may arrange a shared primitive but do not own its internal border, radius, height, padding, type scale, icon box, focus state, or selected state. Evidence is invalid when its fixture omits the state under review. Every visual sign-off records the viewport, locale, fixture state, expected scanning anchor, primary action, scroll owner, and screenshot artifact before a pixel cold-read.
