import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashComparableResource } from "../../src/main/resourceHash";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("comparable resource hashing", () => {
  it("matches copied and symlinked resource content", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-resource-hash-"));
    const source = join(root, "source");
    const copied = join(root, "copied");
    const linked = join(root, "linked");
    await Promise.all([mkdir(source), mkdir(copied), mkdir(linked)]);
    await writeFile(join(source, "SKILL.md"), "# Shared\n", "utf8");
    await writeFile(join(copied, "SKILL.md"), "# Shared\n", "utf8");
    await symlink(join(source, "SKILL.md"), join(linked, "SKILL.md"), "file");

    const sourceHash = await hashComparableResource(source);
    await expect(hashComparableResource(copied)).resolves.toBe(sourceHash);
    await expect(hashComparableResource(linked)).resolves.toBe(sourceHash);
  });

  it("rejects symbolic link cycles with a focused error", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-resource-cycle-"));
    const resource = join(root, "resource");
    await mkdir(resource);
    await writeFile(join(resource, "SKILL.md"), "# Cycle\n", "utf8");
    await symlink(resource, join(resource, "again"), "dir");

    await expect(hashComparableResource(resource)).rejects.toThrow(
      "Resource contains a symbolic link cycle"
    );
  });
});
