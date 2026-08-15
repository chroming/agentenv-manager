import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSkillChangeSet,
  readSkillFileChange
} from "../../src/main/skillFileChanges";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("skill file changes", () => {
  it("returns lightweight summaries for a large update and loads one file on demand", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-changes-"));
    const current = join(root, "current");
    const next = join(root, "next");
    await Promise.all([mkdir(current), mkdir(next)]);
    await Promise.all(Array.from({ length: 21 }, async (_, index) => {
      const name = index === 0 ? "SKILL.md" : `file-${index}.md`;
      await Promise.all([
        writeFile(join(current, name), `old ${index}\n`),
        writeFile(join(next, name), `new ${index}\n`)
      ]);
    }));

    const result = await createSkillChangeSet(current, next, { deferLargeContent: true });

    expect(result.changes).toHaveLength(21);
    expect(result.changes.every((change) => change.contentDeferred)).toBe(true);
    expect(result.changes[0]).toMatchObject({
      path: "SKILL.md",
      before: "",
      after: "",
      diff: ""
    });
    await expect(readSkillFileChange(current, next, "SKILL.md")).resolves.toMatchObject({
      contentDeferred: undefined,
      before: "old 0\n",
      after: "new 0\n",
      diff: expect.stringContaining("+new 0")
    });
  });

  it("rejects preview paths outside either Skill tree", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-changes-safe-"));
    const current = join(root, "current");
    const next = join(root, "next");
    await Promise.all([mkdir(current), mkdir(next)]);

    await expect(readSkillFileChange(current, next, "../secret"))
      .rejects.toThrow("Invalid Skill update file path");
  });
});
