# Control scale convergence

## Change evidence

- Symptom: related controls looked disproportionate despite shared component imports.
- Owner: control tokens and IconButton, not per-page size overrides.
- Standard controls and dialog actions: 32px. Compact actions: 28px.
- Inline utilities: 14px glyph with a compact hit area; group density still wins.
- Profiles and Workspaces use the same inline edit appearance. Conversation move
  uses it too, including shared asynchronous feedback. Remote directory selection
  uses a standard compact Button instead of a locally compressed label.
- Segmented controls include border and padding inside their declared height.
- Switches, metadata symbols and brand artwork are not buttons and are not enlarged
  to match button height. Arbitrary cropping of externally supplied icons is outside
  this change; their artwork can have intentional transparent margins.

## Evidence scope

Renderer tests cover primitive state and affected page behavior. Electron tests
cover minimum-window core actions, mixed control taxonomy, Apply dialog geometry
and cross-page contracts. Responsive mock captures are inspected separately for
visual proportion. This change does not alter persistence or Agent deployment.

## Completion receipt

- Build/typecheck: passed.
- Renderer: 106 tests passed across uiPrimitives, ConversationWorkspace and ProjectsWorkspace.
- Electron: seven selected cross-page tests passed on the final build, including
  minimum/default/wide text containment and collapsed-navigation preservation.
- CSS ownership and UI contract audits: passed. Removed local utility selectors
  are protected against reintroducing primitive geometry overrides.
- Mock captures: `/tmp/aem-control-scale-final-20260912`, with capture manifest.
  Inspected Profiles/Workspaces, Conversations, Instructions, Skills, Agents and
  Settings samples for proportions; this is not full locale or packaged-release verification.
- Full suite and packaging were not run. Navigation retains its own 34px token,
  independently of standard action height.
