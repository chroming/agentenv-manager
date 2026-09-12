# Cross-page representation follow-up

Scope: Profiles, Workspaces, Instructions, Skills and source/group projections,
Conversations, and Settings. No changes to resource ownership or persistence.

| Surface | Decision | Information destination |
| --- | --- | --- |
| Profile readiness | Remove ambiguous dashed-circle ready marker; Apply already exposes the next step | Accessible readiness remains; working, pending, applied and exceptional states retain their indicators |
| Workspace MCPs | Replace the separate Read-only description line with a lock before the count in the shared summary slot | The summary retains a Read-only title and accessible icon label; resource counts stay aligned and read-only behavior is unchanged |
| Instructions usage | Replace an ambiguous stack icon plus number with a short Profile unit | Existing selectable hover details still list referencing Profiles |
| Instructions creation | Neutral New Instruction when the Library is populated | Empty-state creation remains primary |
| General settings | Move routine language/terminal explanations to shared field help | Field labels and selected values remain visible; descriptions remain supported for consequential settings |
| Skills and source groups | Retain Check updates and Merge text | Their symbols alone do not distinguish upstream checks from local refresh, or explain merge scope |
| Conversations | Retain Continue text and its menu; keep path/time metadata | Copy, external open, sort and filter remain familiar utility icons; the conversation is not reduced to metadata-free titles |
| Profile/Workspace resource groups | Retain policy wording, resource counts and group names | These are control scope and identity, not explanatory clutter |

Shared owners: StatusHint, SettingsPreferenceRow, ResourceDisclosureSection,
InspectorHeader and existing command primitives. No new icon library or miniature
page-specific controls. A disclosure title stays plain text; its summary uses a
non-focusable icon rather than nesting another interactive trigger inside it.

Evidence: targeted renderer tests protect contextual help, actionable values,
Instruction reference units and Profile readiness. Electron checks cover quiet
refresh, resource/control geometry and cross-page layouts. Mock captures at
920/1180/1440 are reviewed separately; passing geometry does not prove icon
recognition. Retained text is an intentional audit outcome, not an unfinished icon
conversion. No claim of exhaustive usability testing or packaged release approval.
