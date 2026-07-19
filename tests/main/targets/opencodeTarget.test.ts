import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenCodeTargetAdapter } from "../../../src/main/targets/opencodeTarget";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-opencode-v2-"));
  const adapter = createOpenCodeTargetAdapter();
  const paths = adapter.createTargetPaths({ homeDir: root });
  await mkdir(paths.configDir, { recursive: true });
  return { adapter, paths, profile: adapter.createDefaultProfile("daily") };
};

describe("OpenCode Profile v2 adapter", () => {
  it("creates a portable v2 Profile", () => {
    const profile = createOpenCodeTargetAdapter().createDefaultProfile("daily");
    expect(profile.manifest).toMatchObject({ version: 2, preferredTargetId: "opencode" });
    expect(profile.resources).toEqual({ skills: [], mcpByTarget: {} });
  });

  it("ignores MCP configuration without parsing or fingerprinting it", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, "{ broken jsonc");

    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          ...profile.resources,
          mcpByTarget: { opencode: { mode: "ignore", selections: [] } }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: ["old"] }
    });

    expect(preview.errors).toEqual([]);
    expect(preview.liveFingerprints).not.toHaveProperty(paths.configPath);
    expect(preview.changes.map(({ path }) => path)).not.toContain(paths.configPath);
    expect(preview.targetState.managedMcpNames).toEqual([]);
  });

  it("patches only selected MCP enabled fields and preserves native settings", async () => {
    const { adapter, paths, profile } = await setup();
    const live = `{
  // user setting
  "theme": "dark",
  "mcp": {
    "docs": { "type": "local", "command": ["docs"], "enabled": false },
    "other": { "type": "remote", "url": "https://example.test" }
  }
}\n`;
    await writeFile(paths.configPath, live);

    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            opencode: {
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
    const configChange = preview.changes.find(({ path }) => path === paths.configPath);
    expect(configChange?.after).toContain('"theme": "dark"');
    expect(configChange?.after).toContain('"docs": {');
    expect(configChange?.after).toContain('"enabled": true');
    expect(configChange?.after).toContain('"other": {');
    expect(preview.targetState.managedMcpNames).toEqual(["docs"]);
  });

  it("blocks an enabled missing MCP but treats a disabled missing MCP as no-op", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, "{}\n");
    const previewFor = (enabled: boolean) => adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            opencode: { mode: "manage", selections: [{ name: "missing", enabled }] }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect((await previewFor(true)).errors).toEqual([
      expect.stringContaining("not configured in OpenCode")
    ]);
    const disabled = await previewFor(false);
    expect(disabled.errors).toEqual([]);
    expect(disabled.changes.map(({ path }) => path)).not.toContain(paths.configPath);
  });

  it("captures instructions and MCP state while excluding native settings", async () => {
    const { adapter, paths } = await setup();
    await writeFile(paths.instructionsPath, "# Live\n");
    await writeFile(paths.configPath, JSON.stringify({
      theme: "dark",
      mcp: { docs: { type: "local", command: ["docs"], enabled: false } }
    }));

    const captured = await adapter.captureProfile(paths);

    expect(captured.instructions).toBe("# Live\n");
    expect(captured.mcpConnections).toEqual([
      expect.objectContaining({ targetId: "opencode", name: "docs", enabled: false })
    ]);
    expect(captured.excluded).toEqual(["opencode.jsonc.theme"]);
  });
});
