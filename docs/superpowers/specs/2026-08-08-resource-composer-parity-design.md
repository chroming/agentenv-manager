# Resource Composer Parity

## Product decision

Profiles and Workspaces expose the same Instructions, Skills, and MCP resource hierarchy. They
must use one disclosure and expanded-content grammar even though Profile rows edit saved intent
and Workspace rows inspect or mutate project-owned files.

```text
Outcome -> users learn one resource-group interaction across Profiles and Workspaces
Owner -> shared Resource Composer primitives own geometry and visual state
Page scope -> pages provide semantic content, policy controls, and page-level scroll allocation
Regression rule -> expanding one group never resizes or internally reflows a sibling header
```

## Change Evidence Card

**Reported symptom:** Profile and Workspace groups render different expanded structures; Profile
sibling headers visibly move when another group is expanded.

**Governing contract and intent:** A resource group has one collapsed/expanded interaction,
stable sibling header geometry, one toolbar lane, compact resource rows, and one scroll owner.
Later inline headers may move vertically by the inserted panel height; they must not resize,
reflow, or perform a second transient jump.

**Defect class and owner:** Cross-surface parity failure. Both pages import
`ResourceDisclosureSection`, but Profile slot classes, page CSS, and legacy CSS redefine the
shared primitive while Workspaces mostly use its base presentation. The two pages also use
different expansion state models.

**Sibling surfaces and states:** Profiles and Workspaces; Instructions, Skills, MCP; collapsed and
expanded; zero, one, and many rows; working/loading; partial and inspection error; actionless MCP;
Profile, Off, and Agent policy; keyboard focus; minimum/default/large window; English, Simplified
Chinese, and Traditional Chinese.

**Required evidence:** shared component tests, Renderer surface tests, rebuilt Electron geometry
state pairs, paired captures, manual pixel review, style/component audits, and full verification.

## Canonical interaction

- A group header is 54px and uses fixed chevron, icon, identity, summary, and action lanes.
- The whole identity/summary region toggles the group. Actions remain independent controls.
- The description appears only while collapsed.
- At most one group is expanded in each resource composer.
- Expanding a group changes only its own panel. Every sibling header keeps the same x, width,
  height, lane positions, and typography. A later sibling's y-coordinate may change only by the
  inserted panel height, without an additional animation or layout jump.
- The expanded header uses a neutral subtle surface and accent icon/chevron.
- Skills and MCP panels use the same 16px inset surface without connector lines.
- The optional toolbar is 36px and appears only when an action exists.
- Children use compact `ResourceRow` geometry. Identity gets at most two lines; status and actions
  retain stable lanes; long values remain inspectable through existing detail surfaces.
- Empty content uses a compact row/notice rather than a large empty card.
- The expanded panel owns bounded resource scrolling. Nested child lists do not create a second
  competing scrollbar, and the panel itself remains inside the available desktop viewport.

## Semantic differences

- Profiles add the existing Profile/Off/Agent policy control to the shared header.
- Workspaces show only the current resource count in the shared summary lane.
- Profile resources can edit saved intent. Off and Agent projections remain visible but read-only.
- Workspace resources remain project-owned regular files; supported actions are edit, copy, or
  remove. MCP remains detected-only.
- Profile Instructions use an inline editor; Workspace Instructions remain file rows with an edit
  dialog. Their expanded container geometry still follows the same composer contract.

## Ownership

- `ResourceDisclosureSection` owns disclosure semantics and header/panel geometry.
- A shared exclusive-disclosure controller owns `expandedId` and toggle behavior on both surfaces.
- A shared Resource Composer composition owns toolbar, compact empty state, nested panel, and
  stable expansion presentation.
- `ProfileComposerSection` becomes a thin semantic wrapper that supplies policy state.
- `ProjectsWorkspace` supplies Workspace rows and actions through the same shared composition.
- Page CSS may allocate available height and arrange semantic content. It may not redefine shared
  border, height, padding, icon slot, typography, focus, hover, or expanded-state geometry.
- Profile geometry slot aliases are removed. Obsolete Profile rules in legacy and page styles are
  removed instead of overridden again, and the style audit rejects future page-owned redraws.

## Completion contract

The change is complete when paired Profiles/Workspaces captures from the same rebuilt artifact,
fixture, locale, viewport, resource kind, and state show the same header, inset, toolbar, row, and
empty-state grammar; sibling header size and internal lanes are invariant across expansion; only
one group is expanded per surface; the activated header retains focus; all interactions remain
keyboard accessible; and the rebuilt full product verification suite passes.
