import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateAppDataToV2 } from "../../src/main/appDataMigration";
import { createPaths } from "../../src/main/paths";
import {
  assertFilesystemSnapshotEqual,
  snapshotFilesystemTree
} from "../helpers/filesystemSnapshot";
import { loadAppDataUpgradeScenarios } from "../machine-scenarios/appDataUpgradeCatalog";

const scenarios = await loadAppDataUpgradeScenarios();
let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

describe.each(scenarios)("App data upgrade: $id", (scenario) => {
  it(scenario.description, async () => {
    const root = await mkdtemp(join(tmpdir(), `agentenv-upgrade-${scenario.id}-`));
    roots.push(root);
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home")
    });
    await mkdir(paths.appDataRoot, { recursive: true });
    for (const entry of scenario.entries) {
      const path = join(paths.appDataRoot, entry.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, entry.content, "utf8");
    }
    const before = await snapshotFilesystemTree(paths.appDataRoot);

    if (scenario.expected.outcome === "failure") {
      await expect(migrateAppDataToV2(paths)).rejects.toThrow(
        scenario.expected.errorIncludes
      );
      if (scenario.expected.exactOriginalTree) {
        assertFilesystemSnapshotEqual(
          before,
          await snapshotFilesystemTree(paths.appDataRoot),
          `${scenario.id} data root`
        );
      }
      return;
    }

    const result = await migrateAppDataToV2(paths);
    expect(result).toMatchObject({
      migrated: scenario.expected.migrated,
      profileCount: scenario.expected.profileCount,
      retainedProfileCount: scenario.expected.retainedProfileCount
    });
    const manifest = JSON.parse(
      await readFile(join(paths.appDataRoot, "agentenv-data.json"), "utf8")
    );
    expect(manifest).toMatchObject({ formatVersion: scenario.expected.manifestVersion });
    for (const entry of scenario.expected.preserved) {
      await expect(readFile(join(paths.appDataRoot, entry.path), "utf8"))
        .resolves.toBe(entry.content);
    }
    for (const path of scenario.expected.absent) {
      await expect(readFile(join(paths.appDataRoot, path), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    }
    for (const expected of scenario.expected.jsonMatches) {
      const value = JSON.parse(
        await readFile(join(paths.appDataRoot, expected.path), "utf8")
      );
      expect(value).toMatchObject(expected.value);
    }
    if (scenario.expected.reportContains) {
      await expect(
        readFile(join(paths.appDataRoot, "migration-v2-report.json"), "utf8")
      ).resolves.toContain(scenario.expected.reportContains);
    }
  });
});
