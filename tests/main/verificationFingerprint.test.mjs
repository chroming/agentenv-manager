import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeVerificationSourceFingerprint,
  hasVerificationSourceChanges
} from "../../scripts/verification-fingerprint.mjs";

const execFileAsync = promisify(execFile);
let root = "";

const git = async (...args) =>
  execFileAsync("git", args, {
    cwd: root,
    maxBuffer: 1024 * 1024
  });

const prepareRepository = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-verification-fingerprint-"));
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "source.txt"), "source\n", "utf8");
  await writeFile(
    join(root, "docs", "verification-snapshot.json"),
    "{\"generated\":1}\n",
    "utf8"
  );
  await git("init");
  await git("config", "user.name", "AgentEnv Test");
  await git("config", "user.email", "agentenv@example.invalid");
  await git("add", ".");
  await git("commit", "-m", "fixture");
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("verification source identity", () => {
  it("ignores its generated snapshot for fingerprints and dirty state", async () => {
    await prepareRepository();
    const before = await computeVerificationSourceFingerprint(root);

    await writeFile(
      join(root, "docs", "verification-snapshot.json"),
      "{\"generated\":2}\n",
      "utf8"
    );

    expect(await computeVerificationSourceFingerprint(root)).toEqual(before);
    expect(await hasVerificationSourceChanges(root)).toBe(false);
  });

  it("still reports tracked and untracked product changes", async () => {
    await prepareRepository();
    await writeFile(join(root, "source.txt"), "changed\n", "utf8");
    expect(await hasVerificationSourceChanges(root)).toBe(true);

    await git("checkout", "--", "source.txt");
    await writeFile(join(root, "new-source.txt"), "new\n", "utf8");
    expect(await hasVerificationSourceChanges(root)).toBe(true);
  });
});
