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
