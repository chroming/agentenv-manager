import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSettingsStore, resolveSkillsLibraryDir } from "../../src/main/settingsStore";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("settings store", () => {
  it("persists skill sync method and storage location", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths);

    expect(await store.readSettings()).toEqual({
      skillSyncMethod: "copy",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60
    });

    await store.updateSettings({
      skillSyncMethod: "copy",
      skillStorageLocation: "agents",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 120
    });

    expect(await store.readSettings()).toEqual({
      skillSyncMethod: "copy",
      skillStorageLocation: "agents",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 120
    });
    expect(resolveSkillsLibraryDir(paths, await store.readSettings())).toBe(
      join(root, "home", ".agents", "skills")
    );
  });

  it("moves existing library skills before changing the storage location", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths);
    await mkdir(join(paths.skillsLibraryDir, "reviewer"), { recursive: true });
    await writeFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "# Reviewer\n", "utf8");

    await store.updateSettings({ skillStorageLocation: "agents" });

    await expect(readFile(join(paths.userSkillsDir, "reviewer", "SKILL.md"), "utf8")).resolves.toBe(
      "# Reviewer\n"
    );
  });
});
