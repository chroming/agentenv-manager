# Worktree Timeout Evidence

## Change Evidence Card

- Symptom: some confirmed permanent deletions finish quickly; others hit the shared
  two-minute limit. Existing copied issues contain only the timeout wrapper and no
  worker stage, PID, exit evidence or stderr. The precise remote filesystem cause
  is not established by those reports.
- Intent: reclaim space reliably without indefinite work, unsafe fallback deletion,
  silently extended deadlines or unrelated Git prerequisites.
- Owner: the isolated physical-removal protocol and its bounded diagnostic projection.
  The disposal journal, path authorization, deletion algorithm, deadline and UI remain
  unchanged. The additive result field is transient; no journal migration is needed.
- Proof: real helper tests for missing handler versus a hang after removal starts;
  real Electron queue/Stop/timeout/retry; copyable issue projection and redaction;
  opt-in read-only process sampling. No destructive remote reproduction is performed.

## Implementation

- Worker sends readiness, identity-validation and removal-stage messages. These are
  evidence only, not completion messages. Parent retains its exact terminal-result
  and process-exit acknowledgement rules.
- Process snapshots retain stage, monotonic elapsed time, owned PID, confirmed exit
  code/signal and whether force-stop was requested. Stderr is drained and capped at
  8 KiB; existing diagnostic sanitization applies before logging/export.
- Live phase events and timeout context share the operation reference. Copy details
  includes the final snapshot and total duration. Failed observers/log flushing
  cannot hold deletion hostage; the existing optional flush bounds remain intact.
- `scripts/sample-worktree-removal.mjs` runs only when explicitly invoked. It waits
  up to 30 seconds for installed AgentEnv Node utility children, checks executable
  identity separately from arguments and rechecks parentage before sampling. It
  samples at most three candidates, one second each with a five-second command
  limit and a bounded output. Candidate helpers are not all assumed to be deletion
  workers. The private local report contains no file contents, environment or
  unrelated process list, and does not launch/retry deletion or send data anywhere.

## Completion Evidence

- Red: two tests reproduced missing actual-stage and timeout-process details,
  `/tmp/aem-removal-evidence-red.json`.
- Focused regression: 174 tests passed across six files, including disposal safety,
  diagnostic redaction/copyability, sampler identity/privacy, renderer queue behavior,
  forced timeout/exit and observer failure, `/tmp/aem-removal-evidence-tests-green.json`.
- Current source built and typechecked: fingerprint `37e5ba90e668`, 675 inputs.
- Rebuilt Electron: both fourteen-item manual Stop and timeout/retry flows passed,
  `/tmp/aem-removal-evidence-native.json`. Timeout issue context contains the actual
  removal stage, owned PID and confirmed exit. Other independent items still finish.
- Read-only sampler verified against a known idle helper of an isolated existing
  signed package: captured the native call graph and bounded it to 128 KiB. This
  verifies the sampler, not the new application's packaged runtime. Normal user data
  was not touched; the synthetic helper was exited after sampling.
- Module, Target boundary, feature evidence and UI contract audits passed. No UI/CSS,
  dependency, ownership, journal or filesystem-authorization changes were made.
- Limit: remote root cause still requires an actual affected-process sample. No
  claim is made that extra diagnostic evidence fixes the underlying remote stall.
  Full application regression, a newly packaged build and Windows/Linux packaged
  execution were not run in this focused change. No push/release/upload is performed.

## Collecting An Affected Sample

On the affected Mac, run `node scripts/sample-worktree-removal.mjs` and retry one
affected item from Worktree Trash while the script waits. The installed version
does not need to be upgraded first. Send the printed private `report.json` after
reviewing it. A no-helper or permission-denied result is reported explicitly; it
must not be interpreted as a successful filesystem diagnosis.
