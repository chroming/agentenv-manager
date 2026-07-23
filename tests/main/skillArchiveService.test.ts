import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSkillArchiveService } from "../../src/main/skillArchiveService";
import { createPaths } from "../../src/main/paths";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createStoredZip } from "../helpers/createStoredZip";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("skill archive service", () => {
  it("extracts a ZIP into an isolated temporary source and removes it on release", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-archive-test-"));
    const archivePath = join(root, "skills.zip");
    await writeFile(archivePath, createStoredZip([
      {
        path: "review/SKILL.md",
        content: "---\nname: Review\n---\n# Review\n"
      },
      {
        path: "review/references/checklist.md",
        content: "# Checklist\n"
      }
    ]));
    const service = createSkillArchiveService();

    const source = await service.prepare(archivePath);

    expect(source).toMatchObject({ kind: "archive", path: archivePath });
    await expect(readFile(join(source.rootPath, "review", "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir: join(root, "home")
    });
    await mkdir(paths.appDataRoot, { recursive: true });
    const store = createSkillLibraryStore(paths);
    await store.importSkill({
      sourcePath: join(source.rootPath, "review"),
      id: "review",
      upstream: { kind: "local", locator: archivePath, subpath: "review" }
    });
    const metadata = JSON.parse(
      await readFile(join(paths.skillsLibraryDir, "review", ".agentenv-skill.json"), "utf8")
    ) as { source?: string; upstream?: { locator?: string; subpath?: string } };
    expect(metadata).toMatchObject({
      source: archivePath,
      upstream: { locator: archivePath, subpath: "review" }
    });
    await service.release(source.archiveToken!);
    await expect(readFile(join(source.rootPath, "review", "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects path traversal and symbolic-link entries before extraction", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-archive-test-"));
    const traversalPath = join(root, "traversal.zip");
    const symlinkPath = join(root, "symlink.zip");
    await writeFile(traversalPath, createStoredZip([
      { path: "../outside/SKILL.md", content: "# Outside\n" }
    ]));
    await writeFile(symlinkPath, createStoredZip([
      { path: "review/SKILL.md", content: "../../outside", mode: 0o120777 }
    ]));
    const service = createSkillArchiveService();

    await expect(service.prepare(traversalPath)).rejects.toThrow("unsafe path");
    await expect(service.prepare(symlinkPath)).rejects.toThrow("symbolic links are not allowed");
  });
});
