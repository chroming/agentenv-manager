import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCodeTargetAdapter } from "../../../src/main/targets/claudeCodeTarget";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-claude-v2-"));
  const adapter = createClaudeCodeTargetAdapter();
  const paths = adapter.createTargetPaths({ homeDir: root });
  await mkdir(paths.configDir, { recursive: true });
  return { adapter, paths, profile: adapter.createDefaultProfile("daily") };
};

describe("Claude Code Profile v2 adapter", () => {
  it("applies Instructions without reading or changing native settings", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, "{ invalid settings");
    await writeFile(paths.mcpConfigPath!, "{ invalid mcp");

    const preview = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedMcpNames: ["old"] }
    });

    expect(preview.errors).toEqual([]);
    expect(preview.changes.map(({ path }) => path)).toEqual([paths.instructionsPath]);
    expect(preview.liveFingerprints).not.toHaveProperty(paths.configPath);
    expect(preview.liveFingerprints).not.toHaveProperty(paths.mcpConfigPath!);
    expect(preview.targetState.managedMcpNames).toEqual([]);
  });

  it("blocks an unsupported manage policy instead of touching Claude settings", async () => {
    const { adapter, paths, profile } = await setup();
    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            "claude-code": {
              mode: "manage",
              selections: [{ name: "docs", enabled: true }]
            }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(preview.errors).toEqual([expect.stringContaining("Agent-controlled")]);
    expect(preview.changes.map(({ path }) => path)).not.toContain(paths.configPath);
  });

  it("captures MCPs as read-only observations and excludes settings", async () => {
    const { adapter, paths } = await setup();
    await writeFile(paths.instructionsPath, "# Claude\n");
    await writeFile(paths.configPath, JSON.stringify({ permissions: { defaultMode: "acceptEdits" } }));
    await writeFile(paths.mcpConfigPath!, JSON.stringify({
      mcpServers: { docs: { command: "docs", args: [] } },
      projects: {}
    }));

    const captured = await adapter.captureProfile(paths);

    expect(captured.instructions).toBe("# Claude\n");
    expect(captured.mcpConnections).toEqual([
      expect.objectContaining({ name: "docs", controllable: false })
    ]);
    expect(captured.excluded).toContain("settings.json.permissions");
    expect(captured.excluded).toContain(".claude.json.mcpServers");
  });
});
