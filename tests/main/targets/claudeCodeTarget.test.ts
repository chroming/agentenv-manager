import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCodeTargetAdapter } from "../../../src/main/targets/claudeCodeTarget";
import { blockingMessages } from "../../helpers/applyIssues";

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

    expect(blockingMessages(preview.issues)).toEqual([]);
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

    expect(blockingMessages(preview.issues)).toEqual([expect.stringContaining("Agent-controlled")]);
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

  it("observes enabled Claude plugin Skills from the effective user install", async () => {
    const { adapter, paths } = await setup();
    const olderPlugin = join(root, "plugins", "older");
    const currentPlugin = join(root, "plugins", "current");
    const disabledPlugin = join(root, "plugins", "disabled");
    for (const [pluginRoot, skillName] of [
      [olderPlugin, "older-review"],
      [currentPlugin, "current-review"],
      [disabledPlugin, "disabled-review"]
    ]) {
      await mkdir(join(pluginRoot, "skills", skillName), { recursive: true });
      await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
      await writeFile(join(pluginRoot, ".claude-plugin", "plugin.json"), "{}\n", "utf8");
      await writeFile(
        join(pluginRoot, "skills", skillName, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: Plugin Skill\n---\n# Plugin\n`,
        "utf8"
      );
    }
    await writeFile(paths.configPath, JSON.stringify({
      enabledPlugins: {
        "review@marketplace": true,
        "disabled@marketplace": false
      }
    }));
    await mkdir(join(paths.configDir, "plugins"), { recursive: true });
    await writeFile(
      join(paths.configDir, "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "review@marketplace": [
            {
              scope: "project",
              installPath: olderPlugin,
              lastUpdated: "2026-01-01T00:00:00Z"
            },
            {
              scope: "user",
              installPath: currentPlugin,
              lastUpdated: "2026-02-01T00:00:00Z"
            }
          ],
          "disabled@marketplace": [{
            scope: "user",
            installPath: disabledPlugin,
            lastUpdated: "2026-03-01T00:00:00Z"
          }]
        }
      })
    );

    const snapshot = await adapter.skills.inspectRuntime(paths);

    expect(snapshot.observations).toHaveLength(1);
    expect(snapshot.observations[0]).toMatchObject({
      path: join(currentPlugin, "skills", "current-review"),
      runtimeName: "current-review",
      scope: "user",
      owner: "external",
      availability: "unknown",
      locationRole: "discovery-only",
      externalOwnership: {
        manager: "claude-plugin",
        displayName: "Claude Code plugin",
        importable: false
      }
    });
  });
});
