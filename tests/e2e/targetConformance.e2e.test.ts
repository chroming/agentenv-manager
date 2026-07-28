import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createTargetCaptureService } from "../../src/main/targetCaptureService";
import type { TargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createBuiltInTargetAdapters } from "../../src/main/targets/integrations";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { AgentTargetAdapter } from "../../src/main/targets/types";
import type { ProfileResources } from "../../src/shared/schemas";
import type { TargetInfo } from "../../src/shared/types";
import {
  snapshotFilesystemTree
} from "../helpers/filesystemSnapshot";
import {
  profileResourcesFor,
  targetConformanceFixtures,
  type TargetConformanceFixture
} from "../helpers/targetConformanceFixtures";
import { blockingMessages } from "../helpers/applyIssues";

let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

const createEnvironment = async (
  fixture: TargetConformanceFixture,
  transformAdapter?: (adapter: AgentTargetAdapter) => AgentTargetAdapter
) => {
  const root = await mkdtemp(join(tmpdir(), `agentenv-${fixture.targetId}-contract-`));
  roots.push(root);
  const paths = createPaths({
    appDataRoot: join(root, "data"),
    homeDir: join(root, "home")
  });
  const builtIn = createBuiltInTargetAdapters().find(
    (adapter) => adapter.descriptor.id === fixture.targetId
  );
  if (!builtIn) throw new Error(`Missing built-in adapter ${fixture.targetId}`);
  const adapter = transformAdapter?.(builtIn) ?? builtIn;
  const targetRegistry = createTargetRegistry([adapter]);
  const profileStore = createProfileStore(
    { appDataRoot: paths.appDataRoot, homeDir: paths.homeDir },
    targetRegistry
  );
  const settingsStore = createSettingsStore(paths);
  await settingsStore.updateSettings({ enabledTargetIds: [fixture.targetId] });
  const skillLibraryStore = createSkillLibraryStore(paths, settingsStore, {
    targetPathsProvider: async () => [
      adapter.createTargetPaths({ homeDir: paths.homeDir })
    ]
  });
  const service = createActivationService({
    paths,
    profileStore,
    settingsStore,
    skillLibraryStore,
    targetRegistry
  });
  const targetPaths = adapter.createTargetPaths({ homeDir: paths.homeDir });
  return {
    root,
    paths,
    adapter,
    targetPaths,
    targetRegistry,
    profileStore,
    settingsStore,
    skillLibraryStore,
    service
  };
};

const importSkill = async (
  environment: Awaited<ReturnType<typeof createEnvironment>>,
  id: "alpha" | "beta"
) => {
  const source = join(environment.root, "sources", id);
  await mkdir(source, { recursive: true });
  await writeFile(
    join(source, "SKILL.md"),
    `---\nname: ${id}\ndescription: ${id} contract Skill.\n---\n# ${id.toUpperCase()}\n`,
    "utf8"
  );
  return environment.skillLibraryStore.importSkill({ sourcePath: source, id });
};

const saveProfile = async (
  environment: Awaited<ReturnType<typeof createEnvironment>>,
  fixture: TargetConformanceFixture,
  id: "alpha" | "beta",
  resources: ProfileResources = profileResourcesFor(fixture, id)
) =>
  environment.profileStore.saveProfile({
    manifest: {
      id: `${fixture.targetId}-${id}`,
      name: `${fixture.targetName} ${id}`,
      description: "Target conformance Profile",
      preferredTargetId: fixture.targetId,
      version: 2
    },
    instructions: `# ${id.toUpperCase()} INSTRUCTIONS\n`,
    resources
  });

const assertPreservedNativeState = async (
  nativeState: Awaited<ReturnType<TargetConformanceFixture["setupNativeState"]>>
) => {
  for (const [path, content] of nativeState.preservedFiles) {
    await expect(readFile(path, "utf8")).resolves.toBe(content);
  }
  for (const [path, fragments] of nativeState.preservedFragments ?? []) {
    const content = await readFile(path, "utf8");
    for (const fragment of fragments) expect(content).toContain(fragment);
  }
};

const applyProfile = async (
  environment: Awaited<ReturnType<typeof createEnvironment>>,
  profileId: string
) => {
  const preview = await environment.service.previewProfile(
    profileId,
    environment.adapter.descriptor.id
  );
  expect(blockingMessages(preview.issues)).toEqual([]);
  const result = await environment.service.applyProfile(profileId, preview.id);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { preview, result };
};

