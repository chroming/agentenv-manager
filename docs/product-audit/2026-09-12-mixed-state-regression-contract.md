# Mixed-state layout regression contract

## Cause and ownership

The source-column regression survived grid checks because local text and source
buttons had different internal alignment. The sparse Settings regression followed
removal of secondary text without removing its old spacing budget.

TextAction owns inline source interaction, SettingsPreferenceRow owns preference
anatomy, and their styles own density. Page-specific offsets are not the remedy.

## Executable evidence

- `tests/helpers/desktopMixedStates.ts` supplies reusable HTTPS/SSH long-source
  fixtures, a maintenance state matrix, and minimum/default/wide window sizes.
- `SkillMaintenanceStatus.test.tsx` covers routine, update, failure, removed,
  disabled, conflict and missing states across idle/working/idle transitions.
  It checks a stable icon slot, preserved action identity, and duplicate-submit
  prevention. It does not claim browser geometry.
- `electronUiProfileSwitching.e2e.test.ts`, test `aligns local and linked Skill
  sources and uses compact single-line preferences`, compares actual text with
  its cell for local/HTTPS/SSH branches at 920, 1180 and 1440 pixels. It also checks
  hover/focus control stability and compact preference/control centering.
- `SettingsPreferenceRow.test.tsx` distinguishes optional hover help from visible
  consequential descriptions. Native wrapped-error and translated density states
  still require separate geometry/pixel evidence when those branches change.

## Review rule

Do not approve a layout from homogeneous data or a screenshot of only idle state.
Record which branches and transitions were exercised. An untested state is not
implicitly covered by a passing shared-component assertion. Preserve screenshot
review for optical grouping, readable emphasis and whitespace balance.
