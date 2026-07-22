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
  it("persists project discovery roots without changing Library storage", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-projects-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths);

    expect(resolveSkillsLibraryDir(paths, await store.readSettings())).toBe(
      join(root, "app-data", "skills-library")
    );
  });

  it("persists skill sync method while keeping Library originals in app data", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths);

    expect(await store.readSettings()).toEqual({
      locale: "system",
      skillSyncMethod: "symlink",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null
    });

    await store.updateSettings({
      locale: "zh_TW",
      skillSyncMethod: "copy",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 120,
      backupRetentionDays: 30
    });

    expect(await store.readSettings()).toEqual({
      locale: "zh_TW",
      skillSyncMethod: "copy",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 120,
      backupRetentionDays: 30
    });
    expect(resolveSkillsLibraryDir(paths, await store.readSettings())).toBe(
      join(root, "app-data", "skills-library")
    );
  });

  it("initializes the enabled Agent list once and preserves explicit choices", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-agents-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths, {
      supportedTargetIds: ["opencode", "claude-code", "codex"]
    });

    await expect(store.readSettings()).resolves.toEqual(
      expect.objectContaining({
        enabledTargetIds: ["opencode", "claude-code", "codex"]
      })
    );

    await store.updateSettings({ enabledTargetIds: ["opencode"] });
    await expect(store.readSettings()).resolves.toEqual(
      expect.objectContaining({ enabledTargetIds: ["opencode"] })
    );

    const upgradedStore = createSettingsStore(paths, {
      supportedTargetIds: ["opencode", "claude-code", "codex", "future-agent"]
    });
    await expect(upgradedStore.readSettings()).resolves.toEqual(
      expect.objectContaining({ enabledTargetIds: ["opencode"] })
    );
  });

  it("normalizes per-Agent configuration roots and rejects relative paths", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-roots-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths, { supportedTargetIds: ["codex"] });
    const customRoot = join(root, "custom", "..", "codex-home");

    await expect(store.updateSettings({ targetConfigRoots: { codex: customRoot } }))
      .resolves.toMatchObject({ targetConfigRoots: { codex: join(root, "codex-home") } });
    await expect(store.updateSettings({ targetConfigRoots: { codex: "relative/path" } }))
      .rejects.toThrow("absolute paths");
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
