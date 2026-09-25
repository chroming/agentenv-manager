# Visual baselines

`critical-captures.json` is the coverage contract. `golden/` contains reviewed
Electron screenshots, not images generated independently of the application.
`baseline-review.json` records the build and image hashes of the latest review.

## Updating an intentional design change

1. Run `npm run verify:visual` on macOS. It rebuilds the application, exercises
   mock workflows, captures all contract scenarios, and compares their pixels.
2. Inspect the changed images at native resolution as well as their diffs. Check
   minimum-width layouts, long labels and paths, expanded groups, dialogs,
   pending/completed states, and the included language variants. Fix defects
   before accepting images. Passing a pixel threshold is not a design review.
3. Copy only reviewed images into `golden/`. Keep every contract scenario and
   its existing threshold. Do not raise tolerance to accept a redesign.
4. Record the build fingerprint, reviewed image hashes, change reasons, and
   verification limits in `baseline-review.json`.
5. Run `npm run verify:visual` again from fresh captures. Comparing a candidate
   against the same files just copied is not independent verification.

Captures and comparison reports are written below
`$TMPDIR/agentenv-ui-captures/` (`/tmp` when `TMPDIR` is unset). The suite uses
mock homes, repositories, commands, and desktop bundles. It must not inherit
the developer's installed Agents. The main capture asserts the expected Agent
inventory; `AGENTENV_AUTOMATION_TARGET_PATH` disables host command and application
discovery. Do not remove that isolation to make a capture pass.

Runtime text such as recovery timestamps can vary between runs. Local pixel
thresholds and tighter component crops remain unchanged; CI's existing bounded
host-rendering tolerance only accounts for its different macOS renderer.
Neither visual verification nor its mock CLI workflows prove behavior on every
real Agent installation or a packaged Windows/Linux application.
