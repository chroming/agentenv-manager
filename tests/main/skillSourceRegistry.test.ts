import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createSkillSourceRegistry } from "../../src/main/skillSourceRegistry";
import type { SkillSourceScope } from "../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const scope = (directory: string): SkillSourceScope => ({
  formatVersion: 1,
  canonicalLink: `https://github.com/acme/skills/tree/main/${directory}`,
  repository: "https://github.com/acme/skills.git",
  ref: "main",
  directory
});

describe("Skill source registry", () => {
  it("serializes concurrent legacy source migrations without losing records", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-source-registry-"));
    const registry = createSkillSourceRegistry(join(root, "skill-sources.json"));
    const scopes = Array.from({ length: 20 }, (_, index) => scope(`skills/${index}`));

    const results = await Promise.all(scopes.map((item) => registry.ensure([item])));

    expect(await registry.list()).toHaveLength(scopes.length);
    expect(new Set(results.flat().map((record) => record.id)).size).toBe(scopes.length);
  });

  it("persists a local display name without changing source identity", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-source-registry-"));
    const registry = createSkillSourceRegistry(join(root, "skill-sources.json"));
    const [created] = await registry.ensure([scope("skills/engineering")]);

    const renamed = await registry.setDisplayName(created!.id, "Engineering Skills");

    expect(renamed).toMatchObject({
      id: created!.id,
      displayName: "Engineering Skills",
      canonicalLink: created!.canonicalLink
    });
    expect((await registry.list())[0]?.displayName).toBe("Engineering Skills");

    await registry.setDisplayName(created!.id, "   ");
    expect((await registry.list())[0]?.displayName).toBeUndefined();
  });

  it("defaults repository checks on and local folder checks off", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-source-registry-"));
    const registry = createSkillSourceRegistry(join(root, "skill-sources.json"));
    const [repository] = await registry.ensure([scope("skills")]);
    const [local] = await registry.ensure([{
      formatVersion: 1,
      kind: "local",
      canonicalLink: "file:///tmp/local-skills",
      repository: "/tmp/local-skills",
      ref: "",
      directory: ""
    }]);

    expect(repository?.automaticChecks).toBe(true);
    expect(local?.automaticChecks).toBe(false);
    await registry.setAutomaticChecks(local!.id, true);
    expect((await registry.list()).find((record) => record.id === local!.id)?.automaticChecks)
      .toBe(true);
  });

  it("keeps an indexed suite distinct from a full-directory source", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-source-registry-"));
    const registry = createSkillSourceRegistry(join(root, "skill-sources.json"));
    const fullDirectory = scope("");
    const indexedSuite: SkillSourceScope = {
      ...fullDirectory,
      canonicalLink: "https://github.com/acme/skills/tree/main/suite",
      indexManifestPath: "suite/llms.txt"
    };

    const [fullRecord] = await registry.ensure([fullDirectory]);
    const [indexedRecord] = await registry.ensure([indexedSuite]);

    expect(indexedRecord?.id).not.toBe(fullRecord?.id);
    const records = await registry.list();
    expect(records.find((record) => record.id === fullRecord?.id))
      .not.toHaveProperty("indexManifestPath");
    expect(records.find((record) => record.id === indexedRecord?.id))
      .toMatchObject({ indexManifestPath: "suite/llms.txt" });
  });

  it("stores ignored candidates by source-relative path", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-source-registry-"));
    const registry = createSkillSourceRegistry(join(root, "skill-sources.json"));
    const [created] = await registry.ensure([scope("skills")]);

    await registry.setIgnoredSubpath(created!.id, "wip/experimental", true);
    await registry.setIgnoredSubpath(created!.id, "wip/experimental", true);

    expect((await registry.list())[0]?.ignoredSubpaths).toEqual([
      "wip/experimental"
    ]);

    await registry.setIgnoredSubpath(created!.id, "wip/experimental", false);
    expect((await registry.list())[0]?.ignoredSubpaths).toBeUndefined();
    await expect(
      registry.setIgnoredSubpath(created!.id, "../outside", true)
    ).rejects.toThrow("Skill source path is invalid");
  });
});
