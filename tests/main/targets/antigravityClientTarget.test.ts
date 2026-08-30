import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityClientTargetAdapter } from "../../../src/main/targets/integrations/antigravity-client";
import { blockingMessages } from "../../helpers/applyIssues";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-client-"));
  const adapter = createAntigravityClientTargetAdapter();
  const paths = adapter.createTargetPaths({ homeDir: root });
  await mkdir(paths.configDir, { recursive: true });
  return { adapter, paths, profile: adapter.createDefaultProfile("daily") };
};

describe("Antigravity Client Target adapter", () => {
  it("describes the Antigravity Client target correctly", () => {
    const adapter = createAntigravityClientTargetAdapter();
    expect(adapter.descriptor.id).toBe("antigravity-client");
    expect(adapter.descriptor.name).toBe("Antigravity Client");
    expect(adapter.descriptor.iconKey).toBe("antigravity");
    expect(adapter.descriptor.instructionsLabel).toBe("GEMINI.md");
    expect(adapter.descriptor.configLabel).toBe("mcp_config.json");
  });

  it("applies GEMINI.md without reading MCP configuration", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, "{ invalid");

    const preview = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(preview.changes.map(({ path }) => path)).toEqual([paths.instructionsPath]);
    expect(preview.liveFingerprints).not.toHaveProperty(paths.configPath);
  });

  it("blocks unsupported MCP management and enforces the instruction limit", async () => {
    const { adapter, paths, profile } = await setup();
    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        instructions: "x".repeat(12_001),
        resources: {
          skills: [],
          mcpByTarget: {
            "antigravity-client": { mode: "manage", selections: [{ name: "docs", enabled: true }] }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(blockingMessages(preview.issues)).toEqual([
      expect.stringContaining("12,000 character limit"),
      expect.stringContaining("Agent-controlled")
    ]);
  });

  it("captures read-only MCP observations", async () => {
    const { adapter, paths } = await setup();
    await writeFile(paths.configPath, JSON.stringify({
      mcpServers: { docs: { command: "docs" } }
    }));

    const captured = await adapter.captureProfile(paths);

    expect(captured.mcpConnections).toEqual([
      expect.objectContaining({ name: "docs", controllable: false, targetId: "antigravity-client" })
    ]);
    expect(captured.excluded).toEqual(["mcp_config.json.mcpServers"]);
  });

  it("declares desktop app and command discovery evidence", async () => {
    const adapter = createAntigravityClientTargetAdapter();
    const result = await adapter.detectInstallation({
      platform: "darwin",
      homeDir: "/Users/test",
      allowSystemApplicationLookup: true,
      findExecutable: async () => undefined,
      pathExists: async (path) => path === "/Applications/Antigravity.app",
      findMacApplicationsByBundleIdentifier: async () => ["/Applications/Antigravity.app"],
      readMacApplicationBundleIdentifier: async () => "com.google.antigravity"
    });

    expect(result.found).toBe(true);
    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: "desktop-app",
        path: "/Applications/Antigravity.app"
      })
    ]);
  });
});
