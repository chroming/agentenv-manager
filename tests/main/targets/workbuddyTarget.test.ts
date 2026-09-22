import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../../src/main/activationService";
import { createPaths } from "../../../src/main/paths";
import { createProfileStore } from "../../../src/main/profileStore";
import { createSettingsStore } from "../../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../../src/main/skillLibraryStore";
import { createWorkBuddyTargetAdapter } from "../../../src/main/targets/integrations/workbuddy";
import { createTargetRegistry } from "../../../src/main/targets/registry";
import { blockingMessages } from "../../helpers/applyIssues";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("WorkBuddy target", () => {
  it("detects only the verified macOS application identity", async () => {
    const adapter = createWorkBuddyTargetAdapter();
    const applicationPath = "/Applications/WorkBuddy.app";
    const baseInput = {
      platform: "darwin" as const,
      homeDir: "/Users/test",
      allowSystemApplicationLookup: true,
      findExecutable: async () => undefined,
      pathExists: async (path: string) => path === applicationPath,
      findMacApplicationsByBundleIdentifier: async () => [applicationPath]
    };

    await expect(adapter.detectInstallation({
      ...baseInput,
      readMacApplicationBundleIdentifier: async () => "com.tencent.workbuddy.mac"
    })).resolves.toMatchObject({
      found: true,
      evidence: [{ kind: "desktop-app", label: "WorkBuddy.app", path: applicationPath }]
    });
    await expect(adapter.detectInstallation({
      ...baseInput,
      readMacApplicationBundleIdentifier: async () => "com.example.not-workbuddy"
    })).resolves.toEqual({ found: false, evidence: [] });
  });

  it("discovers only direct user Skills and declares no native config ownership", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-workbuddy-target-"));
    const adapter = createWorkBuddyTargetAdapter();
    const paths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(join(paths.skillsDir!, "review"), { recursive: true });
    await writeFile(
      join(paths.skillsDir!, "review", "SKILL.md"),
      "---\nname: review\ndescription: Review changes\n---\n# Review\n",
      "utf8"
    );
    await mkdir(join(paths.skillsDir!, "collection", "nested"), { recursive: true });
    await writeFile(
      join(paths.skillsDir!, "collection", "nested", "SKILL.md"),
      "---\nname: nested\n---\n# Nested\n",
      "utf8"
    );

    expect(adapter.descriptor.capabilities).toMatchObject({
      instructions: false,
      skills: true,
      nativeConfig: false,
      mcpActivation: false,
      evaluation: false
    });
    await expect(adapter.captureProfile(paths)).resolves.toEqual({
      instructions: "",
      mcpConnections: [],
      agentControlledResources: [],
      warnings: [],
      excluded: []
    });
    const runtime = await adapter.skills.inspectRuntime(paths);
    expect(runtime.observations.map((item) => item.runtimeName)).toEqual(["review"]);
  });

  it("summarizes bundled and enabled Connector Skills without treating them as user Skills", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-workbuddy-provided-"));
    const adapter = createWorkBuddyTargetAdapter();
    const paths = adapter.createTargetPaths({ homeDir: root, rootDirOverride: join(root, "custom", "configuration") });
    const bundledRoot = join(
      root,
      "Applications",
      "WorkBuddy.app",
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "resources",
      "plugins",
      "workbuddy-builtin"
    );
    await mkdir(join(bundledRoot, ".codebuddy-plugin"), { recursive: true });
    await mkdir(join(bundledRoot, "skills", "bundled-review"), { recursive: true });
    await writeFile(join(bundledRoot, ".codebuddy-plugin", "marketplace.json"), "{}", "utf8");
    await writeFile(
      join(bundledRoot, "skills", "bundled-review", "SKILL.md"),
      "---\nname: bundled-review\n---\n# Bundled\n",
      "utf8"
    );
    const connectorStateDir = join(paths.configDir, "connectors", "account");
    const connectorSkillDir = join(
      paths.configDir,
      "connectors-marketplace",
      "connectors",
      "docs",
      "skills",
      "connector-review"
    );
    await mkdir(connectorStateDir, { recursive: true });
    await mkdir(connectorSkillDir, { recursive: true });
    await writeFile(
      join(connectorStateDir, "connector-states.v3.json"),
      JSON.stringify({ enabled: ["docs", "../unsafe"] }),
      "utf8"
    );
    await writeFile(
      join(connectorSkillDir, "SKILL.md"),
      "---\nname: connector-review\n---\n# Connector\n",
      "utf8"
    );

    await expect(adapter.captureProfile(paths, { installationEvidence: [
      { kind: "desktop-app", label: "WorkBuddy", path: join(root, "Applications", "WorkBuddy.app") }
    ] })).resolves.toMatchObject({
      agentControlledResources: [
        { kind: "skill", provider: "WorkBuddy", count: 1 },
        { kind: "skill", provider: "WorkBuddy Connectors", count: 1 }
      ]
    });
    await expect(adapter.skills.inspectRuntime(paths)).resolves.toMatchObject({
      observations: []
    });
    await writeFile(join(connectorStateDir, "connector-states.v3.json"), "{ broken");
    const partial = await adapter.captureProfile(paths, { installationEvidence: [
      { kind: "desktop-app", label: "WorkBuddy", path: join(root, "Applications", "WorkBuddy.app") }
    ] });
    expect(partial.warnings).toEqual([expect.stringContaining("Connector state could not be read")]);
    expect(partial.agentControlledResources).toEqual([
      expect.objectContaining({ provider: "WorkBuddy", skills: [expect.objectContaining({ name: "bundled-review", availability: "bundled" })] })
    ]);
    await expect(adapter.captureProfile(paths)).resolves.toMatchObject({ agentControlledResources: [] });
  });

  it("applies and rolls back Skills without changing WorkBuddy-owned data", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-workbuddy-apply-"));
    const homeDir = join(root, "home");
    const appDataRoot = join(root, "data");
    const paths = createPaths({ appDataRoot, homeDir });
    const adapter = createWorkBuddyTargetAdapter();
    const targetRegistry = createTargetRegistry([adapter]);
    const settingsStore = createSettingsStore(paths, { supportedTargetIds: ["workbuddy"] });
    await settingsStore.updateSettings({
      enabledTargetIds: ["workbuddy"],
      skillSyncMethod: "copy"
    });
    const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore, {
      targetPathsProvider: async () => [adapter.createTargetPaths({ homeDir })]
    });
    const service = createActivationService({
      paths,
      profileStore,
      settingsStore,
      skillLibraryStore,
      targetRegistry
    });
    const workBuddyRoot = join(homeDir, ".workbuddy");
    const source = join(root, "source-skill");
    await mkdir(join(workBuddyRoot, "connectors", "default"), { recursive: true });
    await mkdir(join(workBuddyRoot, "memory"), { recursive: true });
    await writeFile(join(workBuddyRoot, "settings.json"), '{"theme":"dark"}\n', "utf8");
    await writeFile(join(workBuddyRoot, "workbuddy.db"), "database-bytes", "utf8");
    await writeFile(join(workBuddyRoot, "connectors", "default", "mcp.json"), '{"secret":"keep"}\n', "utf8");
    await writeFile(join(workBuddyRoot, "memory", "memory.json"), '{"keep":true}\n', "utf8");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: review\ndescription: Review changes\n---\n# Review\n",
      "utf8"
    );
    await skillLibraryStore.importSkill({ sourcePath: source, id: "review" });
    const created = await profileStore.createProfile({
      preferredTargetId: "workbuddy",
      name: "WorkBuddy review",
      description: ""
    });
    await profileStore.saveProfile({
      manifest: created.manifest,
      instructions: "# Must never be written to WorkBuddy\n",
      resources: {
        skills: [{ libraryId: "review", targetName: "review", enabled: true }],
        managementByTarget: {
          workbuddy: { instructions: "manage", skills: "manage" }
        },
        mcpByTarget: {
          workbuddy: { mode: "manage", selections: [{ name: "private", enabled: false }] }
        }
      },
      expectedContentHash: created.contentHash
    });
    const protectedPaths = [
      join(workBuddyRoot, "settings.json"),
      join(workBuddyRoot, "workbuddy.db"),
      join(workBuddyRoot, "connectors", "default", "mcp.json"),
      join(workBuddyRoot, "memory", "memory.json")
    ];
    const protectedBefore = new Map(await Promise.all(protectedPaths.map(async (path) => [
      path,
      await readFile(path, "utf8")
    ] as const)));
    const expectProtectedDataUnchanged = async () => {
      for (const [path, content] of protectedBefore) {
        await expect(readFile(path, "utf8")).resolves.toBe(content);
      }
    };

    const preview = await service.previewProfile(created.id, "workbuddy");
    expect(blockingMessages(preview.issues)).toEqual([]);
    expect(preview.changes).toEqual([]);
    const result = await service.applyProfile(created.id, preview.id);
    expect(result.ok).toBe(true);
    await expect(
      readFile(join(workBuddyRoot, "skills", "review", "SKILL.md"), "utf8")
    ).resolves.toContain("# Review");
    await expectProtectedDataUnchanged();

    if (!result.ok) throw new Error(result.errors.join("; "));
    const rollbackPreview = await service.previewRollback(result.backupId);
    expect(rollbackPreview.errors).toEqual([]);
    expect((await service.rollback(result.backupId)).ok).toBe(true);
    await expect(
      readFile(join(workBuddyRoot, "skills", "review", "SKILL.md"), "utf8")
    ).rejects.toThrow();
    await expectProtectedDataUnchanged();
  });
});
