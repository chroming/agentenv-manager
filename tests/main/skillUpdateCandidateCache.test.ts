import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashSkillContent } from "../../src/main/skillContentHash";
import { createSkillUpdateCandidateCache } from "../../src/main/skillUpdateCandidateCache";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("skill update candidate cache", () => {
  it("restores immutable content without storing the raw source key", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-update-cache-"));
    const cacheRoot = join(root, "cache");
    const source = join(root, "source");
    const destination = join(root, "destination");
    await Promise.all([mkdir(source), mkdir(destination)]);
    await writeFile(join(source, "SKILL.md"), "---\nname: review\n---\n# Review\n");
    const contentHash = await hashSkillContent(source);
    const sourceKey = "https://git.example.test/private/repo\0main\0skills/review\0abc";
    const cache = createSkillUpdateCandidateCache({ root: cacheRoot });

    await cache.save(sourceKey, source, contentHash);
    await expect(cache.restore(sourceKey, destination)).resolves.toBe(true);

    await expect(readFile(join(destination, "SKILL.md"), "utf8"))
      .resolves.toContain("name: review");
    const cacheFiles = await import("node:fs/promises").then(({ readdir }) =>
      readdir(cacheRoot, { recursive: true })
    );
    for (const file of cacheFiles) {
      if (typeof file !== "string" || !file.endsWith("candidate.json")) continue;
      const content = await readFile(join(cacheRoot, file), "utf8");
      expect(content).not.toContain("git.example.test");
    }
  });

  it("rejects and removes a corrupted candidate", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-update-cache-corrupt-"));
    const cacheRoot = join(root, "cache");
    const source = join(root, "source");
    const destination = join(root, "destination");
    await Promise.all([mkdir(source), mkdir(destination)]);
    await writeFile(join(source, "SKILL.md"), "---\nname: review\n---\n# Review\n");
    const cache = createSkillUpdateCandidateCache({ root: cacheRoot });
    const contentHash = await hashSkillContent(source);
    await cache.save("immutable-key", source, contentHash);
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(cacheRoot));
    await writeFile(join(cacheRoot, entries[0]!, "content", "SKILL.md"), "corrupt\n");

    await expect(cache.restore("immutable-key", destination)).resolves.toBe(false);
  });
});
