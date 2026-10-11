# Agent device groups

## Change evidence

Device headings previously mixed a local table header with remote Agent-like two-line
rows. Local selection also looked global while remote devices had no selection model.

Both surfaces now use AgentDeviceHeader: small device icon, single-line name/count,
neutral separator and trailing shared controls. SSH address is hover detail. Agent rows
retain their own identity/Profile column alignment. Choose Agents is an icon action
scoped to the device.

## Ownership and effects

- Remote disabledAgentIds are stored with the device on this machine only; absent means
  all detected Agents are available. Newly discovered Agents are initially available.
- Selection-only updates must not invoke SSH, replace deployment state or touch remote
  files. Connection edits continue to use the existing identity verification path.
- Exclusions filter remote rows and Profile target choices, not raw discovery/history.
- Last-known endpoints remain selectable while offline. Re-enabling reverses exclusion.
- No new dependency or remote command was introduced.

## Verification scope

Store, service and renderer tests cover persistence, validation, offline save and reversal.
App tests cover the local chooser integration. Native Electron fixtures cover device
creation, selection/re-enabling, Apply and 920/1180/1440-width geometry; sibling desktop
tests cover localized Agent rows and shared controls. Captures are under
`/tmp/agentenv-device-groups-20261009`. No real SSH server was contacted.

This is targeted validation, not full-suite or packaged-release certification.

Final checks: build/type checking passed; 27 remote store/service/renderer tests,
117 App tests and 10 selected Electron scenarios passed. UI contract, translation,
module, CSS and feature-evidence audits passed. Reviewed the rebuilt 920px capture;
local and remote device actions align at the trailing edge without a second address row.
