import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createClaudeCodeTargetAdapter } from "../../src/main/targets/claudeCodeTarget";
import { createTargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createCodexTargetAdapter } from "../../src/main/targets/codexTarget";
import { createOpenCodeTargetAdapter } from "../../src/main/targets/opencodeTarget";
import { createTargetRegistry } from "../../src/main/targets/registry";
import { createTargetScope } from "../../src/main/targets/targetScope";
import { createAntigravityTargetAdapter } from "../../src/main/targets/integrations/antigravity";
import { createTraeCliTargetAdapter } from "../../src/main/targets/integrations/trae-cli";

let root = "";

const makeService = async (options: { platform?: NodeJS.Platform } = {}) => {
  root = await mkdtemp(join(tmpdir(), "agentenv-discovery-"));
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const paths = createPaths({
    appDataRoot: join(root, "app-data"),
    homeDir: root,
    fakeHomeRoot: root
  });
  const targetRegistry = createTargetRegistry([
    createOpenCodeTargetAdapter(),
    createClaudeCodeTargetAdapter(),
    createCodexTargetAdapter(),
    createTraeCliTargetAdapter()
  ]);
  const settingsStore = createSettingsStore(paths, {
    supportedTargetIds: targetRegistry.list().map((target) => target.id)
  });
  const targetScope = createTargetScope(targetRegistry, settingsStore);
  const service = createTargetDiscoveryService({
    paths,
    targetRegistry,
    targetScope,
    pathEnv: binDir,
    platform: options.platform
  });

  return { binDir, paths, service, settingsStore, targetScope };
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("target discovery", () => {
  it("does not detect or return Agents that are turned off", async () => {
    const { service, settingsStore, targetScope } = await makeService();
    await settingsStore.updateSettings({ enabledTargetIds: ["opencode"] });

    await expect(targetScope.listEnabledIds()).resolves.toEqual(["opencode"]);
    await expect(service.listTargets()).resolves.toEqual([
      expect.objectContaining({ id: "opencode" })
    ]);
    await expect(targetScope.assertEnabled("codex")).rejects.toThrow(
      "Codex is turned off in Settings"
    );
  });

  it("reports a missing OpenCode CLI and missing config paths without creating them", async () => {
    const { service } = await makeService();

    const targets = await service.listTargets();
    const opencode = targets.find((target) => target.id === "opencode");

    expect(opencode?.health.status).toBe("missing");
    expect(opencode?.health.executableFound).toBe(false);
    expect(opencode?.health.canWrite).toBe(false);
    expect(opencode?.conversationCapabilities).toMatchObject({
      history: { state: "available" },
      openOriginal: { state: "unavailable" },
      continue: { state: "unavailable" }
    });
    expect(opencode?.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "configDir",
          path: join(root, ".config", "opencode"),
          exists: false
        }),
        expect.objectContaining({
          id: "instructions",
          path: join(root, ".config", "opencode", "AGENTS.md"),
          exists: false
        }),
        expect.objectContaining({
          id: "config",
          path: join(root, ".config", "opencode", "opencode.jsonc"),
          exists: false
        })
      ])
    );
  });

  it("marks OpenCode ready when the CLI and writable config files are present", async () => {
    const { binDir, service } = await makeService();
    const executable = join(binDir, "opencode");
    const configDir = join(root, ".config", "opencode");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "AGENTS.md"), "# OpenCode\n");
    await writeFile(join(configDir, "opencode.jsonc"), "{}\n");

    const targets = await service.listTargets();
    const opencode = targets.find((target) => target.id === "opencode");

    expect(opencode?.health.status).toBe("ready");
    expect(opencode?.health.executablePath).toBe(executable);
    expect(opencode?.health.canWrite).toBe(true);
    expect(opencode?.conversationCapabilities).toMatchObject({
      history: { state: "available" },
      openOriginal: { state: "available" },
      continue: { state: "available" }
    });
  });

  it("marks OpenCode ready when the CLI exists and config paths can be created", async () => {
    const { binDir, service } = await makeService();
    const executable = join(binDir, "opencode");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);

    const targets = await service.listTargets();
    const opencode = targets.find((target) => target.id === "opencode");

    expect(opencode?.health.status).toBe("ready");
    expect(opencode?.health.canWrite).toBe(true);
  });

  it("reports the resolved Trae V2 runtime separately from its resource root", async () => {
    const { binDir, service } = await makeService();
    const executable = join(binDir, "traecli");
    const runtimeDir = join(root, ".trae", "cli");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await mkdir(join(runtimeDir, "sessions"), { recursive: true });

    const targets = await service.listTargets({ forceRefresh: true });
    const trae = targets.find((target) => target.id === "trae-cli");

    expect(trae).toMatchObject({
      paths: {
        configDir: join(root, ".trae"),
        runtimeDir,
        configPath: join(root, ".trae", "traecli.toml")
      },
      conversationCapabilities: {
        history: { state: "available" },
        openOriginal: { state: "available" },
        continue: { state: "degraded" }
      }
    });
    expect(trae?.health.checks).toContainEqual(expect.objectContaining({
      id: "runtimeDir",
      label: "Runtime directory",
      path: runtimeDir,
      exists: true,
      required: false
    }));
  });

  it("caches missing executable checks until an explicit refresh", async () => {
    const { binDir, service } = await makeService();
    const executable = join(binDir, "opencode");

    const initial = await service.listTargets();
    expect(initial.find((target) => target.id === "opencode")?.health.status).toBe(
      "missing"
    );

    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);

    const cached = await service.listTargets();
    expect(cached.find((target) => target.id === "opencode")?.health.status).toBe(
      "missing"
    );

    const refreshed = await service.listTargets({ forceRefresh: true });
    expect(refreshed.find((target) => target.id === "opencode")?.health).toEqual(
      expect.objectContaining({
        status: "ready",
        executableFound: true,
        executablePath: executable
      })
    );
  });

  it("finds CLIs in common user bin paths when the GUI PATH is sparse", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-discovery-"));
    const executable = join(root, ".local", "bin", "opencode");
    await mkdir(join(root, ".local", "bin"), { recursive: true });
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir: root,
      fakeHomeRoot: root
    });
    const service = createTargetDiscoveryService({
      paths,
      targetRegistry: createTargetRegistry([createOpenCodeTargetAdapter()]),
      pathEnv: "",
      shellPathLookup: false
    });

    const targets = await service.listTargets();
    const opencode = targets.find((target) => target.id === "opencode");

    expect(opencode?.health.executableFound).toBe(true);
    expect(opencode?.health.executablePath).toBe(executable);
    expect(opencode?.health.status).toBe("ready");
  });

  it("marks Claude Code ready when the CLI and writable user config files are present", async () => {
    const { binDir, service } = await makeService();
    const executable = join(binDir, "claude");
    const configDir = join(root, ".claude");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "CLAUDE.md"), "# Claude\n");
    await writeFile(join(configDir, "settings.json"), "{}\n");
    await writeFile(join(root, ".claude.json"), "{}\n");

    const targets = await service.listTargets();
    const claude = targets.find((target) => target.id === "claude-code");

    expect(claude?.health.status).toBe("ready");
    expect(claude?.health.executablePath).toBe(executable);
    expect(claude?.health.canWrite).toBe(true);
    expect(claude?.conversationCapabilities.continue).toMatchObject({
      state: "available",
      delivery: "context-file"
    });
    expect(claude?.health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mcpConfig",
          path: join(root, ".claude.json"),
          exists: true
        })
      ])
    );
  });

  it("marks Codex ready when the CLI and writable user config files are present", async () => {
    const { binDir, service } = await makeService();
    const executable = join(binDir, "codex");
    const codexDir = join(root, ".codex");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(codexDir, "AGENTS.md"), "# Codex\n");
    await writeFile(join(codexDir, "config.toml"), 'model = "gpt-5"\n');

    const targets = await service.listTargets();
    const codex = targets.find((target) => target.id === "codex");

    expect(codex?.health.status).toBe("ready");
    expect(codex?.health.executableFound).toBe(true);
    expect(codex?.health.canWrite).toBe(true);
    expect(codex?.conversationCapabilities.continue).toMatchObject({
      state: "available",
      delivery: "context-file"
    });
  });

  it("marks desktop-capable Agents ready without a command in PATH", async () => {
    const { service } = await makeService({ platform: "darwin" });
    const applications = [
      ["OpenCode.app", "opencode", "OpenCode app"],
      ["Claude.app", "claude-code", "Claude app"],
      ["Codex.app", "codex", "Codex app"]
    ] as const;
    for (const [bundleName] of applications) {
      await mkdir(join(root, "Applications", bundleName), { recursive: true });
    }

    const targets = await service.listTargets();

    for (const [bundleName, targetId, label] of applications) {
      const target = targets.find((item) => item.id === targetId);
      expect(target?.health).toEqual(expect.objectContaining({
        status: "ready",
        installationFound: true,
        executableFound: false,
        executablePath: undefined,
        canWrite: true
      }));
      expect(target?.health.installationEvidence).toEqual([{
        kind: "desktop-app",
        label,
        path: join(root, "Applications", bundleName)
      }]);
    }
  });

  it("keeps Antigravity CLI missing when only the desktop application exists", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-discovery-"));
    const homeDir = join(root, "home");
    const applicationPath = join(homeDir, "Applications", "Antigravity.app");
    await mkdir(applicationPath, { recursive: true });
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir,
      fakeHomeRoot: join(root, "fake-home")
    });
    const service = createTargetDiscoveryService({
      paths,
      targetRegistry: createTargetRegistry([createAntigravityTargetAdapter()]),
      pathEnv: "",
      shellPathLookup: false,
      platform: "darwin",
      allowSystemApplicationLookup: false
    });

    const [antigravity] = await service.listTargets();

    expect(antigravity.health).toEqual(expect.objectContaining({
      status: "missing",
      installationFound: false,
      executableFound: false,
      executablePath: undefined,
      canWrite: false
    }));
    expect(antigravity.health.installationEvidence).toEqual([]);
  });
});
