# Product clarity review

## Change evidence card

- Symptom: setup, source maintenance, deployment, and Workspace copying compete on the same surfaces.
- Intent: preserve all existing management capabilities while making each entry's scope and effect explicit.
- Owners: Agent configuration routing, Apply preview composition, Library controls and status projection, shared Skill picker context, and Workspace launch command.
- Reuse: ModalFrame, DialogHeader/Body/Footer, SelectField/SelectControl, Button, LibrarySkillSelection, InteractiveStatus, existing preview disclosures, and InspectorHeader.
- Boundary: no changes to filesystem ownership, migration, backups, update policies, or Apply transactions.

## Implemented behavior

1. Configure opens only the Profile active on the exact Agent endpoint. Otherwise the user chooses a saved Profile, local capture, or an empty remote Profile. An SSH endpoint never borrows the first local Profile.
2. Apply shows decisions and actual changes before inventory totals. Management records are collapsed except for state-only work; local review and shared-resource warnings stay directly accessible.
3. Skills uses one view switch. Status and source-check scope use secondary selects with persistent visible values and counts.
4. Library primary status describes maintenance. Copied Agent deployment lag stays in usage details and update impact review, not the primary upstream status.
5. Both group pickers reuse LibrarySkillSelection. Profile references track membership; Workspace copies current members once and uses a Copy command. Existing shared-Instruction editing impact remains unchanged.
6. SSH Workspace has one connection-copy command, including when no local CLI is installed. Device identity is shown once; copying a connection does not claim to launch an Agent.

## Completion evidence

- Renderer regressions cover explicit setup, exact endpoint selection, Escape, no implicit capture, disclosure defaults/order, Library status semantics, group copying, and SSH clipboard success/failure without a local CLI.
- Electron coverage includes retained workflows and remote setup containment at 920, 1180, and 1440 pixels. Test assertions were updated to exercise explicit selection, not removed or skipped.
- 184 mock captures generated. Key cold-read checks covered setup spacing, Apply decisions/disclosures, group pickers, source/catalog controls, and Simplified/Traditional Chinese at minimum size.
- Capture source fingerprint: `8576fa2ea0519ffd00ac16e1a0f08672fa99fd6e5a5bfa853abb8a6af244fc36`.
- Capture artifact fingerprint: `97f35750e68f17e9e908be788156da3c1f0b9d7a1adc7bddab7ade9c95b1ec17`.
- Final verification: `npm run verify:commit` passed on the fingerprint above: 1,775 tests across 254 files, all 157 Electron tests with exact coverage, and style/module/Target/translation/feature/UI contract audits. No tests were removed from the full suite.
- Limits: native desktop tests use isolated fixture homes and SSH transport fixtures. No new packaged release, real remote deployment, or Windows/Linux visual approval is claimed.
