import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvaluationResultStore } from "../../../src/main/evaluations/evaluationResultStore";
import type { OneShotEvaluationResult } from "../../../src/shared/evaluations";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const result = (): OneShotEvaluationResult => ({
  runId: "run-1",
  profileId: "profile-1",
  profileName: "Daily Coding",
  profileContentHash: "profile-hash",
  skillContentHashes: {},
  targetId: "opencode",
  targetName: "OpenCode",
  projectPath: "/Users/test/project",
  projectRevision: "abc123",
  prompt: "Use token=sk-abcdefghijklmnop in /private/evaluation/root",
  startedAt: "2026-08-01T00:00:00.000Z",
  completedAt: "2026-08-01T00:00:01.000Z",
  durationMs: 1_000,
  exitCode: 0,
  finalResponse: "Completed with password=very-secret-value",
  diff: "diff --git a/file b/file\n+secret=sk-abcdefghijklmnop\n",
  fileDiffs: [{ path: "file", diff: "+secret=sk-abcdefghijklmnop\n" }],
  changedFiles: ["file"],
  fidelity: "full",
  warnings: []
});

describe("evaluation result store", () => {
  it("redacts secrets and temporary paths before atomically storing the latest report", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-result-"));
    const path = join(root, "reports", "latest.json");
    const store = createEvaluationResultStore({ path });
    const stored = await store.saveLatest(result(), {
      privatePaths: ["/private/evaluation/root"]
    });

    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("sk-abcdefghijklmnop");
    expect(raw).not.toContain("very-secret-value");
    expect(raw).not.toContain("/private/evaluation/root");
    expect(stored.prompt).toContain("<evaluation-workspace>");
    expect(stored.finalResponse).toContain("<redacted>");
    await expect(store.readLatest()).resolves.toEqual(stored);
  });

  it("marks truncated reports instead of silently presenting them as complete", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-result-"));
    await mkdir(root, { recursive: true });
    const store = createEvaluationResultStore({
      path: join(root, "latest.json"),
      maxPromptBytes: 32,
      maxResponseBytes: 32,
      maxDiffBytes: 48
    });

    const stored = await store.saveLatest({
      ...result(),
      prompt: "p".repeat(200),
      finalResponse: "r".repeat(200),
      diff: "d".repeat(200),
      fileDiffs: [
        { path: "one", diff: "1".repeat(200) },
        { path: "two", diff: "2".repeat(200) }
      ]
    });
    expect(stored.warnings).toContain(
      "Stored evaluation output was truncated to protect local storage"
    );
    expect(stored.prompt).toContain("[Truncated by AgentEnv]");
    expect(stored.fileDiffs).toHaveLength(1);
  });

  it("ignores malformed reports instead of exposing partial data to the renderer", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-result-"));
    const path = join(root, "latest.json");
    const store = createEvaluationResultStore({ path });
    await writeFile(path, JSON.stringify({
      ...result(),
      fileDiffs: "not-an-array"
    }));

    await expect(store.readLatest()).resolves.toBeUndefined();
  });
});
