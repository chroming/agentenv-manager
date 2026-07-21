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
});
