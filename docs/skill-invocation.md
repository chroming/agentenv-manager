# Skill invocation policy

## Contract

Enabled controls deployment. Invocation controls how an enabled Skill may be
invoked. `default` preserves the Library author's behavior; `manual` requests
explicit invocation only. Disabling a Skill or its group retains this preference.
Saving a Profile does not modify an Agent. Apply remains the write boundary.

Claude Code and WorkBuddy implement native manual invocation through the documented
`disable-model-invocation: true` frontmatter and an explicit `user-invocable: true` override.
Codex implements the same intent using `policy.allow_implicit_invocation: false`
in `agents/openai.yaml`; `$skill-name` remains available for explicit invocation.
Existing YAML comments, interface metadata, dependencies and other policy keys
are preserved. Missing metadata and its parent directory are created only in the
deployment copy. Invalid metadata is reported before replacing an existing Skill.
No Codex global configuration is modified. Other targets must reject an active
manual-only reference with an actionable explanation, never silently deploy it as
automatic. This is invocation control, not a security sandbox against file access.

Library bytes remain unchanged. A manual-only deployment is a managed copy, even
when the normal installation preference is Live link. Default restores the
unmodified Library content. Preview, deploy, inventory and update propagation
must use the same transformation. Source hashes and deployed hashes are distinct.
Preview hashes include any added YAML file and parent directories using the same
v2 framing as the final copy; ordinary Skill identities remain unchanged.
Receipt comparisons are semantic and independent of JSON field order after a
schema round trip, including invocation mode, so repeat Apply remains a no-op.
External, shared, and plugin copies are not modified by changing a Profile.

## Admission and evidence

- Outcome: explicitly invoke selected Skills without automatic model selection.
- Owner: Profile reference; Agent adapter determines native support; deployment
  receipt records the transformation and original Library hash.
- UI: existing row switch and ToolbarOverflowMenu; no extra button cluster.
  `Default invocation` preserves author intent; `Explicit only` requests manual
  invocation. Invocation text must not reuse the source update-check policy label.
  Codex tooltips use `$skill-name`; Claude Code and WorkBuddy use `/skill-name`.
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

2026-10-28: Codex support verified with 2434 non-Electron tests and two current-build
Electron invocation scenarios. Twelve reviewed captures cover the shared Claude
control and Codex at 920/1180/1440, with Codex in English, Simplified Chinese and
Traditional Chinese. Local and fixture-SSH Apply reach a no-op, update propagation
retains the policy, Default restores author content, and isolated Compare leaves
Library and the real Agent unchanged. Ordinary v2 hashes are frozen by regression
fixtures; added metadata hashes match the materialized copy. Build artifact:
`fad9339b924fc87d5b2e88f9d03d9db2e2e95dee7a9eff5ae1b3e3b673e8ff61`.

Installed Codex CLI 0.163.0 was also exercised with an isolated HOME and a loopback
fake provider: the implicit request omitted the explicit-only Skill, while a
`$skill-name` mention included its body. The provider only captured requests and
returned an intentional error; no real model, credential or existing session was
used. This proves context assembly, not a model's eventual task execution. Native
policy semantics follow the [official metadata contract](https://learn.chatgpt.com/docs/build-skills#optional-metadata).
No packaged release or Windows/Linux native runtime verification is claimed here.
