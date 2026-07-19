import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityTargetAdapter } from "../../../src/main/targets/integrations/antigravity";
import type { ProfileDetail, TargetState } from "../../../src/shared/types";

let root = "";

const makeProfile = (configText: string): ProfileDetail => ({
  id: "antigravity-profile",
  profileDir: join(root, "profile"),
  manifest: {
    id: "antigravity-profile",
    targetId: "antigravity",
    name: "Antigravity Profile",
    description: "Test Profile",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  },
  instructions: "# Antigravity\n",
  configText,
  assetPolicy: {
    ownedDirs: [],
    ownedFiles: [],
    skillRefs: [],
    mcpRefs: [],
    disabledSkillPaths: []
  }
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Antigravity target adapter", () => {
  it("uses the documented global rules, MCP, and Skills locations", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-"));
    const paths = createAntigravityTargetAdapter().createTargetPaths({ homeDir: root });

    expect(paths).toMatchObject({
      targetId: "antigravity",
      configDir: join(root, ".gemini", "config"),
      instructionsPath: join(root, ".gemini", "GEMINI.md"),
      configPath: join(root, ".gemini", "config", "mcp_config.json"),
      skillsDir: join(root, ".gemini", "config", "skills")
    });
    expect(paths.skillLocations).toContainEqual({
      path: join(root, ".gemini", "antigravity-cli", "skills"),
      role: "discovery-only",
      shared: false
    });
  });

  it("replaces managed MCPs while preserving unrelated live servers and root keys", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-"));
    const adapter = createAntigravityTargetAdapter();
    const paths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.instructionsPath, "# Old\n", "utf8");
    await writeFile(paths.configPath, `${JSON.stringify({
      metadata: { keep: true },
      mcpServers: {
        unmanaged: { serverUrl: "https://example.com/unmanaged" },
        stale: { command: "old" }
      }
    }, null, 2)}\n`, "utf8");
    const state: TargetState = { managedConfigKeys: [], managedMcpNames: ["stale"] };
    const profile = makeProfile(`${JSON.stringify({
      mcpServers: {
        docs: { serverUrl: "https://example.com/docs" }
      }
    }, null, 2)}\n`);

    const preview = await adapter.createPreview({ profile, targetPaths: paths, state });
    const mcpChange = preview.changes.find((change) => change.path === paths.configPath);
    const after = JSON.parse(mcpChange?.after ?? "{}") as Record<string, any>;

    expect(preview.errors).toEqual([]);
    expect(after.metadata).toEqual({ keep: true });
    expect(after.mcpServers.unmanaged).toEqual({ serverUrl: "https://example.com/unmanaged" });
    expect(after.mcpServers.docs).toEqual({ serverUrl: "https://example.com/docs" });
    expect(after.mcpServers.stale).toBeUndefined();
    expect(preview.targetState.managedMcpNames).toEqual(["docs"]);
  });

  it("rejects JSONC syntax and conflicting unmanaged MCP names", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-"));
    const adapter = createAntigravityTargetAdapter();
    const paths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.configPath, JSON.stringify({
      mcpServers: { docs: { serverUrl: "https://example.com/live" } }
    }), "utf8");

    const invalid = await adapter.createPreview({
      profile: makeProfile('{"mcpServers": {},}'),
      targetPaths: paths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });
    expect(invalid.errors[0]).toContain("Invalid profile Antigravity MCP config");

    const invalidShape = await adapter.createPreview({
      profile: makeProfile('{"mcpServers": []}'),
      targetPaths: paths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });
    expect(invalidShape.errors).toContain(
      "Invalid profile Antigravity MCP config: mcpServers must be an object"
    );

    const conflict = await adapter.createPreview({
      profile: makeProfile(JSON.stringify({
        mcpServers: { docs: { serverUrl: "https://example.com/profile" } }
      })),
      targetPaths: paths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });
    expect(conflict.errors).toContain(
      "MCP server docs already exists outside AgentEnv management"
    );
  });

  it("materializes Library MCPs with Antigravity serverUrl and command shapes", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-"));
    const adapter = createAntigravityTargetAdapter();
    const profile = makeProfile("{\n  \"mcpServers\": {}\n}\n");
    profile.assetPolicy.mcpRefs = [
      { libraryId: "docs", targetName: "docs" },
      { libraryId: "local", targetName: "local" }
    ];

    const materialized = adapter.materializeMcpRefs(profile, [
      { id: "docs", name: "Docs", transport: "http", url: "https://example.com/mcp" },
      { id: "local", name: "Local", transport: "stdio", command: "node", args: ["server.js"] }
    ]);

    expect(JSON.parse(materialized.configText)).toEqual({
      mcpServers: {
        docs: { serverUrl: "https://example.com/mcp" },
        local: { command: "node", args: ["server.js"] }
      }
    });
  });

  it("captures only portable non-secret MCP definitions", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-"));
    const adapter = createAntigravityTargetAdapter();
    const paths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.instructionsPath, "# Existing rules\n", "utf8");
    await writeFile(paths.configPath, JSON.stringify({
      mcpServers: {
        docs: { serverUrl: "https://example.com/docs" },
        local: { command: "node", args: ["server.js"] },
        secret: { serverUrl: "https://example.com/private", headers: { Authorization: "token" } },
        environment: { command: "node", env: { TOKEN: "literal" } },
        badArgs: { command: "node", args: "server.js" }
      }
    }), "utf8");

    const captured = await adapter.captureProfile(paths);

    expect(captured.instructions).toBe("# Existing rules\n");
    expect(captured.mcpServers.map((server) => server.name)).toEqual(["docs", "local"]);
    expect(captured.excluded).toEqual(expect.arrayContaining([
      "mcp_config.json.mcpServers.secret",
      "mcp_config.json.mcpServers.environment",
      "mcp_config.json.mcpServers.badArgs"
    ]));
  });

  it("blocks rules beyond Antigravity's documented character limit", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-"));
    const adapter = createAntigravityTargetAdapter();
    const paths = adapter.createTargetPaths({ homeDir: root });
    const profile = makeProfile("{}");
    profile.instructions = "x".repeat(12_001);

    const preview = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });

    expect(preview.errors).toContain(
      "Antigravity GEMINI.md exceeds the 12,000 character limit"
    );
  });
});
