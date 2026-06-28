import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createClaudeCodeTargetAdapter } from "../../src/main/targets/claudeCodeTarget";
import { createTargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createCodexTargetAdapter } from "../../src/main/targets/codexTarget";
import { createOpenCodeTargetAdapter } from "../../src/main/targets/opencodeTarget";
import { createTargetRegistry } from "../../src/main/targets/registry";

let root = "";

const makeService = async () => {
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
    createCodexTargetAdapter()
  ]);
  const service = createTargetDiscoveryService({
    paths,
    targetRegistry,
    pathEnv: binDir
  });

  return { binDir, paths, service };
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("target discovery", () => {
  it("reports a missing OpenCode CLI and missing config paths without creating them", async () => {
    const { service } = await makeService();

    const targets = await service.listTargets();
    const opencode = targets.find((target) => target.id === "opencode");

    expect(opencode?.health.status).toBe("missing");
    expect(opencode?.health.executableFound).toBe(false);
    expect(opencode?.health.canWrite).toBe(false);
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
  });
});
