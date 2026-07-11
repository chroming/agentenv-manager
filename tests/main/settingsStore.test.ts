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
  it("persists skill sync method while keeping Library originals in app data", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths);

    expect(await store.readSettings()).toEqual({
      skillSyncMethod: "symlink",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60
    });

    await store.updateSettings({
      skillSyncMethod: "copy",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 120
    });

    expect(await store.readSettings()).toEqual({
      skillSyncMethod: "copy",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 120
    });
    expect(resolveSkillsLibraryDir(paths, await store.readSettings())).toBe(
      join(root, "app-data", "skills-library")
    );
  });

  it("migrates legacy Library originals out of the shared runtime without deleting it", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths);
    await mkdir(join(paths.userSkillsDir, "reviewer"), { recursive: true });
    await writeFile(join(paths.userSkillsDir, "reviewer", "SKILL.md"), "# Reviewer\n", "utf8");
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(
      join(paths.appDataRoot, "settings.json"),
      JSON.stringify({ skillStorageLocation: "agents", skillSyncMethod: "copy" })
    );

    await expect(store.readSettings()).resolves.toEqual(expect.objectContaining({
      skillStorageLocation: "appData"
    }));
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")).resolves.toBe(
      "# Reviewer\n"
    );
    await expect(readFile(join(paths.userSkillsDir, "reviewer", "SKILL.md"), "utf8")).resolves.toBe("# Reviewer\n");
  });

  it("preserves a conflicting app-data copy during legacy shared Library migration", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-conflict-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths);
    await mkdir(join(paths.userSkillsDir, "reviewer"), { recursive: true });
    await mkdir(join(paths.skillsLibraryDir, "reviewer"), { recursive: true });
    await writeFile(join(paths.userSkillsDir, "reviewer", "SKILL.md"), "# Shared source\n", "utf8");
    await writeFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "# Existing app data\n", "utf8");
    await writeFile(
      join(paths.appDataRoot, "settings.json"),
      JSON.stringify({ skillStorageLocation: "agents", skillSyncMethod: "copy" })
    );

    await store.readSettings();
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .resolves.toBe("# Shared source\n");
    await expect(
      readFile(join(paths.skillsLibraryDir, "reviewer-pre-shared-migration", "SKILL.md"), "utf8")
    ).resolves.toBe("# Existing app data\n");
  });
});
