import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createActivationService,
  type ActivationFailurePhase
} from "../../src/main/activationService";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import {
  assertFilesystemSnapshotEqual,
  snapshotFilesystemTree
} from "../helpers/filesystemSnapshot";

const phases: readonly ActivationFailurePhase[] = [
  "after-backup",
  "after-recovery-marker",
  "after-file-changes",
  "after-assets",
  "before-final-state",
  "after-final-state"
];

let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

const createEnvironment = async (failurePhase?: ActivationFailurePhase) => {
  const root = await mkdtemp(join(tmpdir(), "agentenv-activation-failure-"));
  roots.push(root);
  const paths = createPaths({
    appDataRoot: join(root, "data"),
    homeDir: join(root, "home")
  });
  const sourceDir = join(root, "sources", "review");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    join(sourceDir, "SKILL.md"),
    "---\nname: review\ndescription: Review changes.\n---\n# Review\n"
  );
  await mkdir(paths.codexHome, { recursive: true });
  await writeFile(paths.globalAgentsPath, "# Original instructions\n");
  await writeFile(
    paths.codexConfigPath,
    'model = "gpt-5"\n\n[mcp_servers.docs]\ncommand = "docs"\nenabled = false\n'
  );
  const profileStore = createProfileStore(paths);
  const settingsStore = createSettingsStore(paths);
  await settingsStore.updateSettings({ enabledTargetIds: ["codex"] });
  const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
  await skillLibraryStore.importSkill({ sourcePath: sourceDir, id: "review" });
  await profileStore.saveProfile({
    manifest: {
      id: "failure-matrix",
      name: "Failure matrix",
      description: "Exercises transactional Apply recovery.",
      preferredTargetId: "codex",
      version: 2
    },
    instructions: "# Proposed instructions\n",
    resources: {
      skills: [{ libraryId: "review", targetName: "review", enabled: true }],
      managementByTarget: {
        codex: { instructions: "manage", skills: "manage" }
      },
      mcpByTarget: {
        codex: {
          mode: "manage",
          selections: [{ name: "docs", enabled: true }]
        }
      }
    }
  });
  const service = createActivationService({
    paths,
    profileStore,
    settingsStore,
    skillLibraryStore,
    failureInjector: failurePhase
      ? (phase) => {
          if (phase === failurePhase) throw new Error(`Injected failure at ${phase}`);
        }
      : undefined
  });
  return { root, paths, sourceDir, service };
};

describe.each(phases)("Activation failure at %s", (phase) => {
  it("restores every Agent path and preserves the canonical source", async () => {
    const environment = await createEnvironment(phase);
    const homeBefore = await snapshotFilesystemTree(environment.paths.homeDir);
    const sourceBefore = await snapshotFilesystemTree(environment.sourceDir);
    const preview = await environment.service.previewProfile("failure-matrix", "codex");
    expect(preview.issues.filter((issue) => issue.disposition === "block")).toEqual([]);

    const result = await environment.service.applyProfile("failure-matrix", preview.id);

    expect(result).toMatchObject({ ok: false, kind: "failed" });
    assertFilesystemSnapshotEqual(
      homeBefore,
      await snapshotFilesystemTree(environment.paths.homeDir),
      `Agent home after ${phase}`
    );
    assertFilesystemSnapshotEqual(
      sourceBefore,
      await snapshotFilesystemTree(environment.sourceDir),
      `canonical source after ${phase}`
    );
    await expect(readFile(environment.paths.globalAgentsPath, "utf8"))
      .resolves.toBe("# Original instructions\n");
    await expect(environment.service.listTargetStates()).resolves.toEqual([]);
  });
});

describe("Activation no-op safety", () => {
  it("does not write Agent files or invoke mutation phases while previewing an applied Profile", async () => {
    const environment = await createEnvironment();
    const firstPreview = await environment.service.previewProfile("failure-matrix", "codex");
    expect((await environment.service.applyProfile("failure-matrix", firstPreview.id)).ok)
      .toBe(true);
    const before = await snapshotFilesystemTree(environment.paths.homeDir, {
      includeTimestamps: true
    });

    const noOp = await environment.service.previewProfile("failure-matrix", "codex");

    expect(noOp.changes).toEqual([]);
    expect(noOp.resourceChanges).toEqual([]);
    assertFilesystemSnapshotEqual(
      before,
      await snapshotFilesystemTree(environment.paths.homeDir, {
        includeTimestamps: true
      }),
      "Agent home after no-op preview"
    );
  });
});
