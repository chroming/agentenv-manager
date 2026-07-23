import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillFileBrowser } from "../../src/main/skillFileBrowser";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("skill file browser", () => {
  it("lists only regular Library files and reads contained text files", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-files-"));
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir: join(root, "home")
    });
    const skillRoot = join(paths.skillsLibraryDir, "review");
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "# Review\n");
    await writeFile(join(skillRoot, ".agentenv-skill.json"), "{}");
    await writeFile(join(skillRoot, "references", "checklist.md"), "# Checklist\n");
    await writeFile(join(root, "outside.md"), "# Outside\n");
    await symlink(join(root, "outside.md"), join(skillRoot, "outside.md"));
    const browser = createSkillFileBrowser(paths, createSettingsStore(paths));

    await expect(browser.list("review")).resolves.toEqual([
      {
        kind: "directory",
        name: "references",
        path: "references",
        children: [{
          kind: "file",
          name: "checklist.md",
          path: "references/checklist.md",
          sizeBytes: 12
        }]
      },
      {
        kind: "file",
        name: "SKILL.md",
        path: "SKILL.md",
        sizeBytes: 9
      }
    ]);
    await expect(browser.read("review", "SKILL.md")).resolves.toEqual({
      path: "SKILL.md",
      kind: "text",
      sizeBytes: 9,
      content: "# Review\n"
    });
  });

  it("rejects escaped paths and does not decode binary or oversized files", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-files-"));
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir: join(root, "home")
    });
    const skillRoot = join(paths.skillsLibraryDir, "review");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "# Review\n");
    await writeFile(join(skillRoot, "binary.bin"), Buffer.from([0, 1, 2]));
    await writeFile(join(skillRoot, "large.txt"), Buffer.alloc(1024 * 1024 + 1, 65));
    const browser = createSkillFileBrowser(paths, createSettingsStore(paths));

    await expect(browser.read("review", "../outside.md")).rejects.toThrow("escapes");
    await expect(browser.read("review", "binary.bin")).resolves.toMatchObject({
      kind: "binary",
      sizeBytes: 3
    });
    await expect(browser.read("review", "large.txt")).resolves.toMatchObject({
      kind: "too-large",
      sizeBytes: 1024 * 1024 + 1
    });
  });
});
