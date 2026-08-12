import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPiTargetAdapter } from "../../../src/main/targets/integrations/pi";
import { blockingMessages, noticeMessages } from "../../helpers/applyIssues";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-pi-"));
  const adapter = createPiTargetAdapter();
  const paths = adapter.createTargetPaths({ homeDir: root });
  await mkdir(paths.configDir, { recursive: true });
  return { adapter, paths, profile: adapter.createDefaultProfile("daily") };
};

describe("Pi adapter", () => {
  it("declares official paths, shared Skills consumption, and no built-in MCP support", async () => {
    const { adapter, paths, profile } = await setup();

    expect(adapter.descriptor).toMatchObject({
      id: "pi",
      name: "Pi",
      executableName: "pi",
      iconKey: "pi",
      instructionsLabel: "AGENTS.md",
      configLabel: "settings.json",
      capabilities: {
        instructions: true,
        skills: true,
        mcpTransports: [],
        mcpActivation: false
      }
    });
    expect(paths).toMatchObject({
      targetId: "pi",
      configDir: join(root, ".pi", "agent"),
      runtimeDir: join(root, ".pi", "agent", "sessions"),
      instructionsPath: join(root, ".pi", "agent", "AGENTS.md"),
      configPath: join(root, ".pi", "agent", "settings.json"),
      skillsDir: join(root, ".pi", "agent", "skills"),
      sharedSkillLocationIds: ["agents-skills"]
    });
    expect(paths.skillLocations).toEqual([
      expect.objectContaining({
        path: join(root, ".pi", "agent", "skills"),
        role: "preferred-runtime",
        scanDepth: "recursive",
        management: "managed"
      }),
      expect.objectContaining({
        path: join(root, ".agents", "skills"),
        sharedLocationId: "agents-skills",
        management: "shared-runtime"
      })
    ]);
    expect(profile.manifest).toMatchObject({
      preferredTargetId: "pi",
      iconKey: "pi"
    });
    expect(adapter.conversations).toBeDefined();
  });

  it("detects only the pi command", async () => {
    const { adapter } = await setup();
    const executable = join(root, "bin", "pi");
    const findExecutable = vi.fn(async (name: string) =>
      name === "pi" ? executable : undefined
    );

    await expect(adapter.detectInstallation({
      platform: "darwin",
      homeDir: root,
      allowSystemApplicationLookup: false,
      findExecutable,
      pathExists: async () => false
    })).resolves.toEqual({
      found: true,
      evidence: [{ kind: "command", label: "pi command", path: executable }]
    });
    expect(findExecutable).toHaveBeenCalledTimes(1);
  });

  it("captures Instructions while keeping settings and extension state outside Profiles", async () => {
    const { adapter, paths } = await setup();
    await writeFile(paths.instructionsPath, "# Pi guidance\n");
    await writeFile(paths.configPath, JSON.stringify({
      theme: "dark",
      packages: ["git:github.com/example/tools"]
    }));

    await expect(adapter.captureProfile(paths)).resolves.toEqual({
      instructions: "# Pi guidance\n",
      mcpConnections: [],
      warnings: [
        "Pi settings, authentication, packages, and extensions remain Agent-owned"
      ],
      excluded: [paths.configPath]
    });
  });

  it("previews only managed Instructions and reports new-session reload precisely", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.instructionsPath, "# Existing\n");
    await writeFile(paths.configPath, "{broken");

    const changed = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedMcpNames: ["old"] }
    });

    expect(blockingMessages(changed.issues)).toEqual([]);
    expect(changed.changes.map(({ path }) => path)).toEqual([
      paths.instructionsPath
    ]);
    expect(noticeMessages(changed.issues)).toEqual([
      expect.stringContaining("Instruction changes load in new Pi sessions.")
    ]);
    expect(changed.liveFingerprints).not.toHaveProperty(paths.configPath);
    expect(changed.targetState.managedMcpNames).toEqual([]);

    await writeFile(paths.instructionsPath, profile.instructions);
    const current = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });
    expect(current.changes).toEqual([]);
    expect(current.issues.map(({ code }) => code)).not.toContain(
      "runtime-reload-required"
    );
  });

  it("does not inspect Instructions or settings when all Pi resources are unmanaged", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.instructionsPath, "# Existing\n");
    await writeFile(paths.configPath, "{broken");
    profile.resources.managementByTarget = {
      pi: { instructions: "ignore", skills: "ignore" }
    };
    profile.resources.mcpByTarget.pi = { mode: "ignore", selections: [] };

    const preview = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(preview.changes).toEqual([]);
    expect(preview.liveFingerprints).toEqual({});
    await expect(adapter.validateAssets({ profile, targetPaths: paths }))
      .resolves.toEqual([]);
    await expect(adapter.getAssetBackupPaths({ profile, targetPaths: paths }))
      .resolves.toEqual([]);
  });

  it("blocks malformed imported Profiles that claim Pi MCP management", async () => {
    const { adapter, paths, profile } = await setup();
    profile.resources.mcpByTarget.pi = {
      mode: "manage",
      selections: [{ name: "extension-server", enabled: true }]
    };

    const preview = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(blockingMessages(preview.issues)).toEqual([
      "Pi has no built-in MCP configuration. Set this Profile to Ignore MCPs for Pi."
    ]);
    expect(preview.changes.map(({ path }) => path)).toContain(
      paths.instructionsPath
    );
    expect(preview.changes.map(({ path }) => path)).not.toContain(
      paths.configPath
    );
  });
});
