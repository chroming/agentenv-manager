# Agent Runtime Compatibility Design

## Goal

Make installed Agent detection reliable across packaged desktop environments and non-standard command installations without changing AgentEnv's Profile ownership or Apply safety model.

## Product boundary

An Agent has independent compatibility capabilities:

- installation discovery
- resource management for Instructions, Skills, and MCPs
- conversation history and native resume
- isolated Profile comparison

Finding an executable proves only that the local command can be launched. It does not grant permission to capture or modify Agent files. Resource writes continue to use the existing Preview, backup, ownership, verification, and recovery contracts.

## Runtime declaration

Every Target declares an ordered list of executable candidates. The first item is the normal display command. A user may optionally override the command with a safe executable basename or an absolute path. Overrides are Target-specific and affect command discovery, Conversations, and Compare only.

The discovery result distinguishes:

- `found`: a candidate or override resolved to an executable file
- `missing`: all probes completed and none resolved
- `unknown`: a probe could not be completed safely, for example because an override is invalid or inaccessible

The result includes candidates, resolved path, override state, and a concise diagnostic reason. A desktop application may still prove installation even when no CLI command is available; command-dependent capabilities remain unavailable.

## Existing capabilities

Conversation adapters already return structured launch specifications containing executable path, arguments, working directory, and environment changes. This contract remains the owner of Agent-specific resume syntax. No shared Agent-name switch or shell command catalog is introduced.

## Safety

- Command overrides never accept arguments or shell syntax.
- Relative paths containing separators are rejected.
- Discovery remains read-only.
- An unknown command probe never enables command-dependent actions.
- Existing resource-management paths and Apply behavior do not change.

## Verification

- settings validation for safe basenames, absolute paths, and invalid values
- discovery tests for candidate fallback, overrides, missing commands, and probe failures
- contract tests covering every built-in Target declaration
- renderer tests for editing and resetting a Target command override
- existing Conversation and Profile comparison tests remain authoritative for launch behavior
