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
      conversationTerminal: "default",
      skillSyncMethod: "auto",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      appUpdateAutoCheckEnabled: true,
      appUpdateAutoDownloadEnabled: true,
      appUpdateInstallOnQuit: true,
      telemetryEnabled: true,
      backupRetentionDays: null
    });

    await store.updateSettings({
      locale: "zh_TW",
      conversationTerminal: "ghostty",
      skillSyncMethod: "copy",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 120,
      appUpdateAutoCheckEnabled: false,
      appUpdateAutoDownloadEnabled: false,
      appUpdateInstallOnQuit: false,
      telemetryEnabled: true,
      backupRetentionDays: 30
    });

    expect(await store.readSettings()).toEqual({
      locale: "zh_TW",
      conversationTerminal: "ghostty",
      skillSyncMethod: "copy",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: false,
      skillAutoCheckIntervalMinutes: 120,
      appUpdateAutoCheckEnabled: false,
      appUpdateAutoDownloadEnabled: false,
      appUpdateInstallOnQuit: false,
      telemetryEnabled: true,
      backupRetentionDays: 30
    });
    expect(resolveSkillsLibraryDir(paths, await store.readSettings())).toBe(
      join(root, "app-data", "skills-library")
    );
  });

  it("adds release and privacy defaults to existing settings without losing choices", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-upgrade-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(
      join(paths.appDataRoot, "settings.json"),
      JSON.stringify({ locale: "zh_CN", skillAutoCheckEnabled: false }),
      "utf8"
    );

    const settings = await createSettingsStore(paths).readSettings();

    expect(settings).toMatchObject({
      locale: "zh_CN",
      skillAutoCheckEnabled: false,
      appUpdateAutoCheckEnabled: true,
      appUpdateAutoDownloadEnabled: true,
      appUpdateInstallOnQuit: true,
      telemetryEnabled: true
    });
    expect(JSON.parse(await readFile(join(paths.appDataRoot, "settings.json"), "utf8")))
      .toMatchObject({
        appUpdateAutoCheckEnabled: true,
        appUpdateAutoDownloadEnabled: true,
        appUpdateInstallOnQuit: true,
        telemetryEnabled: true
      });
  });

  it("preserves an existing telemetry opt-out", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-telemetry-opt-out-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(
      join(paths.appDataRoot, "settings.json"),
      JSON.stringify({ telemetryEnabled: false }),
      "utf8"
    );

    await expect(createSettingsStore(paths).readSettings()).resolves.toEqual(
      expect.objectContaining({ telemetryEnabled: false })
    );
  });

  it("starts new installations with every Agent off", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-agents-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths, {
      supportedTargetIds: ["opencode", "claude-code", "codex"]
    });

    await expect(store.readSettings()).resolves.toEqual(
      expect.objectContaining({
        enabledTargetIds: []
      })
    );
    await expect(
      JSON.parse(await readFile(join(paths.appDataRoot, "settings.json"), "utf8"))
    ).toEqual(expect.objectContaining({ enabledTargetIds: [] }));
  });

  it("preserves the pre-selection behavior for existing settings and later explicit choices", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-agents-upgrade-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(
      join(paths.appDataRoot, "settings.json"),
      JSON.stringify({ locale: "system", skillAutoCheckEnabled: false }),
      "utf8"
    );
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

  it("persists and normalizes disabled Agent suggestion choices", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-agent-suggestions-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths, {
      supportedTargetIds: ["opencode", "codex"]
    });

    await expect(store.updateSettings({
      suppressedAgentSuggestionIds: ["codex", "codex", "unknown"]
    })).resolves.toEqual(expect.objectContaining({
      enabledTargetIds: [],
      suppressedAgentSuggestionIds: ["codex"]
    }));
    await expect(store.readSettings()).resolves.toEqual(expect.objectContaining({
      suppressedAgentSuggestionIds: ["codex"]
    }));
  });

  it("persists reviewed Agent discovery choices independently from enabled Agents", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-agent-discovery-review-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths, {
      supportedTargetIds: ["opencode", "codex"]
    });

    await expect(store.updateSettings({
      enabledTargetIds: ["opencode"],
      agentDiscoveryReviewedIds: ["opencode", "codex", "codex", "unknown"]
    })).resolves.toEqual(expect.objectContaining({
      enabledTargetIds: ["opencode"],
      agentDiscoveryReviewedIds: ["opencode", "codex"]
    }));
    await expect(store.readSettings()).resolves.toEqual(expect.objectContaining({
      agentDiscoveryReviewedIds: ["opencode", "codex"]
    }));
  });

  it("persists safe per-Agent command overrides and expands home paths", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-agent-commands-"));
    const homeDir = join(root, "home");
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir });
    const store = createSettingsStore(paths, {
      supportedTargetIds: ["opencode", "codex"]
    });

    await expect(store.updateSettings({
      targetCommandOverrides: {
        opencode: "opencode-nightly",
        codex: "~/bin/codex-wrapper",
        unknown: "ignored-command"
      }
    })).resolves.toEqual(expect.objectContaining({
      targetCommandOverrides: {
        opencode: "opencode-nightly",
        codex: join(homeDir, "bin", "codex-wrapper")
      }
    }));
  });

  it("rejects command overrides that contain arguments or relative paths", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-agent-command-safety-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSettingsStore(paths, { supportedTargetIds: ["codex"] });

    await expect(store.updateSettings({
      targetCommandOverrides: { codex: "codex --dangerously-bypass-approvals-and-sandbox" }
    })).rejects.toThrow("Agent command overrides must be an executable name or absolute path");
    await expect(store.updateSettings({
      targetCommandOverrides: { codex: "bin/codex" }
    })).rejects.toThrow("Agent command overrides must be an executable name or absolute path");
  });

  it("normalizes unsupported Windows terminal preferences", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-windows-"));
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir: join(root, "home")
    });
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(
      join(paths.appDataRoot, "settings.json"),
      JSON.stringify({ conversationTerminal: "ghostty" }),
      "utf8"
    );
    const store = createSettingsStore(paths, { platform: "win32" });

    await expect(store.readSettings()).resolves.toMatchObject({
      conversationTerminal: "default"
    });
    await expect(
      store.updateSettings({ conversationTerminal: "ghostty" })
    ).rejects.toThrow("not available");
  });

  it("normalizes Windows Agent folders and command overrides with Windows path rules", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-settings-windows-paths-"));
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir: "C:\\Users\\agentenv"
    });
    const store = createSettingsStore(paths, {
      platform: "win32",
      supportedTargetIds: ["opencode"]
    });

    await expect(store.updateSettings({
      targetConfigRoots: { opencode: "C:\\Users\\agentenv\\.config\\..\\opencode" },
      targetCommandOverrides: { opencode: "~\\bin\\opencode-preview.exe" }
    })).resolves.toMatchObject({
      targetConfigRoots: { opencode: "C:\\Users\\agentenv\\opencode" },
      targetCommandOverrides: { opencode: "C:\\Users\\agentenv\\bin\\opencode-preview.exe" }
    });
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
    await expect(
      readFile(join(paths.appDataRoot, "legacy-skill-storage-migration.json"), "utf8")
    ).resolves.toContain('"sourcePreserved": true');
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
    await expect(
      readFile(join(paths.appDataRoot, "legacy-skill-storage-migration.json"), "utf8")
    ).resolves.toContain('"preservedAs": "reviewer-pre-shared-migration"');
  });
});
