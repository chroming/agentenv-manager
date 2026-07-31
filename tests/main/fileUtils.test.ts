import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  recoverAtomicReplacement,
  replacePathAtomically,
  syncParentDirectory,
  writeAtomic
} from "../../src/main/fileUtils";
import { hashPathEntry } from "../../src/main/filesystemIntegrity";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("durable file utilities", () => {
  it("creates private parent directories and files by default", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "private", "nested", "state.json");

    await writeAtomic(target, "{}\n");

    if (process.platform !== "win32") {
      expect((await stat(join(root, "private", "nested"))).mode & 0o777).toBe(0o700);
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    }
    await expect(readFile(target, "utf8")).resolves.toBe("{}\n");
  });

  it("atomically replaces an existing file without a replacement journal", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "state.json");
    await writeFile(target, "before\n", "utf8");

    await writeAtomic(target, "after\n");

    await expect(readFile(target, "utf8")).resolves.toBe("after\n");
    await expect(
      readFile(`${target}.agentenv-replace.json`, "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite a file that changed after its reviewed hash", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "state.json");
    await writeFile(target, "reviewed\n", "utf8");
    const expectedTargetHash = await hashPathEntry(target);
    await writeFile(target, "external\n", "utf8");

    await expect(writeAtomic(target, "agentenv\n", {
      expectedTargetHash
    })).rejects.toThrow("changed after it was reviewed");

    await expect(readFile(target, "utf8")).resolves.toBe("external\n");
  });

  it("preserves an existing file's permissions during an atomic write", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "AGENTS.md");
    await writeFile(target, "before\n", "utf8");
    await chmod(target, 0o644);

    await writeAtomic(target, "after\n");

    if (process.platform !== "win32") {
      expect((await stat(target)).mode & 0o777).toBe(0o644);
    }
  });

  it("keeps the original path when preparing a replacement fails", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "skill");
    await mkdir(target);
    await writeFile(join(target, "SKILL.md"), "# Original\n");

    await expect(
      replacePathAtomically(target, async (staging) => {
        await mkdir(staging);
        await writeFile(join(staging, "SKILL.md"), "# Incomplete\n");
        throw new Error("copy failed");
      })
    ).rejects.toThrow("copy failed");

    await expect(readFile(join(target, "SKILL.md"), "utf8")).resolves.toBe("# Original\n");
  });

  it("restores the previous path after an interrupted committed replacement", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "profile");
    const previous = `${target}.agentenv-previous`;
    await mkdir(previous);
    await writeFile(join(previous, "AGENTS.md"), "# Previous\n");
    await writeAtomic(
      `${target}.agentenv-replace.json`,
      `${JSON.stringify({ targetPath: target, hadTarget: true })}\n`
    );

    await recoverAtomicReplacement(target);

    await expect(readFile(join(target, "AGENTS.md"), "utf8")).resolves.toBe("# Previous\n");
    await expect(readFile(`${target}.agentenv-replace.json`, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("preserves both paths when another process recreates a replacement target", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "profile");
    const previous = `${target}.agentenv-previous`;
    const reviewedStaging = join(root, "reviewed-stage");
    await mkdir(target);
    await mkdir(previous);
    await mkdir(reviewedStaging);
    await writeFile(join(target, "AGENTS.md"), "# External\n");
    await writeFile(join(previous, "AGENTS.md"), "# Previous\n");
    await writeFile(join(reviewedStaging, "AGENTS.md"), "# Reviewed\n");
    await writeAtomic(
      `${target}.agentenv-replace.json`,
      `${JSON.stringify({
        formatVersion: 2,
        targetPath: target,
        hadTarget: true,
        phase: "committed",
        stagingHash: await hashPathEntry(reviewedStaging),
        previousHash: await hashPathEntry(previous)
      })}\n`
    );

    await expect(recoverAtomicReplacement(target)).rejects.toThrow(
      "externally changed data"
    );
    await expect(readFile(join(target, "AGENTS.md"), "utf8")).resolves.toBe("# External\n");
    await expect(readFile(join(previous, "AGENTS.md"), "utf8")).resolves.toBe("# Previous\n");
  });

  it("preserves staging evidence that changed before startup recovery", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "profile");
    const staging = `${target}.agentenv-stage`;
    const reviewed = join(root, "reviewed-stage");
    await mkdir(staging);
    await mkdir(reviewed);
    await writeFile(join(staging, "AGENTS.md"), "# External staging edit\n");
    await writeFile(join(reviewed, "AGENTS.md"), "# Reviewed staging\n");
    await writeAtomic(
      `${target}.agentenv-replace.json`,
      `${JSON.stringify({
        formatVersion: 2,
        targetPath: target,
        hadTarget: false,
        phase: "prepared",
        stagingHash: await hashPathEntry(reviewed)
      })}\n`
    );

    await expect(recoverAtomicReplacement(target)).rejects.toThrow(
      "changed during recovery and was preserved"
    );
    await expect(readFile(join(staging, "AGENTS.md"), "utf8"))
      .resolves.toBe("# External staging edit\n");
    await expect(readFile(`${target}.agentenv-replace.json`, "utf8"))
      .resolves.toContain('"phase":"prepared"');
  });

  it("never deletes unclaimed previous data when its journal is missing", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "profile");
    const previous = `${target}.agentenv-previous`;
    await mkdir(target);
    await mkdir(previous);
    await writeFile(join(target, "AGENTS.md"), "# Current\n");
    await writeFile(join(previous, "AGENTS.md"), "# Recoverable original\n");

    await expect(replacePathAtomically(target, async (stagingPath) => {
      await mkdir(stagingPath);
      await writeFile(join(stagingPath, "AGENTS.md"), "# Replacement\n");
    })).rejects.toThrow("preserved for recovery");

    await expect(readFile(join(target, "AGENTS.md"), "utf8"))
      .resolves.toBe("# Current\n");
    await expect(readFile(join(previous, "AGENTS.md"), "utf8"))
      .resolves.toBe("# Recoverable original\n");
  });

  it("refuses to replace a target changed after its safety snapshot", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "profile");
    await mkdir(target);
    await writeFile(join(target, "AGENTS.md"), "# Reviewed\n");
    const expectedTargetHash = await hashPathEntry(target);

    await expect(replacePathAtomically(target, async (stagingPath) => {
      await mkdir(stagingPath);
      await writeFile(join(stagingPath, "AGENTS.md"), "# Replacement\n");
      await writeFile(join(target, "AGENTS.md"), "# External change\n");
    }, { expectedTargetHash })).rejects.toThrow("changed while staging data was prepared");

    await expect(readFile(join(target, "AGENTS.md"), "utf8"))
      .resolves.toBe("# External change\n");
  });

  it("preserves a target created by another process while staging a new path", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "profile");

    await expect(replacePathAtomically(target, async (stagingPath) => {
      await mkdir(stagingPath);
      await writeFile(join(stagingPath, "AGENTS.md"), "# Replacement\n");
      await mkdir(target);
      await writeFile(join(target, "AGENTS.md"), "# External change\n");
    })).rejects.toThrow("changed while staging data was prepared");

    await expect(readFile(join(target, "AGENTS.md"), "utf8"))
      .resolves.toBe("# External change\n");
  });

  it("refuses a new-path replacement when the reviewed missing target now exists", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-file-utils-"));
    const target = join(root, "profile");
    await mkdir(target);
    await writeFile(join(target, "AGENTS.md"), "# External creation\n");

    await expect(replacePathAtomically(target, async (stagingPath) => {
      await mkdir(stagingPath);
      await writeFile(join(stagingPath, "AGENTS.md"), "# Replacement\n");
    }, { expectedTargetHash: undefined })).rejects.toThrow(
      "changed after it was reviewed"
    );

    await expect(readFile(join(target, "AGENTS.md"), "utf8"))
      .resolves.toBe("# External creation\n");
  });

  it("skips unsupported directory fsync on Windows", async () => {
    let syncCalls = 0;
    await syncParentDirectory("C:\\AgentEnv", {
      platform: "win32",
      sync: async () => {
        syncCalls += 1;
        throw new Error("directory handles are unsupported");
      }
    });

    expect(syncCalls).toBe(0);
  });

  it("still fsyncs parent directories on POSIX systems", async () => {
    let syncedPath = "";
    await syncParentDirectory("/tmp/agentenv", {
      platform: "linux",
      sync: async (path) => {
        syncedPath = path;
      }
    });

    expect(syncedPath).toBe("/tmp/agentenv");
  });
});
