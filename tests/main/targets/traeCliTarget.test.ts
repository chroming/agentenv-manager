import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTraeCliTargetAdapter } from "../../../src/main/targets/integrations/trae-cli";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-trae-cli-v2-"));
  const adapter = createTraeCliTargetAdapter();
  const paths = adapter.createTargetPaths({ homeDir: root });
  await mkdir(paths.configDir, { recursive: true });
  return { adapter, paths, profile: adapter.createDefaultProfile("daily") };
};

describe("Trae CLI Profile v2 adapter", () => {
  it("declares the verified user paths and isolated runtime Skill locations", async () => {
    const { adapter, paths } = await setup();

    expect(adapter.descriptor).toMatchObject({
      id: "trae-cli",
      name: "Trae CLI",
      executableName: "traecli",
      iconKey: "trae",
      capabilities: {
        instructions: true,
        skills: true,
        agentFormat: "trae-cli",
        mcpActivation: true
      }
    });
    expect(paths).toMatchObject({
      instructionsPath: join(root, ".trae", "AGENTS.md"),
      configPath: join(root, ".trae", "trae_cli.yaml"),
      mcpConfigPath: join(root, ".trae", "mcp.json"),
      skillsDir: join(root, ".trae", "skills"),
      skillScanDirs: [
        join(root, ".trae", "skills"),
        join(root, ".coco", "skills"),
        join(root, ".trae-cn", "skills")
      ]
    });
    expect(paths.skillLocations).toEqual([
      expect.objectContaining({
        path: join(root, ".trae", "skills"),
        role: "preferred-runtime",
        management: "managed"
      }),
      expect.objectContaining({
        path: join(root, ".coco", "skills"),
        role: "alternate-runtime",
        management: "observed"
      }),
      expect.objectContaining({
        path: join(root, ".trae-cn", "skills"),
        role: "alternate-runtime",
        management: "observed"
      })
    ]);
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

  it("ignores malformed MCP configuration without reading or fingerprinting it", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, "mcp_servers: [ broken");
    await writeFile(paths.mcpConfigPath!, "{ broken");

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

    expect(preview.errors).toEqual([]);
    expect(preview.changes.map(({ path }) => path)).toEqual([paths.instructionsPath]);
    expect(preview.liveFingerprints).not.toHaveProperty(paths.configPath);
    expect(preview.liveFingerprints).not.toHaveProperty(paths.mcpConfigPath!);
    expect(preview.targetState.managedMcpNames).toEqual([]);
  });

  it("patches only selected YAML disabled fields and preserves native settings", async () => {
    const { adapter, paths, profile } = await setup();
    const live = [
      "model: fast",
      "# keep this comment",
      "mcp_servers:",
      "  - name: docs",
      "    command: docs",
      "    disabled: true",
      "    env:",
      "      TOKEN: private-token",
      "  - name: browser",
      "    url: https://example.test/mcp",
      "credentials:",
      "  api_key: private-key",
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

    expect(preview.errors).toEqual([]);
    const change = preview.changes.find(({ path }) => path === paths.configPath);
    expect(change?.after).toBe([
      "model: fast",
      "# keep this comment",
      "mcp_servers:",
      "  - name: docs",
      "    command: docs",
      "    disabled: false",
      "    env:",
      "      TOKEN: private-token",
      "  - name: browser",
      "    url: https://example.test/mcp",
      "    disabled: true",
      "credentials:",
      "  api_key: private-key",
      ""
    ].join("\n"));
    expect(preview.targetState.managedMcpNames).toEqual(["browser", "docs"]);
  });

  it("patches only selected JSON disabled fields and preserves credentials", async () => {
    const { adapter, paths, profile } = await setup();
    const live = `{
  // preserve this comment
  "theme": "dark",
  "mcpServers": {
    "docs": {
      "type": "http",
      "url": "https://example.test/mcp",
      "headers": { "Authorization": "Bearer private" },
      "disabled": true
    }
  }
}\n`;
    await writeFile(paths.mcpConfigPath!, live);

    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            "trae-cli": {
              mode: "manage",
              selections: [{ name: "docs", enabled: true }]
            }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(preview.errors).toEqual([]);
    const change = preview.changes.find(({ path }) => path === paths.mcpConfigPath);
    expect(change?.after).toContain("// preserve this comment");
    expect(change?.after).toContain('"theme": "dark"');
    expect(change?.after).toContain('"Authorization": "Bearer private"');
    expect(change?.after).toContain('"disabled": false');
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

    expect((await previewFor(true)).errors).toEqual([
      expect.stringContaining("not configured in Trae CLI")
    ]);
    const disabled = await previewFor(false);
    expect(disabled.errors).toEqual([]);
    expect(disabled.changes.map(({ path }) => path)).not.toContain(paths.configPath);
    expect(disabled.changes.map(({ path }) => path)).not.toContain(paths.mcpConfigPath);
  });

  it("captures both user MCP sources without exposing credentials", async () => {
    const { adapter, paths } = await setup();
    await writeFile(paths.instructionsPath, "# Live Trae\n");
    await writeFile(paths.configPath, [
      "model: fast",
      "mcp_servers:",
      "  - name: docs",
      "    command: docs",
      "    disabled: true",
      "    env:",
      "      TOKEN: yaml-private",
      ""
    ].join("\n"));
    await writeFile(paths.mcpConfigPath!, JSON.stringify({
      mcpServers: {
        browser: {
          type: "http",
          url: "https://example.test/mcp",
          headers: { Authorization: "json-private" }
        }
      }
    }));
    await mkdir(join(root, ".coco"), { recursive: true });
    await writeFile(join(root, ".coco", "AGENTS.md"), "# Extra guidance\n");

    const captured = await adapter.captureProfile(paths);

    expect(captured.instructions).toBe("# Live Trae\n");
    expect(captured.mcpConnections).toEqual([
      expect.objectContaining({ name: "browser", enabled: true, controllable: true }),
      expect.objectContaining({ name: "docs", enabled: false, controllable: true })
    ]);
    expect(JSON.stringify(captured)).not.toContain("yaml-private");
    expect(JSON.stringify(captured)).not.toContain("json-private");
    expect(captured.warnings).toContain(
      "Additional Trae CLI user instructions remain Agent-owned"
    );
    expect(captured.excluded).toContain(join(root, ".coco", "AGENTS.md"));
    expect(captured.excluded).toContain(`${paths.configPath}.model`);
  });

  it("marks duplicate user definitions read-only and blocks persisted management", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, [
      "mcp_servers:",
      "  - name: docs",
      "    command: docs",
      ""
    ].join("\n"));
    await writeFile(paths.mcpConfigPath!, JSON.stringify({
      mcpServers: { docs: { url: "https://example.test/mcp" } }
    }));

    const captured = await adapter.captureProfile(paths);
    expect(captured.mcpConnections).toEqual([
      expect.objectContaining({
        name: "docs",
        controllable: false,
        detail: "duplicate-user-sources"
      })
    ]);

    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            "trae-cli": {
              mode: "manage",
              selections: [{ name: "docs", enabled: false }]
            }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });
    expect(preview.errors).toEqual([
      expect.stringContaining("defined in multiple Trae CLI user files")
    ]);
    expect(preview.changes.map(({ path }) => path)).not.toContain(paths.configPath);
    expect(preview.changes.map(({ path }) => path)).not.toContain(paths.mcpConfigPath);
  });

  it("keeps the documented legacy traecli.yaml source read-only", async () => {
    const { adapter, paths, profile } = await setup();
    const legacyPath = join(paths.configDir, "traecli.yaml");
    await writeFile(legacyPath, [
      "mcp_servers:",
      "  - name: legacy-docs",
      "    command: docs",
      ""
    ].join("\n"));

    const captured = await adapter.captureProfile(paths);
    expect(captured.mcpConnections).toEqual([
      expect.objectContaining({ name: "legacy-docs", controllable: false })
    ]);

    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            "trae-cli": {
              mode: "manage",
              selections: [{ name: "legacy-docs", enabled: false }]
            }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });
    expect(preview.errors).toEqual([
      expect.stringContaining("Agent-owned traecli.yaml")
    ]);
    expect(preview.liveFingerprints).toHaveProperty(legacyPath);
  });
});
