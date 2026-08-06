# Single-object Workspace Layout

## Product decision

Profiles and Workspaces use a fixed global navigation plus one dominant object workspace. Their object collections remain available through a temporary, searchable switcher instead of occupying a permanent middle column. Conversations keeps its list-detail layout because scanning and switching between records is its primary task.

```text
Core job -> compose or inspect one Profile or Workspace
Proposed constraint -> keep every object visible in a permanent list
Value lost if literal -> the editor is compressed, hierarchy is noisy, and small windows become three competing columns
Recommended boundary -> stable global navigation, one full-width object workspace, and a temporary object switcher

User intent -> choose another object and continue working
Conditional branches -> no objects, search miss, missing object, unsaved Profile, loading object
Persisted effects -> none from opening or searching; selection changes renderer state only
Recovery -> Escape or outside click closes the switcher, focus returns to its trigger, and dirty Profile switching keeps Save/Discard/Cancel protection
```

## Feature Admission Card

### Core user outcome

The user can identify the current Profile or Workspace, switch to another one without losing context, and use the full application width for the selected object's work.

### Object, owner, scope, and source of truth

- Profiles remain owned by the Profile store and selected through the existing Profile selection controller.
- Workspaces remain device-local folder references owned by the Workspace service.
- The switcher owns only transient open, query, and focus state. It does not duplicate, cache, reorder, or persist domain objects.
- Global navigation remains the application shell owner. The switcher is page-local navigation and never becomes another sidebar.

### Non-goals

- No new Project, Workspace group, recent-item, pinning, or tab model.
- No automatic sidebar collapse or responsive fallback to the old permanent middle column.
- No change to Profile Save, Compare, Apply, Workspace file mutation, or recovery semantics.
- Skills, Agents, Settings, and Conversations are not forced into this layout.

### Capability matrix

| Surface | macOS | Windows | Linux | Notes |
|---|---|---|---|---|
| Profiles | supported | supported | supported | Renderer-only layout; all registered Agents use the same selection controller |
| Workspaces | supported | supported | supported | Renderer-only layout; folder and Agent capabilities are unchanged |
| Conversations | not applicable | not applicable | not applicable | Retains scan-first list-detail layout |
| Skills, Agents, Settings | not applicable | not applicable | not applicable | Existing task-specific projections remain |

### State and effect matrix

| State | Visible result | Commands | Durable or external effect |
|---|---|---|---|
| Closed | Current object trigger and full workspace | Open switcher | None |
| Open | Anchored search, object rows, selected marker, create/add footer | Search, choose, create/add, close | None until an existing command is chosen |
| Search empty | Stable popover with `No matching` state | Clear query, create/add, close | None |
| No objects | Full-width empty state and create/add command | Create Profile or Add folder | Existing command contract |
| Loading | Stable selected workspace with local progress | Close switcher; domain controls follow existing availability | None from the switcher |
| Dirty Profile switch | Existing Save/Discard/Cancel guard | Save and switch, Discard and switch, Cancel | Existing Profile persistence semantics |
| Selected object missing | Deterministic first valid object or empty state | Choose another, reconnect/remove where supported | Existing command contract |
| Error | Error remains local to the affected workspace | Retry or close | No switcher mutation |
| Dismissed | Popover closes and focus returns to trigger | Reopen | None |

Semantic no-op: selecting the already current object closes the switcher without reloading or writing. Stale list data is resolved by the existing page refresh path. The switcher has no rollback path because it performs no persistent mutation.

## Information architecture

```text
Global sidebar
  Profiles
    page identity
    current Profile switcher
    full-width Profile workspace
  Workspaces
    page identity and Refresh
    current Workspace switcher
    full-width Workspace inspector
```

- The current-object trigger displays identity and a compact state summary, not a toolbar-sized explanation.
- The popover is anchored to that trigger, is approximately 320 px wide, and has one scroll region.
- Rows contain object icon, name, one compact status line, and a selected check. Secondary row actions remain in the existing context or More menu.
- `New Profile` and `Add folder` live in the switcher footer and the corresponding empty state. They do not compete with Save, Compare, Apply, or Open.
- Profiles keeps Save, Compare, and Apply near the selected Profile. Workspaces keeps Open near the selected folder.

## Shared component ownership

| Visible structure | Shared component | Owner |
|---|---|---|
| Current object and chevron | `ObjectSwitcher` trigger | shared pattern styles |
| Anchored layer | `ObjectSwitcher` popover | shared overlay and pattern styles |
| Search | `SearchField` | shared field styles |
| Object row | `SelectableListRow` | shared pattern styles |
| Create/add footer | `Button` | shared button styles |
| Full-width selected content | `SingleObjectWorkspace` | shared pattern styles |
| Page title/actions | `PageHeader`, `ControlGroup` | shared pattern styles |
| Empty states | `EmptyState` | shared pattern styles |

Page styles may arrange Profile- or Workspace-specific content but must not redefine switcher, row, field, button, popover, or focus geometry.

## Interaction contract

- Trigger click opens the switcher and focuses search. Arrow Down from the trigger may open and focus the selected row.
- Escape and safe outside click close it. Focus returns to the trigger.
- Enter or click selects a row. Choosing the current row is a semantic no-op.
- Search is local and immediate. It does not trigger refresh, persistence, or background work.
- The switcher stays within the application viewport at minimum size and never creates page-level horizontal scroll.
- Optional enrichment must not blank the selected workspace or move the trigger.
- Opening, closing, and selection feedback uses restrained 120-160 ms opacity/scale continuity; reduced motion removes the transform and keeps visibility feedback.

## Change Evidence Card

```text
Reported symptom: Profiles and Workspaces feel crowded in a permanent three-column layout.
Governing contract and user intent: one dominant selected object with quick, recoverable switching.
Defect class and owning layer: shared workspace composition and page-level object navigation.
Sibling surfaces, states, locales, and viewports: Profiles and Workspaces; zero/one/many, dirty, loading, missing, search miss; en/zh-CN/zh-TW; 920x620 and 1180x728.
Required proof and artifact identity: component behavior, renderer geometry, rebuilt Electron desktop E2E, and reviewed critical captures from the same build.
```

## Evidence and completion boundary

- Component: open, search, choose, current-object no-op, Escape, outside click, focus return, and no matches.
- Profiles: dirty-switch guard still owns Save/Discard/Cancel; selected Profile does not reorder; Save/Compare/Apply remain reachable at both supported sizes.
- Workspaces: selected folder persists through refresh when present; Add folder, context actions, and Open retain existing effects.
- Geometry: no horizontal scroll or clipped popover at 920x620 and 1180x728 in all three locales.
- Pixels: cold-read Profiles and Workspaces at minimum/default size, switcher open/closed, zero/one/many objects.
- Desktop: rebuild before Electron E2E and screenshots; packaged proof is not required because native APIs and persisted formats are unchanged.

The change is complete when a first-time user can identify the current object, switch objects without a permanent list consuming workspace width, and predict that opening or searching the switcher changes no files or Agent state.
