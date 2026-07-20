import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureReceiptStore } from "../../src/main/captureReceiptStore";
import { createPaths } from "../../src/main/paths";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Capture receipt store", () => {
  it("persists machine-local evidence outside portable app data and consumes it", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-receipt-"));
    const paths = createPaths({ appDataRoot: join(root, "data") });
    const store = createCaptureReceiptStore(paths);
    const receipt = {
      formatVersion: 1 as const,
      profileId: "daily",
      targetId: "codex",
      createdAt: "2026-07-20T00:00:00.000Z",
      skills: [{
        libraryId: "reviewer",
        targetName: "reviewer",
        copies: [{ path: "/home/.codex/skills/reviewer", contentHash: "hash" }]
      }]
    };

    await store.write(receipt);
    await expect(store.read("daily", "codex")).resolves.toEqual(receipt);
    expect(paths.captureReceiptsDir.startsWith(paths.appDataRoot)).toBe(false);

    await store.remove("daily", "codex");
    await expect(store.read("daily", "codex")).resolves.toBeUndefined();
  });

  it("ignores malformed cache evidence instead of blocking a Profile", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-receipt-"));
    const paths = createPaths({ appDataRoot: join(root, "data") });
    const store = createCaptureReceiptStore(paths);
    await store.write({
      formatVersion: 1,
      profileId: "daily",
      targetId: "codex",
      createdAt: "2026-07-20T00:00:00.000Z",
      skills: []
    });
    const path = join(paths.captureReceiptsDir, "daily--codex.json");
    await writeFile(path, "{ invalid", "utf8");

    await expect(store.read("daily", "codex")).resolves.toBeUndefined();
  });

  it("does not reuse valid evidence stored under another Profile identity", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-capture-receipt-"));
    const paths = createPaths({ appDataRoot: join(root, "data") });
    const store = createCaptureReceiptStore(paths);
    await store.write({
      formatVersion: 1,
      profileId: "daily",
      targetId: "codex",
      createdAt: "2026-07-20T00:00:00.000Z",
      skills: []
    });
    await writeFile(
      join(paths.captureReceiptsDir, "daily--codex.json"),
      JSON.stringify({
        formatVersion: 1,
        profileId: "other",
        targetId: "codex",
        createdAt: "2026-07-20T00:00:00.000Z",
        skills: []
      }),
      "utf8"
    );

    await expect(store.read("daily", "codex")).resolves.toBeUndefined();
  });
});
