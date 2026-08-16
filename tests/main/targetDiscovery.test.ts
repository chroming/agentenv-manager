import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaths } from "../../src/main/paths";
import { pathExists } from "../../src/main/fileUtils";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createClaudeCodeTargetAdapter } from "../../src/main/targets/claudeCodeTarget";
import { createTargetDiscoveryService } from "../../src/main/targetDiscovery";
import type { MacApplicationDiscovery } from "../../src/main/targets/macApplicationDiscovery";
import { createCodexTargetAdapter } from "../../src/main/targets/codexTarget";
import { createOpenCodeTargetAdapter } from "../../src/main/targets/opencodeTarget";
import { createTargetRegistry } from "../../src/main/targets/registry";
import { createTargetScope } from "../../src/main/targets/targetScope";
import { createAntigravityTargetAdapter } from "../../src/main/targets/integrations/antigravity";
import { createPiTargetAdapter } from "../../src/main/targets/integrations/pi";
import { createTraeCliTargetAdapter } from "../../src/main/targets/integrations/trae-cli";
import { createFixtureAgentAdapter } from "../fixtures/targets/fixtureAgent";

let root = "";

const makeService = async (options: {
  platform?: NodeJS.Platform;
  macApplicationDiscovery?: MacApplicationDiscovery;
} = {}) => {
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
    createTraeCliTargetAdapter(),
    createPiTargetAdapter()
  ]);
  const settingsStore = createSettingsStore(paths, {
    supportedTargetIds: targetRegistry.list().map((target) => target.id)
  });
  await settingsStore.updateSettings({
    enabledTargetIds: targetRegistry.list().map((target) => target.id)
  });
  const targetScope = createTargetScope(targetRegistry, settingsStore);
  const service = createTargetDiscoveryService({
    paths,
    targetRegistry,
    targetScope,
    pathEnv: binDir,
    platform: options.platform,
    macApplicationDiscovery: options.macApplicationDiscovery
  });

  return { binDir, paths, service, settingsStore, targetRegistry, targetScope };
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("target discovery", () => {
  it("probes installed supported Agents without adding them to the operational scope", async () => {
    const { binDir, paths, service, settingsStore } = await makeService();
    const executable = join(binDir, "opencode");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await settingsStore.updateSettings({ enabledTargetIds: [] });

    await expect(service.listTargets()).resolves.toEqual([]);
    await expect(service.probeSupportedTargets()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "opencode",
          health: expect.objectContaining({ installationFound: true })
        })
      ])
    );
    await expect(pathExists(join(paths.homeDir, ".config", "opencode"))).resolves.toBe(false);
  });

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
    expect(opencode?.health).toMatchObject({
      executableStatus: "found",
      executableCandidate: "opencode",
      executableCandidates: ["opencode"]
    });
    expect(opencode?.conversationCapabilities).toMatchObject({
      history: { state: "available" },
      openOriginal: { state: "available" },
      continue: { state: "available" }
    });
  });

  it("uses a safe per-Agent command override before declared candidates", async () => {
    const { binDir, service, settingsStore } = await makeService();
    const executable = join(binDir, "opencode-nightly");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await settingsStore.updateSettings({
      targetCommandOverrides: { opencode: "opencode-nightly" }
    });

    const targets = await service.listTargets({ forceRefresh: true });
    const opencode = targets.find((target) => target.id === "opencode");

    expect(opencode?.health).toMatchObject({
      status: "ready",
      executableStatus: "found",
      executableCandidate: "opencode-nightly",
      executablePath: executable,
      executableOverride: "opencode-nightly"
    });
  });

  it("falls back through each declared executable candidate", async () => {
    const { binDir, service } = await makeService();
    const executable = join(binDir, "trae-agent");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);

    const targets = await service.listTargets({ forceRefresh: true });
    const trae = targets.find((target) => target.id === "trae-cli");

    expect(trae?.health).toMatchObject({
      status: "ready",
      executableStatus: "found",
      executableCandidate: "trae-agent",
      executablePath: executable
    });
  });

  it("keeps discovery available and reports unknown when one Agent probe fails", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-discovery-failure-"));
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir: root,
      fakeHomeRoot: root
    });
    const adapter = createFixtureAgentAdapter();
    adapter.detectInstallation = async () => {
      throw new Error("probe permission denied");
    };
    const targetRegistry = createTargetRegistry([adapter]);
    const settingsStore = createSettingsStore(paths, {
      supportedTargetIds: [adapter.descriptor.id]
    });
    await settingsStore.updateSettings({ enabledTargetIds: [adapter.descriptor.id] });
    const service = createTargetDiscoveryService({
      paths,
      targetRegistry,
      settingsStore,
      pathEnv: join(root, "bin")
    });

    await expect(service.listTargets()).resolves.toEqual([
      expect.objectContaining({
        id: "fixture-agent",
        health: expect.objectContaining({
          status: "unknown",
          executableStatus: "unknown",
          executableError: "probe permission denied",
          canWrite: false
        })
      })
    ]);
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

  it("reports Pi's configured session directory separately from its resource root", async () => {
    const { binDir, service } = await makeService();
    const executable = join(binDir, "pi");
    const agentRoot = join(root, ".pi", "agent");
    const runtimeDir = join(root, "pi-history");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(agentRoot, { recursive: true });
    await writeFile(
      join(agentRoot, "settings.json"),
      `${JSON.stringify({ sessionDir: runtimeDir })}\n`
    );

    const targets = await service.listTargets({ forceRefresh: true });
    const pi = targets.find((target) => target.id === "pi");

    expect(pi).toMatchObject({
      paths: {
        configDir: agentRoot,
        runtimeDir,
        configPath: join(agentRoot, "settings.json")
      },
      conversationCapabilities: {
        history: { state: "available" },
        openOriginal: { state: "available" },
        continue: { state: "available" }
      }
    });
    expect(pi?.health.checks).toContainEqual(expect.objectContaining({
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

  it("uses the verified ChatGPT bundled Codex runtime when no command is in PATH", async () => {
    const runtimeVersion = "codex-cli 0.148.0-alpha.9";
    const macApplicationDiscovery: MacApplicationDiscovery = {
      findApplicationsByBundleIdentifier: vi.fn().mockResolvedValue([]),
      readBundleIdentifier: vi.fn().mockResolvedValue("com.openai.codex"),
      probeExecutable: vi.fn().mockResolvedValue({
        status: "found",
        version: runtimeVersion
      })
    };
    const { service, targetRegistry } = await makeService({
      platform: "darwin",
      macApplicationDiscovery
    });
    const applicationPath = join(root, "Applications", "ChatGPT.app");
    const runtimePath = join(applicationPath, "Contents", "Resources", "codex");
    await mkdir(applicationPath, { recursive: true });

    const codex = (await service.listTargets({ forceRefresh: true }))
      .find((target) => target.id === "codex");

    expect(codex?.health).toMatchObject({
      status: "ready",
      installationFound: true,
      executableStatus: "found",
      executablePath: runtimePath,
      executableSource: "bundled-runtime",
      executableVersion: runtimeVersion,
      executableFound: true,
      canWrite: true
    });
    expect(codex?.health.executableCandidate).toBeUndefined();
    expect(codex?.health.installationEvidence).toEqual([{
      kind: "desktop-app",
      label: "ChatGPT app",
      path: applicationPath
    }]);
    expect(codex?.conversationCapabilities).toMatchObject({
      openOriginal: { state: "available" },
      continue: { state: "available", delivery: "context-file" }
    });
    const adapter = targetRegistry.get("codex");
    expect(adapter.projects?.createLaunchSpec({
      executablePath: codex?.health.executablePath,
      projectRoot: "/workspace/example"
    })).toEqual({
      executablePath: runtimePath,
      args: [],
      cwd: "/workspace/example"
    });
    await expect(adapter.evaluations?.checkAvailability({
      profile: adapter.createDefaultProfile("chatgpt-codex"),
      targetPaths: codex!.paths,
      sourceHomeDir: root,
      executablePath: codex?.health.executablePath,
      knownCliVersion: runtimeVersion,
      excludeMcp: true,
      platform: "darwin",
      environment: {}
    })).resolves.toMatchObject({
      available: true,
      cliVersion: runtimeVersion
    });
    await service.listTargets();
    expect(macApplicationDiscovery.probeExecutable).toHaveBeenCalledTimes(1);
    await service.listTargets({ forceRefresh: true });
    expect(macApplicationDiscovery.probeExecutable).toHaveBeenCalledTimes(2);
  });

  it("keeps Codex resource management available when ChatGPT has no usable runtime", async () => {
    const macApplicationDiscovery: MacApplicationDiscovery = {
      findApplicationsByBundleIdentifier: vi.fn().mockResolvedValue([]),
      readBundleIdentifier: vi.fn().mockResolvedValue("com.openai.codex"),
      probeExecutable: vi.fn().mockResolvedValue({ status: "missing" })
    };
    const { service } = await makeService({
      platform: "darwin",
      macApplicationDiscovery
    });
    await mkdir(join(root, "Applications", "ChatGPT.app"), { recursive: true });

    const codex = (await service.listTargets({ forceRefresh: true }))
      .find((target) => target.id === "codex");

    expect(codex?.health).toMatchObject({
      status: "ready",
      summary: "Detected; runtime unavailable",
      installationFound: true,
      executableStatus: "missing",
      executableFound: false,
      canWrite: true
    });
    expect(codex?.conversationCapabilities).toMatchObject({
      openOriginal: { state: "unavailable" },
      continue: { state: "degraded", delivery: "clipboard" }
    });
  });

  it("reports a bounded bundled-runtime probe failure without hiding the Codex installation", async () => {
    const macApplicationDiscovery: MacApplicationDiscovery = {
      findApplicationsByBundleIdentifier: vi.fn().mockResolvedValue([]),
      readBundleIdentifier: vi.fn().mockResolvedValue("com.openai.codex"),
      probeExecutable: vi.fn().mockResolvedValue({
        status: "unknown",
        error: "Bundled runtime check timed out"
      })
    };
    const { service } = await makeService({
      platform: "darwin",
      macApplicationDiscovery
    });
    await mkdir(join(root, "Applications", "ChatGPT.app"), { recursive: true });

    const codex = (await service.listTargets({ forceRefresh: true }))
      .find((target) => target.id === "codex");

    expect(codex?.health).toMatchObject({
      status: "ready",
      summary: "Detected; runtime check failed",
      installationFound: true,
      executableStatus: "unknown",
      executableError: "Bundled runtime check timed out",
      executableFound: false,
      canWrite: true
    });
  });

  it("prefers a PATH Codex command over the ChatGPT bundled runtime", async () => {
    const macApplicationDiscovery: MacApplicationDiscovery = {
      findApplicationsByBundleIdentifier: vi.fn().mockResolvedValue([]),
      readBundleIdentifier: vi.fn().mockResolvedValue("com.openai.codex"),
      probeExecutable: vi.fn().mockResolvedValue({
        status: "found",
        version: "bundled-version"
      })
    };
    const { binDir, service } = await makeService({
      platform: "darwin",
      macApplicationDiscovery
    });
    const executable = join(binDir, "codex");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await mkdir(join(root, "Applications", "ChatGPT.app"), { recursive: true });

    const codex = (await service.listTargets({ forceRefresh: true }))
      .find((target) => target.id === "codex");

    expect(codex?.health).toMatchObject({
      executablePath: executable,
      executableSource: "path",
      executableCandidate: "codex",
      executableFound: true
    });
    expect(macApplicationDiscovery.probeExecutable).not.toHaveBeenCalled();
  });

  it("marks desktop-capable Agents ready without a command in PATH", async () => {
    const { service } = await makeService({
      platform: "darwin",
      macApplicationDiscovery: {
        findApplicationsByBundleIdentifier: vi.fn().mockResolvedValue([]),
        readBundleIdentifier: vi.fn().mockResolvedValue("com.openai.codex"),
        probeExecutable: vi.fn().mockResolvedValue({ status: "missing" })
      }
    });
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