describe.each(targetConformanceFixtures)(
  "$targetName Target conformance",
  (fixture) => {
    it("detects its command without treating configuration residue as installation", async () => {
      const environment = await createEnvironment(fixture);
      const missing = await environment.adapter.detectInstallation({
        platform: "darwin",
        homeDir: environment.paths.homeDir,
        allowSystemApplicationLookup: false,
        findExecutable: async () => undefined,
        pathExists: async () => false
      });
      expect(missing.found).toBe(false);

      const executablePath = join(environment.paths.homeDir, "bin", fixture.executableName);
      const detected = await environment.adapter.detectInstallation({
        platform: "darwin",
        homeDir: environment.paths.homeDir,
        allowSystemApplicationLookup: false,
        findExecutable: async (name) =>
          name === fixture.executableName ? executablePath : undefined,
        pathExists: async () => false
      });
      expect(detected).toMatchObject({
        found: true,
        evidence: [expect.objectContaining({ kind: "command", path: executablePath })]
      });
    });

    it("captures current resources without changing the Agent filesystem", async () => {
      const environment = await createEnvironment(fixture);
      await fixture.setupNativeState(
        environment.paths.homeDir,
        environment.targetPaths,
        { includeSkill: true }
      );
      const before = await snapshotFilesystemTree(environment.paths.homeDir);
      const captureService = createTargetCaptureService({
        paths: environment.paths,
        profileStore: environment.profileStore,
        skillLibraryStore: environment.skillLibraryStore,
        targetRegistry: environment.targetRegistry,
        targetDiscoveryService: {
          listTargets: async () => [
            {
              id: fixture.targetId,
              name: fixture.targetName,
              health: { executableFound: true }
            } as TargetInfo
          ]
        } satisfies TargetDiscoveryService
      });

      const preview = await captureService.previewTarget(fixture.targetId);
      expect(preview.errors).toEqual([]);
      expect(preview.resources).toContainEqual(
        expect.objectContaining({ kind: "skill", id: "existing" })
      );
      const result = await captureService.createFromTarget({
        previewId: preview.id,
        name: `${fixture.targetName} captured`
      });

      expect(result.profile.resources.skills).toContainEqual(
        expect.objectContaining({ libraryId: "existing", enabled: true })
      );
      expect(await snapshotFilesystemTree(environment.paths.homeDir)).toEqual(before);
    });

    it("switches Profiles, survives a service restart, no-ops, and rolls back exactly", async () => {
      const environment = await createEnvironment(fixture);
      const nativeState = await fixture.setupNativeState(
        environment.paths.homeDir,
        environment.targetPaths
      );
      await importSkill(environment, "alpha");
      await importSkill(environment, "beta");
      await saveProfile(environment, fixture, "alpha");
      await saveProfile(environment, fixture, "beta");

      await applyProfile(environment, `${fixture.targetId}-alpha`);
      const afterAlpha = await snapshotFilesystemTree(environment.paths.homeDir);
      const beta = await applyProfile(environment, `${fixture.targetId}-beta`);
      await expect(readFile(environment.targetPaths.instructionsPath, "utf8"))
        .resolves.toBe("# BETA INSTRUCTIONS\n");
      await expect(
        readFile(join(environment.targetPaths.skillsDir!, "alpha", "SKILL.md"), "utf8")
      ).rejects.toThrow();
      await expect(
        readFile(join(environment.targetPaths.skillsDir!, "beta", "SKILL.md"), "utf8")
      ).resolves.toContain("# BETA");
      await assertPreservedNativeState(nativeState);

      const restartedService = createActivationService({
        paths: environment.paths,
        profileStore: environment.profileStore,
        settingsStore: environment.settingsStore,
        skillLibraryStore: environment.skillLibraryStore,
        targetRegistry: environment.targetRegistry
      });
      const [state] = await restartedService.listTargetStates();
      expect(state).toMatchObject({
        activeProfileId: `${fixture.targetId}-beta`,
        lifecycleStatus: "applied",
        errorCount: 0
      });
      const noOp = await restartedService.previewProfile(
        `${fixture.targetId}-beta`,
        fixture.targetId
      );
      expect(blockingMessages(noOp.issues)).toEqual([]);
      expect(noOp.changes).toEqual([]);
      expect(noOp.resourceChanges).toEqual([]);

      const rollbackPreview = await restartedService.previewRollback(beta.result.backupId);
      expect(rollbackPreview.errors).toEqual([]);
      expect((await restartedService.rollback(beta.result.backupId)).ok).toBe(true);
      expect(await snapshotFilesystemTree(environment.paths.homeDir)).toEqual(afterAlpha);
      expect((await restartedService.listTargetStates())[0]).toMatchObject({
        activeProfileId: `${fixture.targetId}-alpha`,
        lifecycleStatus: "applied"
      });
    });

    it("keeps ignored resources local and restores Profile management later", async () => {
      const environment = await createEnvironment(fixture);
      const nativeState = await fixture.setupNativeState(
        environment.paths.homeDir,
        environment.targetPaths
      );
      const librarySkill = await importSkill(environment, "alpha");
      await saveProfile(environment, fixture, "alpha");
      await applyProfile(environment, `${fixture.targetId}-alpha`);

      await saveProfile(environment, fixture, "alpha", {
        ...profileResourcesFor(fixture, "alpha", {
          instructions: "ignore",
          skills: "ignore"
        }),
        mcpByTarget: {
          [fixture.targetId]: { mode: "ignore", selections: [] }
        }
      });
      await writeFile(environment.targetPaths.instructionsPath, "# LOCAL INSTRUCTIONS\n", "utf8");
      await applyProfile(environment, `${fixture.targetId}-alpha`);
      await expect(readFile(environment.targetPaths.instructionsPath, "utf8"))
        .resolves.toBe("# LOCAL INSTRUCTIONS\n");
      const installedSkill = join(environment.targetPaths.skillsDir!, "alpha", "SKILL.md");
      const installedBeforeLibraryChange = await readFile(installedSkill, "utf8");
      await writeFile(
        join(librarySkill.path, "SKILL.md"),
        "---\nname: alpha\n---\n# LIBRARY CHANGED\n",
        "utf8"
      );
      await expect(readFile(installedSkill, "utf8")).resolves.toBe(installedBeforeLibraryChange);
      await assertPreservedNativeState(nativeState);

      await saveProfile(environment, fixture, "alpha");
      await applyProfile(environment, `${fixture.targetId}-alpha`);
      await expect(readFile(environment.targetPaths.instructionsPath, "utf8"))
        .resolves.toBe("# ALPHA INSTRUCTIONS\n");
      await expect(readFile(installedSkill, "utf8")).resolves.toContain("# LIBRARY CHANGED");
    });

    it("rejects a stale Preview without writing over the changed Agent", async () => {
      const environment = await createEnvironment(fixture);
      await fixture.setupNativeState(environment.paths.homeDir, environment.targetPaths);
      await importSkill(environment, "alpha");
      await saveProfile(environment, fixture, "alpha");
      const preview = await environment.service.previewProfile(
        `${fixture.targetId}-alpha`,
        fixture.targetId
      );
      await writeFile(
        environment.targetPaths.instructionsPath,
        "# CHANGED AFTER PREVIEW\n",
        "utf8"
      );
      const afterExternalChange = await snapshotFilesystemTree(environment.paths.homeDir);

      await expect(
        environment.service.applyProfile(`${fixture.targetId}-alpha`, preview.id)
      ).resolves.toMatchObject({ ok: false, kind: "stale" });
      expect(await snapshotFilesystemTree(environment.paths.homeDir))
        .toEqual(afterExternalChange);
      expect(await environment.service.listTargetStates()).toEqual([]);
    });

    it("restores the complete Agent tree when a late adapter mutation fails", async () => {
      const environment = await createEnvironment(fixture, (adapter) => ({
        ...adapter,
        applyAssets: async (input) => {
          await adapter.applyAssets(input);
          throw new Error("Injected post-asset failure");
        }
      }));
      await fixture.setupNativeState(environment.paths.homeDir, environment.targetPaths);
      await importSkill(environment, "alpha");
      await saveProfile(environment, fixture, "alpha");
      const before = await snapshotFilesystemTree(environment.paths.homeDir);
      const preview = await environment.service.previewProfile(
        `${fixture.targetId}-alpha`,
        fixture.targetId
      );
      expect(blockingMessages(preview.issues)).toEqual([]);

      const result = await environment.service.applyProfile(
        `${fixture.targetId}-alpha`,
        preview.id
      );
      expect(result).toMatchObject({ ok: false });
      if (result.ok) throw new Error("Expected injected Apply failure");
      expect(result.errors.join("\n")).toContain("restored backup");
      expect(await snapshotFilesystemTree(environment.paths.homeDir)).toEqual(before);
      expect(await environment.service.listTargetStates()).toEqual([]);
    });
  }
);
