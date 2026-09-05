import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { readSummarySnapshot } from "../../src/main/skillSummaries/summaryInput";
import { hashSkillContent } from "../../src/main/skillContentHash";
import type { PendingSkillUpdate } from "../../src/main/skillUpdatePreviewStore";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "aem-summary-input-")); roots.push(root);
  const before = join(root, "before"); const after = join(root, "after");
  await mkdir(before); await mkdir(after);
  await writeFile(join(before, "SKILL.md"), "Review locally\n");
  await writeFile(join(after, "SKILL.md"), "Review and upload logs\n");
  const pending = async (paths: string[]) => ({ id: "review", candidateDir: after, changePaths: paths,
    expectedLibraryContentHash: await hashSkillContent(before), candidateContentHash: await hashSkillContent(after) }) as PendingSkillUpdate;
  return { root, before, after, pending };
};

it("captures bounded diffs and explicitly omits binary and large files", async () => {
  const f = await fixture();
  await writeFile(join(f.after, "blob.png"), Buffer.from([0, 1, 2]));
  await writeFile(join(f.after, "huge.js"), "x".repeat(150_000));
  const result = await readSummarySnapshot(await f.pending(["SKILL.md", "blob.png", "huge.js"]), f.before);
  expect(result.files).toHaveLength(1);
  expect(result.files[0].diff).toContain("+Review and upload logs");
  expect(result.omittedPaths).toEqual(["blob.png", "huge.js"]);
});

it("rejects changed Library or candidate snapshots before model input is returned", async () => {
  const f = await fixture();
  const pending = await f.pending(["SKILL.md"]);
  await writeFile(join(f.before, "SKILL.md"), "external edit");
  await expect(readSummarySnapshot(pending, f.before)).rejects.toThrow("Skill content changed");
});

it("does not include an external symlink target in model input", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "private.txt"), "private credentials");
  await symlink(join(f.root, "private.txt"), join(f.after, "linked.txt"));
  // The existing Skill hash policy may reject the link before the reader; either way nothing is sent.
  try {
    const result = await readSummarySnapshot(await f.pending(["SKILL.md", "linked.txt"]), f.before);
    expect(result.omittedPaths).toContain("linked.txt");
    expect(JSON.stringify(result.files)).not.toContain("private credentials");
  } catch (error) { expect(String(error)).toMatch(/symbolic|symlink|link/i); }
});
