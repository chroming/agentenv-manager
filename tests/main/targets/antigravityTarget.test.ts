import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityTargetAdapter } from "../../../src/main/targets/integrations/antigravity";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-v2-"));
  const adapter = createAntigravityTargetAdapter();
  const paths = adapter.createTargetPaths({ homeDir: root });
  await mkdir(paths.configDir, { recursive: true });
  return { adapter, paths, profile: adapter.createDefaultProfile("daily") };
};

describe("Antigravity Profile v2 adapter", () => {
  it("applies GEMINI.md without reading MCP configuration", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, "{ invalid");

    const preview = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(preview.errors).toEqual([]);
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
            antigravity: { mode: "manage", selections: [{ name: "docs", enabled: true }] }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(preview.errors).toEqual([
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
      expect.objectContaining({ name: "docs", controllable: false })
    ]);
    expect(captured.excluded).toEqual(["mcp_config.json.mcpServers"]);
  });
});
