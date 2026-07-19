import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createMcpLibraryStore } from "../../src/main/mcpLibraryStore";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createTargetCaptureService } from "../../src/main/targetCaptureService";
import type { TargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { TargetInfo } from "../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("OpenCode Create from Target e2e", () => {
  it("captures the live environment without modifying source files or deployment state", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-e2e-"));
    const homeDir = join(root, "home");
    const appDataRoot = join(root, "app-data");
    const paths = createPaths({ appDataRoot, homeDir });
    const targetRegistry = createTargetRegistry();
    const settingsStore = createSettingsStore(paths);
    const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    const mcpLibraryStore = createMcpLibraryStore(paths);
    const activationService = createActivationService({
      paths,
      profileStore,
      targetRegistry,
      settingsStore,
      skillLibraryStore,
      mcpLibraryStore
    });
    const captureService = createTargetCaptureService({
      paths,
      profileStore,
      targetRegistry,
      skillLibraryStore,
      mcpLibraryStore,
      targetDiscoveryService: {
        listTargets: async () => [
          { id: "opencode", health: { executableFound: true } } as TargetInfo
        ]
      } satisfies TargetDiscoveryService
    });
    const targetDir = join(homeDir, ".config", "opencode");
    const oldPrivateSkill = join(targetDir, "skills", "reviewer");
    const sharedSkill = join(paths.userSkillsDir, "reviewer");
    const skillContent = "---\nname: Reviewer\ndescription: Review code.\n---\n\n# Reviewer\n";
    await mkdir(oldPrivateSkill, { recursive: true });
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(join(oldPrivateSkill, "SKILL.md"), skillContent, "utf8");
    await writeFile(join(sharedSkill, "SKILL.md"), skillContent, "utf8");
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n", "utf8");
    await writeFile(
      join(targetDir, "opencode.jsonc"),
      JSON.stringify({
        username: "developer",
        mcp: {
          docs: {
            type: "local",
            command: ["node", "server.js"],
            environment: { DOCS_TOKEN: "{env:DOCS_TOKEN}" }
          }
        }
      }),
      "utf8"
    );

    const preview = await captureService.previewTarget("opencode");
    expect(preview.errors).toEqual([]);
    expect(preview.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "skill",
          id: "reviewer",
          action: "import",
          detail: "2 source copies stay unchanged"
        }),
        expect.objectContaining({ kind: "mcp", id: "docs", action: "include" })
      ])
    );

    const result = await captureService.createFromTarget({
      previewId: preview.id,
      name: "Imported OpenCode"
    });
    await expect(readFile(join(oldPrivateSkill, "SKILL.md"), "utf8")).resolves.toContain("# Reviewer");
    await expect(readFile(join(sharedSkill, "SKILL.md"), "utf8")).resolves.toContain("# Reviewer");
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .resolves.toContain("# Reviewer");
    await expect(readFile(join(oldPrivateSkill, ".agentenv-owner.json"), "utf8"))
      .rejects.toThrow();
    await expect(profileStore.readProfile(result.profile.id)).resolves.toMatchObject({
      instructions: "# Existing OpenCode\n",
      assetPolicy: {
        skillRefs: [{ libraryId: "reviewer", targetName: "reviewer" }],
        mcpRefs: [],
        mcpSelections: [{ targetId: "opencode", name: "docs", enabled: true }]
      }
    });
    await expect(mcpLibraryStore.listServers()).resolves.toEqual([]);
    await expect(activationService.listTargetStates()).resolves.toEqual([]);
  });
});
