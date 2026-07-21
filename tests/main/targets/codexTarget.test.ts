import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexTargetAdapter } from "../../../src/main/targets/codexTarget";
import { blockingMessages, noticeMessages } from "../../helpers/applyIssues";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-codex-v2-"));
  const adapter = createCodexTargetAdapter();
  const paths = adapter.createTargetPaths({ homeDir: root });
  await mkdir(paths.configDir, { recursive: true });
  return { adapter, paths, profile: adapter.createDefaultProfile("daily") };
};

describe("Codex Profile v2 adapter", () => {
  it("ignores malformed MCP config when the Profile does not manage MCPs", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, "[broken");

    const preview = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedMcpNames: ["old"] }
    });

    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(preview.liveFingerprints).not.toHaveProperty(paths.configPath);
    expect(preview.targetState.managedMcpNames).toEqual([]);
  });

  it("patches only selected MCP enabled fields", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, `model = "gpt-5"

[mcp_servers.docs]
command = "docs"
enabled = false

[mcp_servers.other]
url = "https://example.test"
`);

    const preview = await adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            codex: { mode: "manage", selections: [{ name: "docs", enabled: true }] }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(blockingMessages(preview.issues)).toEqual([]);
    const configChange = preview.changes.find(({ path }) => path === paths.configPath);
    expect(configChange?.after).toContain('model = "gpt-5"');
    expect(configChange?.after).toContain('[mcp_servers.other]');
    expect(configChange?.after).toContain("enabled = true");
    expect(preview.targetState.managedMcpNames).toEqual(["docs"]);
  });

  it("blocks enabled missing MCPs and ignores disabled missing MCPs", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.configPath, "model = \"gpt-5\"\n");
    const previewFor = (enabled: boolean) => adapter.createPreview({
      profile: {
        ...profile,
        resources: {
          skills: [],
          mcpByTarget: {
            codex: { mode: "manage", selections: [{ name: "missing", enabled }] }
          }
        }
      },
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(blockingMessages((await previewFor(true)).issues)).toEqual([
      expect.stringContaining("not configured in Codex")
    ]);
    const disabled = await previewFor(false);
    expect(blockingMessages(disabled.issues)).toEqual([]);
    expect(disabled.changes.map(({ path }) => path)).not.toContain(paths.configPath);
  });

  it("captures MCP activation without capturing Codex native settings", async () => {
    const { adapter, paths } = await setup();
    await writeFile(paths.instructionsPath, "# Live Codex\n");
    await writeFile(paths.configPath, `model = "gpt-5"

[mcp_servers.docs]
command = "docs"
enabled = false
`);

    const captured = await adapter.captureProfile(paths);

    expect(captured.instructions).toBe("# Live Codex\n");
    expect(captured.mcpConnections).toEqual([
      expect.objectContaining({ targetId: "codex", name: "docs", enabled: false })
    ]);
    expect(captured.excluded).toEqual(["config.toml.model"]);
  });

  it("warns when AGENTS.override.md can shadow managed instructions", async () => {
    const { adapter, paths, profile } = await setup();
    await writeFile(paths.instructionsOverridePath!, "# Override\n");

    const preview = await adapter.createPreview({
      profile,
      targetPaths: paths,
      state: { managedMcpNames: [] }
    });

    expect(noticeMessages(preview.issues)).toEqual([
      expect.stringContaining("may override AGENTS.md")
    ]);
  });
});
