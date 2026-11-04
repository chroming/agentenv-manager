import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { removePhysicalPath } from "../../src/main/physicalFileRemoval";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

it("removes physical archive entries without following links outside the selected folder", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-physical-removal-"));
  const selected = join(root, "selected"), outside = join(root, "outside");
  await mkdir(selected); await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "untouched");
  await writeFile(join(selected, "app.asar"), "a physical archive entry");
  await mkdir(join(selected, "literal-directory.asar"));
  await writeFile(join(selected, "literal-directory.asar", "file.txt"), "a real directory");
  await symlink(outside, join(selected, "outside"), process.platform === "win32" ? "junction" : "dir");
  await removePhysicalPath(selected, { recursive: true, force: true });
  await expect(lstat(selected)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("untouched");
});

it("preserves rm error and missing-entry semantics", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-physical-removal-"));
  const missing = join(root, "missing");
  await expect(removePhysicalPath(missing)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(removePhysicalPath(missing, { force: true })).resolves.toBeUndefined();
  await mkdir(join(root, "kept"));
  await expect(removePhysicalPath(join(root, "kept"))).rejects.toThrow();
  expect((await lstat(join(root, "kept"))).isDirectory()).toBe(true);
});
