# Agent selection refinement

## Change evidence

The device selection follow-up exposed inconsistent counts, no-op saves, and an
offline empty chooser that claimed no Agents were installed. The owning surfaces
are AgentDeviceHeader, AgentDiscoveryDialog and RemoteDeviceManager.

Local and remote choices now share AgentSelectionRow, ChoiceInput and endpoint
icons. An active Profile is available through a quiet deployment icon tooltip.
Local recovery-required selection remains protected. Setup actions remain separate
from device visibility choices.

## State contract

- Refresh keeps the last device count; only the refresh icon animates.
- Manual Save requires a changed selection, including after reverting edits.
- No probe, failed probe, and successful empty probe are distinct. Empty remote
  selection offers refresh within the dialog; it never invents installation evidence.
- All-hidden groups keep their count and offer Choose Agents once in the body.
- Selection changes never apply Profiles or modify Agent files.
- Lists grow to their scroll limit; one item must not stretch to fill the limit.

## Verification

Build/type check, 133 renderer tests, UI contracts, translations, module budgets,
CSS and feature evidence audits passed. Native tests use fake SSH and isolated homes.
Screenshots are under `/tmp/agentenv-device-refinements-20261009` and cover device
groups at 920/1180/1440 widths plus the remote chooser at 920x620.
Ten selected native Electron scenarios passed (157 unrelated scenarios excluded).
The first capture exposed a fixed-height stretched row; it was corrected and a
native row-height/list-height assertion added before the final run.

This is targeted validation, not full-suite or packaged-release certification.
