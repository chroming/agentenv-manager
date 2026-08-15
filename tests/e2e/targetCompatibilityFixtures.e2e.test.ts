import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTargetRegistry } from "../../src/main/targets/registry";
import { snapshotFilesystemTree } from "../helpers/filesystemSnapshot";
import {
  materializeMachineScenario,
  scenarioEnvironment,
  scenarioPath
} from "../helpers/materializeMachineScenario";
import { selectMachineScenarios } from "../machine-scenarios/catalog";

const scenarios = await selectMachineScenarios({
  scenarioId: process.env.AGENTENV_MACHINE_SCENARIO
});
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 50
  })));
  roots.length = 0;
});

describe.each(scenarios)(
  "Target machine fixture: $id",
  (scenario) => {
    it("maps and inspects the captured machine state without modifying it", async () => {
      const root = await mkdtemp(join(tmpdir(), `agentenv-${scenario.id}-`));
      roots.push(root);
      const homeDir = join(root, "home");
      await materializeMachineScenario(homeDir, scenario);
      const before = await snapshotFilesystemTree(homeDir, {
        includeTimestamps: true
      });
      const adapter = createTargetRegistry().get(scenario.targetId);
      const paths = adapter.createTargetPaths({
        homeDir,
        environment: scenarioEnvironment(scenario, homeDir)
      });

      expect(paths.configPath).toBe(scenarioPath(homeDir, scenario.expected.configPath));
      if (scenario.expected.runtimeDir) {
        expect(paths.runtimeDir).toBe(scenarioPath(homeDir, scenario.expected.runtimeDir));
      }
      if (scenario.installation) {
        const executablePath = scenario.installation.executablePath
          ? scenarioPath(homeDir, scenario.installation.executablePath)
          : scenarioPath(homeDir, `bin/${scenario.installation.command}`);
        const detected = await adapter.detectInstallation({
          platform: process.platform,
          homeDir,
          allowSystemApplicationLookup: false,
          findExecutable: async (name) =>
            scenario.installation?.state === "found" &&
            name === scenario.installation.command
              ? executablePath
              : undefined,
          pathExists: async () => false
        });
        expect(detected.found).toBe(scenario.installation.state === "found");
      }
      const snapshot = await adapter.skills.inspectRuntime(paths);
      for (const expected of scenario.expected.observations) {
        const observation = snapshot.observations.find(
          (candidate) =>
            candidate.runtimeName === expected.runtimeName &&
            (!expected.deploymentName || candidate.deploymentName === expected.deploymentName)
        );
        expect(observation).toMatchObject({
          runtimeName: expected.runtimeName,
          locationRole: expected.locationRole,
          ...(expected.deploymentName ? { deploymentName: expected.deploymentName } : {}),
          ...(expected.availability ? { availability: expected.availability } : {}),
          ...(expected.owner ? { owner: expected.owner } : {})
        });
        for (const issueCode of expected.issueCodes) {
          expect(observation?.issues).toContainEqual(
            expect.objectContaining({ code: issueCode })
          );
        }
      }
      for (const issueCode of scenario.expected.issueCodes) {
        expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: issueCode }));
      }
      expect(await snapshotFilesystemTree(homeDir, {
        includeTimestamps: true
      })).toEqual(before);
    });
  }
);
