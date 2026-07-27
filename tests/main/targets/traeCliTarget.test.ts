import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTraeCliTargetAdapter } from "../../../src/main/targets/integrations/trae-cli";
import { blockingMessages } from "../../helpers/applyIssues";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async (layout: "v2" | "legacy" = "v2") => {
  root = await mkdtemp(join(tmpdir(), "agentenv-trae-cli-"));
  const configDir = join(root, ".trae");
  await mkdir(configDir, { recursive: true });
  if (layout === "legacy") {
    await writeFile(join(configDir, "traecli.yaml"), "");
  }
  const adapter = createTraeCliTargetAdapter();
  const paths = adapter.createTargetPaths({ homeDir: root });
  await mkdir(dirname(paths.instructionsPath), { recursive: true });
  return { adapter, paths, profile: adapter.createDefaultProfile("daily") };
};

describe("Trae CLI adapter", () => {
  it("defaults to the current layout and keeps shared resources version-neutral", async () => {
    const { adapter, paths } = await setup();

    expect(adapter.descriptor).toMatchObject({
      id: "trae-cli",
      name: "Trae CLI",
      executableName: "traecli",
      iconKey: "trae",
      instructionsLabel: "agentenv-manager.md",
      configLabel: "traecli.toml",
      configLanguage: "toml",
      capabilities: {
        instructions: true,
        skills: true,
        agentFormat: "trae-cli",
        mcpActivation: true
      }
    });
    expect(paths).toMatchObject({
      configDir: join(root, ".trae"),
      runtimeDir: join(root, ".trae", "cli"),
      instructionsPath: join(root, ".trae", "rules", "agentenv-manager.md"),
      configPath: join(root, ".trae", "traecli.toml"),
      skillsDir: join(root, ".trae", "skills"),
      skillScanDirs: [join(root, ".trae", "skills")]
    });
    expect(paths).not.toHaveProperty("mcpConfigPath");
    expect(paths.skillLocations).toEqual([
      expect.objectContaining({
        path: join(root, ".trae", "skills"),
        role: "preferred-runtime",
        management: "managed"
      })
    ]);
    expect(adapter.conversations).toBeDefined();
  });

  it("uses the legacy YAML config only after V2 evidence is absent", async () => {
    const { paths } = await setup("legacy");

    expect(paths).toMatchObject({
      runtimeDir: undefined,
      configPath: join(root, ".trae", "traecli.yaml"),
      instructionsPath: join(root, ".trae", "rules", "agentenv-manager.md"),
      skillsDir: join(root, ".trae", "skills")
    });
  });

  it.each(["traecli", "trae-cli", "trae-agent"])(
    "detects the official %s command alias",
    async (command) => {
      const { adapter } = await setup();
      const findExecutable = vi.fn(async (name: string) =>
        name === command ? join(root, "bin", command) : undefined
      );

      const installation = await adapter.detectInstallation({
        platform: "darwin",
        homeDir: root,
        allowSystemApplicationLookup: false,
        findExecutable,
        pathExists: async () => false
      });

      expect(installation).toEqual({
        found: true,
        evidence: [{
          kind: "command",
          label: `${command} command`,
          path: join(root, "bin", command)
        }]
      });
    }
  );

  it("does not use the ambiguous ta alias as installation evidence", async () => {
    const { adapter } = await setup();
    const findExecutable = vi.fn(async (name: string) =>
      name === "ta" ? join(root, "bin", "ta") : undefined
    );

    await expect(adapter.detectInstallation({
      platform: "darwin",
      homeDir: root,
      allowSystemApplicationLookup: false,
      findExecutable,
      pathExists: async () => false
    })).resolves.toEqual({ found: false, evidence: [] });
    expect(findExecutable).not.toHaveBeenCalledWith("ta");
  });

  it("does not parse or fingerprint malformed native config when MCPs are unmanaged", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, "[mcp_servers.broken");

    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          ...profile.resources,
          mcpByTarget: { "trae-cli": { mode: "ignore", selections: [] } }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: ["old"] }
    });

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(preview.changes.map(({ path }) => path)).toEqual([paths.instructionsPath]);
    expect(preview.liveFingerprints).not.toHaveProperty(paths.configPath);
    expect(preview.targetState.managedMcpNames).toEqual([]);
  });

  it("patches only selected V2 TOML enabled fields and preserves native settings", async () => {
    const { adapter, paths, profile } = await setup();
    const live = [
      'model = "fast"',
      "# keep this comment",
      "",
      "[mcp_servers.docs]",
      'command = "docs"',
      "enabled = false",
      "",
      "[mcp_servers.docs.env]",
      'TOKEN = "private-token"',
      "",
      "[mcp_servers.browser]",
      'url = "https://example.test/mcp"',
      ""
    ].join("\n");
    await writeFile(paths.configPath, live);

    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            "trae-cli": {
              mode: "manage",
              selections: [
                { name: "docs", enabled: true },
                { name: "browser", enabled: false }
              ]
            }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(blockingMessages(preview.issues)).toEqual([]);
    const change = preview.changes.find(({ path }) => path === paths.configPath);
    expect(change?.after).toContain("# keep this comment");
    expect(change?.after).toContain('TOKEN = "private-token"');
    expect(change?.after).toContain("[mcp_servers.docs]\ncommand = \"docs\"\nenabled = true");
    expect(change?.after).toContain("[mcp_servers.browser]\nenabled = false");
    expect(preview.targetState.managedMcpNames).toEqual(["browser", "docs"]);
  });

  it("patches only selected Legacy YAML disabled fields", async () => {
    const { adapter, paths, profile } = await setup("legacy");
    const live = [
      "model: fast",
      "# keep this comment",
      "mcp_servers:",
      "  - name: docs",
      "    command: docs",
      "    disabled: true",
      "  - name: browser",
      "    url: https://example.test/mcp",
      ""
    ].join("\n");
    await writeFile(paths.configPath, live);

    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            "trae-cli": {
              mode: "manage",
              selections: [
                { name: "docs", enabled: true },
                { name: "browser", enabled: false }
              ]
            }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(blockingMessages(preview.issues)).toEqual([]);
    const change = preview.changes.find(({ path }) => path === paths.configPath);
    expect(change?.after).toContain("# keep this comment");
    expect(change?.after).toContain("disabled: false");
    expect(change?.after).toContain("url: https://example.test/mcp\n    disabled: true");
  });

  it("blocks enabled missing MCPs and treats disabled missing MCPs as no-op", async () => {
    const { adapter, paths, profile } = await setup();
    const previewFor = (enabled: boolean) => adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            "trae-cli": {
              mode: "manage",
              selections: [{ name: "missing", enabled }]
            }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(blockingMessages((await previewFor(true)).issues)).toEqual([
      expect.stringContaining("not configured in Trae CLI")
    ]);
    const disabled = await previewFor(false);
    expect(blockingMessages(disabled.issues)).toEqual([]);
    expect(disabled.changes.map(({ path }) => path)).not.toContain(paths.configPath);
  });

  it("captures V2 MCPs without exposing credentials", async () => {
    const { adapter, paths } = await setup();
    await writeFile(paths.instructionsPath, "# Live Trae\n");
    await writeFile(paths.configPath, [
      'model = "fast"',
      "[mcp_servers.docs]",
      'command = "docs"',
      "enabled = false",
      "[mcp_servers.docs.env]",
      'TOKEN = "toml-private"',
      ""
    ].join("\n"));

    const captured = await adapter.captureProfile(paths);

    expect(captured.instructions).toBe("# Live Trae\n");
    expect(captured.mcpConnections).toEqual([
      expect.objectContaining({ name: "docs", enabled: false, controllable: true })
    ]);
    expect(JSON.stringify(captured)).not.toContain("toml-private");
    expect(captured.excluded).toContain(`${paths.configPath}.model`);
  });

  it("uses legacy AGENTS.md as a non-mutating capture fallback", async () => {
    const { adapter, paths } = await setup();
    const legacyInstructions = join(paths.configDir, "AGENTS.md");
    await writeFile(legacyInstructions, "# Existing Trae guidance\n");

    const captured = await adapter.captureProfile(paths);

    expect(captured.instructions).toBe("# Existing Trae guidance\n");
    expect(captured.warnings).toContain(
      "Legacy Trae CLI instructions remain Agent-owned"
    );
    expect(captured.excluded).toContain(legacyInstructions);
  });

  it("keeps inactive and obsolete version configs outside management", async () => {
    const { adapter, paths } = await setup();
    const inactive = join(paths.configDir, "traecli.yaml");
    const obsolete = join(paths.configDir, "trae_cli.yaml");
    await writeFile(inactive, "model: legacy\n");
    await writeFile(obsolete, "model: obsolete\n");

    const captured = await adapter.captureProfile(paths);

    expect(captured.mcpConnections).toEqual([]);
    expect(captured.excluded).toEqual(expect.arrayContaining([inactive, obsolete]));
    expect(captured.warnings).toEqual(expect.arrayContaining([
      "An inactive Trae CLI version config remains Agent-owned",
      "The obsolete trae_cli.yaml file remains Agent-owned"
    ]));
  });
});
