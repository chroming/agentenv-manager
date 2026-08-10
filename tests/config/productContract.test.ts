import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

describe("public product model contract", () => {
  it("keeps one canonical object name and navigation order", async () => {
    const [sidebar, readme, contract] = await Promise.all([
      read("src/renderer/components/ProfileSidebar.tsx"),
      read("README.en.md"),
      read("docs/product-contracts.md")
    ]);

    const labels = [
      'label: t("Agents")',
      'label: t("Profiles")',
      'label: t("Workspaces")',
      'label: t("Conversations")'
    ];
    labels.reduce((previous, label) => {
      const index = sidebar.indexOf(label);
      expect(index).toBeGreaterThan(previous);
      return index;
    }, -1);
    expect(readme).toContain("## Profiles");
    expect(readme).toContain("## Workspaces");
    expect(readme).not.toMatch(/^## (Environments|Projects)$/m);
    expect(contract).toContain("### 4.2.4 Workspaces");
    expect(contract).toContain("### 4.3 Profile");
  });

  it("keeps Workspace mutations portable and Git advisory-only", async () => {
    const [contract, workspace, gitService] = await Promise.all([
      read("docs/product-contracts.md"),
      read("src/renderer/components/ProjectsWorkspace.tsx"),
      read("src/main/projects/projectGitService.ts")
    ]);

    expect(contract).toContain("AgentEnv MUST NOT create a link from a Workspace");
    expect(contract).toMatch(/MUST\s+NOT stage, commit, checkout, reset, clean, stash/);
    expect(workspace).toContain('t("Copy Skill to Workspace")');
    expect(workspace).toContain('t("Git changes stay unstaged and uncommitted.")');
    expect(gitService).toContain('["rev-parse", "--show-toplevel"]');
    expect(gitService).not.toMatch(/\["(?:add|commit|checkout|reset|clean|stash)"/);
  });

  it("keeps Profile and Workspace Agent count behavior under one owner", async () => {
    const [profileWorkspace, projectWorkspace, agentSwitcher, contract] = await Promise.all([
      read("src/renderer/App.tsx"),
      read("src/renderer/components/ProjectsWorkspace.tsx"),
      read("src/renderer/components/AgentContextSwitcher.tsx"),
      read("docs/product-contracts.md")
    ]);

    expect(profileWorkspace).toContain("<AgentContextSwitcher");
    expect(projectWorkspace).toContain("<AgentContextSwitcher");
    expect(profileWorkspace).not.toContain("static={installedTargets.length === 1}");
    expect(projectWorkspace).not.toContain("static={availableTargets.length === 1}");
    expect(agentSwitcher).toContain("const isStatic = targets.length === 1");
    expect(contract).toContain("Pages MUST NOT redefine these count states independently.");
  });
});
