import { expect, it } from "vitest";
// @ts-expect-error Standalone user-run diagnostic script is JavaScript.
import { parseProcesses, selectRemovalProcesses, scrubSample } from "../../scripts/sample-worktree-removal.mjs";

it("selects only Node utility children of an installed AgentEnv application", () => {
  const rows = parseProcesses(`
  100 1 /Applications/AgentEnv Manager.app/Contents/MacOS/AgentEnv Manager
  101 100 /Applications/AgentEnv Manager.app/Contents/Frameworks/Helper --type=utility --utility-sub-type=node.mojom.NodeService
  102 100 /Applications/AgentEnv Manager.app/Contents/Frameworks/Helper --type=renderer
  200 1 /Applications/Another.app/Contents/MacOS/Another
  201 200 /Applications/Another.app/Contents/Frameworks/Helper --type=utility --utility-sub-type=node.mojom.NodeService
  300 1 /bin/sh -c echo /Applications/AgentEnv Manager.app/Contents/MacOS/AgentEnv Manager
  301 300 /bin/example --type=utility --utility-sub-type=node.mojom.NodeService
  400 1 /Users/fixture/Applications/AgentEnv Manager.app/Contents/MacOS/AgentEnv Manager
  401 400 /Users/fixture/Applications/AgentEnv Manager.app/Contents/Frameworks/Helper --type=utility --utility-sub-type=node.mojom.NodeService
`, `100 /Applications/AgentEnv Manager.app/Contents/MacOS/AgentEnv Manager
200 /Applications/Another.app/Contents/MacOS/Another
300 /bin/sh
400 /Users/fixture/Applications/AgentEnv Manager.app/Contents/MacOS/AgentEnv Manager`);
  expect(selectRemovalProcesses(rows).map((row: { pid: number }) => row.pid)).toEqual([101, 401]);
});

it("omits argument and environment lines, redacts home and bounds each sample", () => {
  expect(scrubSample("Path: /Users/fixture/app\nCommand line: private arguments\nEnvironment: private\nArguments: private", "/Users/fixture"))
    .toBe("Path: ~/app\n[omitted]\n[omitted]\n[omitted]");
  expect(scrubSample("x".repeat(500_000), "/Users/fixture").length).toBe(128 * 1024);
});
