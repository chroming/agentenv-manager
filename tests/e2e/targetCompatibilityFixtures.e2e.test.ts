import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type {
  SkillRuntimeAvailability,
  SkillRuntimeOwner,
  TargetSkillLocationRole
} from "../../src/shared/types";
import { snapshotFilesystemTree } from "../helpers/filesystemSnapshot";

interface FixtureEntry {
  type: "file" | "symlink";
  path: string;
  content?: string;
  target?: string;
}

interface CompatibilityScenario {
  id: string;
  targetId: string;
  entries: FixtureEntry[];
  expected: {
    configPath: string;
    runtimeDir?: string;
    runtimeName: string;
    locationRole: TargetSkillLocationRole;
    availability?: SkillRuntimeAvailability;
    owner?: SkillRuntimeOwner;
    issueCode?: string;
  };
}

const fixturePath = fileURLToPath(
  new URL("../fixtures/target-homes/compatibility.json", import.meta.url)
);
const scenarios = (
  JSON.parse(await readFile(fixturePath, "utf8")) as {
    scenarios: CompatibilityScenario[];
  }
).scenarios;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

const materialize = async (homeDir: string, entries: FixtureEntry[]) => {
  for (const entry of entries.filter((candidate) => candidate.type === "file")) {
    const path = join(homeDir, entry.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry.content ?? "", "utf8");
  }
  for (const entry of entries.filter((candidate) => candidate.type === "symlink")) {
    const path = join(homeDir, entry.path);
    await mkdir(dirname(path), { recursive: true });
    await symlink(entry.target ?? "", path, "dir");
  }
};

describe.each(scenarios)(
  "Target machine fixture: $id",
  (scenario) => {
    it("maps and inspects the captured machine state without modifying it", async () => {
      const root = await mkdtemp(join(tmpdir(), `agentenv-${scenario.id}-`));
      roots.push(root);
      const homeDir = join(root, "home");
      await materialize(homeDir, scenario.entries);
      const before = await snapshotFilesystemTree(homeDir);
      const adapter = createTargetRegistry().get(scenario.targetId);
      const paths = adapter.createTargetPaths({ homeDir });

      expect(paths.configPath).toBe(resolve(homeDir, scenario.expected.configPath));
      if (scenario.expected.runtimeDir) {
        expect(paths.runtimeDir).toBe(resolve(homeDir, scenario.expected.runtimeDir));
      }
      const snapshot = await adapter.skills.inspectRuntime(paths);
      const observation = snapshot.observations.find(
        (candidate) => candidate.runtimeName === scenario.expected.runtimeName
      );

      expect(observation).toMatchObject({
        runtimeName: scenario.expected.runtimeName,
        locationRole: scenario.expected.locationRole,
        ...(scenario.expected.availability
          ? { availability: scenario.expected.availability }
          : {}),
        ...(scenario.expected.owner ? { owner: scenario.expected.owner } : {})
      });
      if (scenario.expected.issueCode) {
        expect(snapshot.issues).toContainEqual(
          expect.objectContaining({ code: scenario.expected.issueCode })
        );
      }
      expect(await snapshotFilesystemTree(homeDir)).toEqual(before);
    });
  }
);
