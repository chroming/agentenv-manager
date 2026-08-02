import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSkillPolicyStore } from "../../src/main/skillPolicyStore";
import type { SkillRuntimeSnapshot, TargetPaths } from "../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const makeStore = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-skill-policy-v2-"));
  const paths = createPaths({
    appDataRoot: join(root, "data"),
    homeDir: join(root, "home")
  });
  await mkdir(paths.appDataRoot, { recursive: true });
  return { paths, store: createSkillPolicyStore(paths) };
};

describe("skill policy store", () => {
  it("persists exact Target and collection ownership boundaries independently", async () => {
    const { paths, store } = await makeStore();
    const targetPath = join(paths.homeDir, ".codex", "skills", "review");
    const collectionPath = join(paths.homeDir, ".agents", "skills", "superpowers");

    const created = await store.setUnmanagedLocations({
      items: [
        { path: targetPath, targetId: "codex" },
        { path: collectionPath, coverage: "collection" }
      ],
      unmanaged: true
    });

    expect(created).toEqual([
      expect.objectContaining({
        path: collectionPath,
        coverage: "collection"
      }),
      expect.objectContaining({
        path: targetPath,
        coverage: "exact",
        targetId: "codex"
      })
    ]);
    expect(
      store.findUnmanagedLocation(created, {
        path: targetPath,
        targetId: "codex"
      })
    ).toEqual(created[1]);
    expect(
      store.findUnmanagedLocation(created, {
        path: targetPath,
        targetId: "opencode"
      })
    ).toBeUndefined();
    const persistedBefore = await stat(paths.unmanagedSkillLocationsPath);
    await store.setUnmanagedLocations({
      items: [
        { path: targetPath, targetId: "codex" },
        { path: collectionPath, coverage: "collection" }
      ],
      unmanaged: true
    });
    expect((await stat(paths.unmanagedSkillLocationsPath)).ino).toBe(
      persistedBefore.ino
    );

    await store.setUnmanagedLocations({
      items: [{ path: targetPath, targetId: "codex" }],
      unmanaged: false
    });
    await expect(store.readUnmanagedLocations()).resolves.toEqual([
      expect.objectContaining({ path: collectionPath })
    ]);
  });

  it("stores collection version decisions outside ownership policies", async () => {
    const { paths, store } = await makeStore();
    const memberPath = join(
      paths.homeDir,
      ".agents",
      "skills",
      "superpowers",
      "review"
    );

    await store.setCollectionDecision({
      path: memberPath,
      useLibrary: true,
      sourceContentHash: "source-hash"
    });

    await expect(store.readCollectionDecisions()).resolves.toEqual([
      expect.objectContaining({
        path: memberPath,
        decision: "use-library",
        sourceContentHash: "source-hash"
      })
    ]);
    await expect(store.readUnmanagedLocations()).resolves.toEqual([]);
    const persistedBefore = await stat(paths.skillCollectionDecisionsPath);
    await store.setCollectionDecision({
      path: memberPath,
      useLibrary: true,
      sourceContentHash: "source-hash"
    });
    expect((await stat(paths.skillCollectionDecisionsPath)).ino).toBe(
      persistedBefore.ino
    );
  });

  it("creates a collection version decision when no source hash is available", async () => {
    const { paths, store } = await makeStore();
    const memberPath = join(
      paths.homeDir,
      ".agents",
      "skills",
      "superpowers",
      "review"
    );

    await store.setCollectionDecision({
      path: memberPath,
      useLibrary: true
    });

    await expect(store.readCollectionDecisions()).resolves.toEqual([
      expect.objectContaining({
        path: memberPath,
        decision: "use-library"
      })
    ]);
  });

  it("migrates every legacy policy before archiving its source", async () => {
    const { paths, store } = await makeStore();
    const targetPath = join(paths.homeDir, ".codex", "skills", "review");
    const collectionPath = join(paths.homeDir, ".agents", "skills", "superpowers");
    const memberPath = join(collectionPath, "review");
    const legacyPath = join(paths.appDataRoot, "skill-path-policies.json");
    await writeFile(legacyPath, JSON.stringify([
      {
        id: "target-review",
        path: targetPath,
        skillKey: "review",
        targetId: "codex",
        mode: "keep-outside",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      },
      {
        id: "collection-retention",
        path: collectionPath,
        skillKey: "_collection",
        mode: "keep-shared",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z"
      },
      {
        id: "collection-member",
        path: memberPath,
        skillKey: "review",
        mode: "use-library",
        createdAt: "2026-07-03T00:00:00.000Z",
        updatedAt: "2026-07-03T00:00:00.000Z"
      }
    ]));

    await store.migrateLegacy([]);

    await expect(store.readUnmanagedLocations()).resolves.toEqual([
      expect.objectContaining({
        path: collectionPath,
        coverage: "collection"
      }),
      expect.objectContaining({
        path: targetPath,
        coverage: "exact",
        targetId: "codex"
      })
    ]);
    await expect(store.readCollectionDecisions()).resolves.toEqual([
      expect.objectContaining({
        path: memberPath,
        decision: "use-library"
      })
    ]);
    const files = await readdir(paths.appDataRoot);
    expect(files).toContain("unmanaged-skill-locations.json");
    expect(files).toContain("skill-collection-decisions.json");
    expect(files.some((name) =>
      name.startsWith("skill-path-policies.json.migrated-")
    )).toBe(true);
    await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("migrates legacy ignore rules only after runtime paths are known", async () => {
    const { paths, store } = await makeStore();
    const legacyPath = join(
      paths.appDataRoot,
      "skill-cleanup-ignore-rules.json"
    );
    const skillPath = join(paths.homeDir, ".opencode", "skills", "review");
    await writeFile(legacyPath, JSON.stringify([{
      id: "legacy-review",
      scope: "location",
      path: skillPath,
      reason: "keep-outside",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    }]));
    const target = {
      targetId: "opencode",
      configDir: join(paths.homeDir, ".opencode"),
      instructionsPath: join(paths.homeDir, ".opencode", "AGENTS.md"),
      configPath: join(paths.homeDir, ".opencode", "config.json"),
      skillsDir: join(paths.homeDir, ".opencode", "skills")
    } satisfies TargetPaths;
    const snapshot = {
      targetId: "opencode",
      issues: [],
      observations: [{
        targetId: "opencode",
        locationPath: target.skillsDir,
        path: skillPath,
        runtimeName: "review",
        deploymentName: "review",
        scope: "user",
        owner: "user",
        availability: "enabled",
        confidence: "verified",
        locationRole: "preferred-runtime",
        shared: false,
        legacy: false,
        issues: []
      }]
    } satisfies SkillRuntimeSnapshot;

    await store.migrateLegacy([{ target, snapshot }]);

    await expect(store.readUnmanagedLocations()).resolves.toEqual([
      expect.objectContaining({
        path: skillPath,
        targetId: "opencode",
        coverage: "exact"
      })
    ]);
    await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("retains unresolved legacy ignore rules until a concrete path is scanned", async () => {
    const { paths, store } = await makeStore();
    const legacyPath = join(
      paths.appDataRoot,
      "skill-cleanup-ignore-rules.json"
    );
    const legacyRules = [{
      id: "legacy-review",
      scope: "group",
      skillKey: "review",
      reason: "keep-outside",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    }];
    await writeFile(legacyPath, JSON.stringify(legacyRules));

    await store.migrateLegacy([]);

    await expect(store.readUnmanagedLocations()).resolves.toEqual([]);
    await expect(readFile(legacyPath, "utf8")).resolves.toBe(
      JSON.stringify(legacyRules)
    );
    const locationsBefore = await stat(paths.unmanagedSkillLocationsPath);
    const decisionsBefore = await stat(paths.skillCollectionDecisionsPath);

    await store.migrateLegacy([]);

    expect((await stat(paths.unmanagedSkillLocationsPath)).ino).toBe(
      locationsBefore.ino
    );
    expect((await stat(paths.skillCollectionDecisionsPath)).ino).toBe(
      decisionsBefore.ino
    );
  });
});
