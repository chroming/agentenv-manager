import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSkillPathPolicyStore } from "../../src/main/skillPathPolicyStore";
import type { SkillRuntimeSnapshot, TargetPaths } from "../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const makeStore = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-skill-policy-"));
  const paths = createPaths({
    appDataRoot: join(root, "data"),
    homeDir: join(root, "home")
  });
  await mkdir(paths.appDataRoot, { recursive: true });
  return { paths, store: createSkillPathPolicyStore(paths) };
};

describe("skill path policy store", () => {
  it("persists canonical policies and removes them with the same input", async () => {
    const { paths, store } = await makeStore();
    const skillPath = join(paths.homeDir, ".codex", "skills", "..", "skills", "review");

    const created = await store.set({
      items: [{ path: skillPath, skillKey: " Review ", targetId: "codex" }],
      mode: "keep-outside"
    });

    expect(created).toEqual([
      expect.objectContaining({
        path: join(paths.homeDir, ".codex", "skills", "review"),
        skillKey: "review",
        targetId: "codex",
        mode: "keep-outside"
      })
    ]);
    await expect(store.find(created, {
      path: skillPath,
      skillKey: "review",
      targetId: "codex"
    })).toEqual(created[0]);

    await expect(store.set({
      items: [{ path: skillPath, skillKey: "review", targetId: "codex" }]
    })).resolves.toEqual([]);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("migrates legacy location rules once and archives the source file", async () => {
    const { paths, store } = await makeStore();
    const legacyPath = join(paths.appDataRoot, "skill-cleanup-ignore-rules.json");
    const skillPath = join(paths.homeDir, ".opencode", "skills", "review");
    await writeFile(legacyPath, JSON.stringify([{
      id: "legacy-review",
      scope: "location",
      path: skillPath,
      reason: "keep-shared",
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

    const migrated = await store.migrateLegacy([{ target, snapshot }]);

    expect(migrated).toEqual([
      expect.objectContaining({
        path: skillPath,
        skillKey: "review",
        targetId: "opencode",
        mode: "keep-shared",
        createdAt: "2026-07-01T00:00:00.000Z"
      })
    ]);
    const files = await readdir(paths.appDataRoot);
    expect(files).toContain("skill-path-policies.json");
    expect(files.some((name) =>
      name.startsWith("skill-cleanup-ignore-rules.json.migrated-")
    )).toBe(true);
    await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
