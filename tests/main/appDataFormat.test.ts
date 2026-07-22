import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AppDataFormatError,
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
  it("registers an empty data directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-format-"));
    const paths = createPaths({ appDataRoot: root });

    await expect(ensureAppDataFormat(paths)).resolves.toEqual({ formatVersion: 2 });
    await expect(readAppDataManifest(root)).resolves.toEqual({ formatVersion: 2 });
  });

  it("requires migration before registering a non-empty unversioned directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-format-"));
    const paths = createPaths({ appDataRoot: root });
    await writeFile(join(root, "existing.txt"), "keep\n");

    await expect(ensureAppDataFormat(paths)).rejects.toThrow("startup migration");

    await expect(readFile(join(root, "existing.txt"), "utf8")).resolves.toBe("keep\n");
    await expect(readAppDataManifest(root)).resolves.toBeUndefined();
  });

  it("fails closed for a future data format", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-format-"));
    await writeFile(
      join(root, APP_DATA_MANIFEST_NAME),
      '{"formatVersion":3}\n'
    );

    const error = await readAppDataManifest(root).catch((caught) => caught);
    expect(error).toBeInstanceOf(AppDataFormatError);
    expect(error).toMatchObject({ kind: "newer" });
    expect((error as Error).message).toContain("newer than supported");
  });
});
