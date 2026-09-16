# Skill invocation policy

## Contract

Enabled controls deployment. Invocation controls how an enabled Skill may be
invoked. `default` preserves the Library author's behavior; `manual` requests
explicit invocation only. Disabling a Skill or its group retains this preference.
Saving a Profile does not modify an Agent. Apply remains the write boundary.

The first native implementation is Claude Code's documented
`disable-model-invocation: true` frontmatter. Other targets must reject an active
manual-only reference with an actionable explanation, never silently deploy it as
automatic. This is invocation control, not a security sandbox against file access.

Library bytes remain unchanged. A manual-only deployment is a managed copy, even
when the normal installation preference is Live link. Default restores the
unmodified Library content. Preview, deploy, inventory and update propagation
must use the same transformation. Source hashes and deployed hashes are distinct.
External, shared, and plugin copies are not modified by changing a Profile.

## Admission and evidence

- Outcome: explicitly invoke selected Skills without automatic model selection.
- Owner: Profile reference; Agent adapter determines native support; deployment
  receipt records the transformation and original Library hash.
- UI: existing row switch and ToolbarOverflowMenu; no extra button cluster.
- Scope: Profile deployment, SSH deployment and isolated comparison use the same
  transform. Workspace direct-file editing is not exposed in this iteration.
  Its reversible author-default ownership needs a separate contract, rather than
  silently treating a project file as a Profile reference.
- Required tests: source immutability, metadata preservation, copied output,
  repeat Apply no-op, unsupported target, disabled preference retention, group
  behavior, updates preserving policy, and default-policy restoration.

## Verification receipt

2026-09-16: 235 targeted domain/renderer tests passed. The native Electron test
checks menu selection, persisted autosave, restoration to Default, containment
and switch alignment at 920, 1180 and 1440 pixels. Synthetic screenshots are
registered in the visual verification suite. SSH uses an isolated transport
fixture, not a production host. No real Agent home was modified and no paid model
request was made. Native model behavior is based on Claude's documented
[frontmatter contract](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill),
not a completed live-model invocation test. This is not a packaged-release receipt.
