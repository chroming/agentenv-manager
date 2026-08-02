import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createMutationCoordinator } from "../../src/main/mutationCoordinator";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const lockPathForTest = (appDataRoot: string) => {
  const canonicalRoot = resolve(appDataRoot);
  const rootHash = createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 16);
  return join(dirname(canonicalRoot), ".agentenv-manager-locks", `${rootHash}.lock`);
};

describe("mutation coordinator", () => {
  it("queues mutations from one application process", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mutation-lock-"));
    const coordinator = createMutationCoordinator(join(root, "data"));
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const order: string[] = [];
    const first = coordinator.runExclusive("First", async () => {
      order.push("first-start");
      markFirstStarted();
      await blocker;
      order.push("first-end");
    });
    await firstStarted;
    const second = coordinator.runExclusive("Second", async () => {
      order.push("second");
    });

    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("allows only one writer across coordinators", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mutation-lock-"));
    const dataRoot = join(root, "data");
    const first = createMutationCoordinator(dataRoot, {
      processId: 101,
      isProcessAlive: () => true
    });
    const second = createMutationCoordinator(dataRoot, {
      processId: 202,
      isProcessAlive: () => true
    });
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstOperation = first.runExclusive("Apply profile", async () => {
      markFirstStarted();
      await blocker;
    });
    await firstStarted;

    await expect(second.runExclusive("Update Skill", async () => undefined)).rejects.toThrow(
      "Apply profile"
    );
    releaseFirst();
    await firstOperation;
    await expect(second.runExclusive("Update Skill", async () => "done")).resolves.toBe("done");
  });

  it("recovers a stale lock owned by a dead process", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mutation-lock-"));
    const dataRoot = join(root, "data");
    const lockPath = lockPathForTest(dataRoot);
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      token: "stale",
      pid: 404,
      operation: "Old operation",
      startedAt: "2026-01-01T00:00:00.000Z",
      dataRoot: resolve(dataRoot)
    }));
    const coordinator = createMutationCoordinator(dataRoot, {
      processId: 303,
      isProcessAlive: () => false
    });

    await expect(coordinator.runExclusive("New operation", async () => "done")).resolves.toBe(
      "done"
    );
  });

  it("does not remove a fresh lock while another process may still be writing its owner", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mutation-lock-"));
    const dataRoot = join(root, "data");
    const lockPath = lockPathForTest(dataRoot);
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "");
    const coordinator = createMutationCoordinator(dataRoot);

    await expect(
      coordinator.runExclusive("New operation", async () => "done")
    ).rejects.toThrow("acquiring the data lock");
  });

  it("recovers an old incomplete lock", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-mutation-lock-"));
    const dataRoot = join(root, "data");
    const lockPath = lockPathForTest(dataRoot);
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, "");
    const old = new Date(Date.now() - 10_000);
    await utimes(lockPath, old, old);
    const coordinator = createMutationCoordinator(dataRoot);

    await expect(
      coordinator.runExclusive("New operation", async () => "done")
    ).resolves.toBe("done");
  });
});
