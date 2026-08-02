import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const writeScript = resolve(process.cwd(), "scripts", "write-build-fingerprint.mjs");
const assertScript = resolve(process.cwd(), "scripts", "assert-current-build.mjs");
let root = "";

const run = async (script: string) =>
  execFileAsync(process.execPath, [script, root], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  });

const prepareFixture = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-build-fingerprint-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "out", "main"), { recursive: true });
  await writeFile(join(root, "src", "main.ts"), "export const value = 1;\n");
  await writeFile(join(root, "out", "main", "main.js"), "const value = 1;\n");
  for (const file of [
    "electron.vite.config.ts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.node.json"
  ]) {
    await writeFile(join(root, file), `${file}\n`);
  }
  await run(writeScript);
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("Electron build identity", () => {
  it("accepts the exact source and output used for the build", async () => {
    await prepareFixture();

    await expect(run(assertScript)).resolves.toMatchObject({ stderr: "" });
  });

  it("rejects source changes made after the build", async () => {
    await prepareFixture();
    await writeFile(join(root, "src", "main.ts"), "export const value = 2;\n");

    await expect(run(assertScript)).rejects.toMatchObject({
      stderr: expect.stringContaining("Electron build is stale")
    });
  });

  it("rejects output changes made after the build", async () => {
    await prepareFixture();
    await writeFile(join(root, "out", "main", "main.js"), "const value = 2;\n");

    await expect(run(assertScript)).rejects.toMatchObject({
      stderr: expect.stringContaining("does not match out/")
    });
  });
});
