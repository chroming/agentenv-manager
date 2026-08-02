import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { blockingMessages, reviewMessages } from "../helpers/applyIssues";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("OpenCode Profile v2 switching e2e", () => {
  it("pauses and resumes Instructions, Skills, and MCP management without losing Profile data", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-resource-policy-e2e-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const profileStore = createProfileStore({ appDataRoot: paths.appDataRoot, homeDir: paths.homeDir });
    const settingsStore = createSettingsStore(paths);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const source = join(root, "sources", "reviewer");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: reviewer\ndescription: Review\n---\n# Managed v1\n"
    );
    const librarySkill = await skillLibraryStore.importSkill({ sourcePath: source, id: "reviewer" });
    const manifest = {
      id: "opencode-daily",
      name: "OpenCode daily",
      description: "",
      preferredTargetId: "opencode",
      version: 2 as const
    };
    const managedResources = {
      skills: [{ libraryId: "reviewer", targetName: "reviewer", enabled: true }],
      managementByTarget: {
        opencode: { instructions: "manage" as const, skills: "manage" as const }
      },
      mcpByTarget: {
        opencode: {
          mode: "manage" as const,
          selections: [{ name: "docs", enabled: true }]
        }
      }
    };
    let savedProfile = await profileStore.saveProfile({
      manifest,
      instructions: "# Profile instructions\n",
      resources: managedResources
    });
    const targetDir = join(paths.homeDir, ".config", "opencode");
    const targetSkill = join(targetDir, "skills", "reviewer");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Before\n");
    await writeFile(
      join(targetDir, "opencode.jsonc"),
      '{"mcp":{"docs":{"type":"local","command":["docs"],"enabled":false}}}\n'
    );
    const service = createActivationService({ paths, profileStore, settingsStore, skillLibraryStore });
    const apply = async () => {
      const preview = await service.previewProfile(manifest.id, "opencode");
      expect(blockingMessages(preview.issues)).toEqual([]);
      const applied = await service.applyProfile(manifest.id, preview.id);
      expect(applied.ok).toBe(true);
      return preview;
    };

    await apply();
    expect((await lstat(targetSkill)).isSymbolicLink()).toBe(true);

    await profileStore.saveProfile({
      manifest,
      instructions: "# Profile instructions\n",
      expectedContentHash: savedProfile.contentHash,
      resources: {
        ...managedResources,
        managementByTarget: {
          opencode: { instructions: "ignore", skills: "ignore" }
        },
        mcpByTarget: {
          opencode: { ...managedResources.mcpByTarget.opencode, mode: "ignore" }
        }
      }
    });
    expect((await service.listTargetStates())[0]?.lifecycleStatus).toBe("pending");
    await writeFile(join(targetDir, "AGENTS.md"), "# Local instructions\n");
    const pausedPreview = await apply();
    expect(pausedPreview.changes.map((change) => change.path)).not.toContain(
      join(targetDir, "AGENTS.md")
    );
    expect(pausedPreview.resourceChanges).toContainEqual(
      expect.objectContaining({ path: targetSkill, action: "replace" })
    );
    expect((await lstat(targetSkill)).isSymbolicLink()).toBe(false);
    await expect(readFile(join(targetDir, "AGENTS.md"), "utf8"))
      .resolves.toBe("# Local instructions\n");
    expect((await service.listTargetStates())[0]).toMatchObject({
      lifecycleStatus: "applied",
      errorCount: 0
    });

    await writeFile(
      join(librarySkill.path, "SKILL.md"),
      "---\nname: reviewer\ndescription: Review\n---\n# Managed v2\n"
    );
    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8"))
      .resolves.toContain("# Managed v1");
    expect((await service.listTargetStates())[0]?.lifecycleStatus).toBe("applied");

    savedProfile = await profileStore.saveProfile({
      manifest,
      instructions: "# Profile instructions\n",
      resources: managedResources,
      expectedContentHash: (await profileStore.readProfile(manifest.id)).contentHash
    });
    const resumePreview = await service.previewProfile(manifest.id, "opencode");
    expect(reviewMessages(resumePreview.issues)).toEqual([
      expect.stringContaining("AgentEnv-managed Instructions changed outside AgentEnv")
    ]);
    const resumed = await service.applyProfile(manifest.id, resumePreview.id);
    expect(resumed.ok).toBe(true);
    await expect(readFile(join(targetDir, "AGENTS.md"), "utf8"))
      .resolves.toBe("# Profile instructions\n");
    await expect(readFile(join(targetSkill, "SKILL.md"), "utf8"))
      .resolves.toContain("# Managed v2");
  });

  it("switches Instructions, Library Skills, and selected MCP activation only", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-v2-e2e-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const profileStore = createProfileStore({ appDataRoot: paths.appDataRoot, homeDir: paths.homeDir });
    const settingsStore = createSettingsStore(paths);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    for (const id of ["alpha", "beta"]) {
      const source = join(root, "sources", id);
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "SKILL.md"), `---\nname: ${id}\ndescription: ${id}\n---\n# ${id}\n`);
      await skillLibraryStore.importSkill({ sourcePath: source, id });
      await profileStore.saveProfile({
        manifest: {
          id: `opencode-${id}`,
          name: `OpenCode ${id}`,
          description: "",
          preferredTargetId: "opencode",
          version: 2
        },
        instructions: `# ${id.toUpperCase()}\n`,
        resources: {
          skills: [{ libraryId: id, targetName: id, enabled: true }],
          mcpByTarget: {
            opencode: {
              mode: "manage",
              selections: [
                { name: "alpha", enabled: id === "alpha" },
                { name: "beta", enabled: id === "beta" }
              ]
            }
          }
        }
      });
    }
    const targetDir = join(paths.homeDir, ".config", "opencode");
    await mkdir(join(targetDir, "skills", "manual"), { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Before\n");
    await writeFile(join(targetDir, "skills", "manual", "SKILL.md"), "---\nname: manual\n---\n# Manual\n");
    await writeFile(join(targetDir, "opencode.jsonc"), `{
  // must remain untouched
  "username": "local-user",
  "mcp": {
    "alpha": { "type": "local", "command": ["alpha"], "enabled": false },
    "beta": { "type": "local", "command": ["beta"], "enabled": true }
  }
}\n`);
    const service = createActivationService({ paths, profileStore, settingsStore, skillLibraryStore });

    const apply = async (id: "alpha" | "beta") => {
      const preview = await service.previewProfile(`opencode-${id}`, "opencode");
      expect(blockingMessages(preview.issues)).toEqual([]);
      const result = await service.applyProfile(`opencode-${id}`, preview.id);
      expect(result.ok).toBe(true);
    };

    await apply("alpha");
    expect(await readFile(join(targetDir, "AGENTS.md"), "utf8")).toBe("# ALPHA\n");
    let config = parse(await readFile(join(targetDir, "opencode.jsonc"), "utf8")) as any;
    expect(config.username).toBe("local-user");
    expect(config.mcp.alpha.enabled).toBe(true);
    expect(config.mcp.beta.enabled).toBe(false);
    await expect(readFile(join(targetDir, "skills", "alpha", "SKILL.md"), "utf8"))
      .resolves.toContain("# alpha");

    await apply("beta");
    config = parse(await readFile(join(targetDir, "opencode.jsonc"), "utf8")) as any;
    expect(config.username).toBe("local-user");
    expect(config.mcp.alpha.enabled).toBe(false);
    expect(config.mcp.beta.enabled).toBe(true);
    await expect(readFile(join(targetDir, "skills", "alpha", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(targetDir, "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");
    await expect(readFile(join(targetDir, "skills", "manual", "SKILL.md"), "utf8"))
      .rejects.toThrow();
  });
});
