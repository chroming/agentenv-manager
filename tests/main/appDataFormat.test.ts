import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_DATA_MANIFEST_NAME,
  ensureAppDataFormat,
  readAppDataManifest
} from "../../src/main/appDataFormat";
import { createPaths } from "../../src/main/paths";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("AgentEnv data format", () => {
  it("registers an existing unversioned data directory without rewriting its data", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-format-"));
    const paths = createPaths({ appDataRoot: root });
    await writeFile(join(root, "existing.txt"), "keep\n");

    await expect(ensureAppDataFormat(paths)).resolves.toEqual({ formatVersion: 1 });

    await expect(readFile(join(root, "existing.txt"), "utf8")).resolves.toBe("keep\n");
    await expect(readAppDataManifest(root)).resolves.toEqual({ formatVersion: 1 });
  });

  it("fails closed for a future data format", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-format-"));
    await writeFile(
      join(root, APP_DATA_MANIFEST_NAME),
      '{"formatVersion":2}\n'
    );

    await expect(readAppDataManifest(root)).rejects.toThrow(
      "unsupported or invalid"
    );
  });
});
