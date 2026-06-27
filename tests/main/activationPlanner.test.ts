import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationPreview } from "../../src/main/activationPlanner";
import { createPaths } from "../../src/main/paths";
import type { ProfileDetail } from "../../src/shared/types";

let root = "";

const makePaths = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-preview-"));
  const codexHome = join(root, ".codex");
  const userSkillsDir = join(root, ".agents", "skills");
  await mkdir(codexHome, { recursive: true });
  await mkdir(userSkillsDir, { recursive: true });
  return createPaths({ appDataRoot: root, codexHome, userSkillsDir });
};

const makeProfile = (overrides: Partial<ProfileDetail> = {}): ProfileDetail => ({
  id: "daily-coding",
  manifest: {
    id: "daily-coding",
    name: "Daily Coding",
    description: "Default",
    version: 1,
    managed: { agents: true, mcp: true, skills: true }
  },
  agentsMd: "# New agents\n",
  mcpToml: '[mcp_servers.context7]\ncommand = "npx"\n',
  skillsPolicy: {
    ownedSkillDirs: [],
    disabledSkillPaths: ["/Users/example/.agents/skills/old/SKILL.md"]
  },
  ...overrides
});

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("activation planner", () => {
  it("plans replacing global AGENTS.md", async () => {
    const paths = await makePaths();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");

    const preview = await createActivationPreview({
      paths,
      profile: makeProfile({ mcpToml: "", skillsPolicy: { ownedSkillDirs: [], disabledSkillPaths: [] } })
    });

    const agentsChange = preview.changes.find(
      (change) => change.path === paths.globalAgentsPath
    );
    expect(preview.errors).toEqual([]);
    expect(agentsChange?.before).toBe("# Old agents\n");
    expect(agentsChange?.after).toBe("# New agents\n");
    expect(agentsChange?.diff).toContain("-# Old agents");
  });

  it("plans managed MCP and skills sections while preserving unrelated config", async () => {
    const paths = await makePaths();
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n# keep me\n');

    const preview = await createActivationPreview({
      paths,
      profile: makeProfile()
    });

    const configChange = preview.changes.find(
      (change) => change.path === paths.codexConfigPath
    );
    expect(preview.errors).toEqual([]);
    expect(configChange?.after).toContain("# keep me");
    expect(configChange?.after).toContain("# BEGIN AgentEnv Manager: mcp");
    expect(configChange?.after).toContain("[mcp_servers.context7]");
    expect(configChange?.after).toContain("# BEGIN AgentEnv Manager: skills");
    expect(configChange?.after).toContain("[[skills.config]]");
  });

  it("warns when AGENTS.override.md exists", async () => {
    const paths = await makePaths();
    await writeFile(paths.globalAgentsOverridePath, "# Override\n");

    const preview = await createActivationPreview({
      paths,
      profile: makeProfile({ mcpToml: "", skillsPolicy: { ownedSkillDirs: [], disabledSkillPaths: [] } })
    });

    expect(preview.warnings).toContain(
      `${paths.globalAgentsOverridePath} exists and may override AGENTS.md`
    );
  });

  it("returns an error for invalid final TOML", async () => {
    const paths = await makePaths();
    await writeFile(paths.codexConfigPath, "[mcp_servers.broken\n");

    const preview = await createActivationPreview({
      paths,
      profile: makeProfile()
    });

    expect(preview.errors.some((error) => error.includes("Invalid live config"))).toBe(
      true
    );
  });

  it("returns an error for unmanaged MCP conflicts", async () => {
    const paths = await makePaths();
    await writeFile(
      paths.codexConfigPath,
      '[mcp_servers.context7]\ncommand = "npx"\n'
    );

    const preview = await createActivationPreview({
      paths,
      profile: makeProfile()
    });

    expect(preview.errors).toContain(
      "MCP server context7 already exists outside AgentEnv-managed section"
    );
  });
});
