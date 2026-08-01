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
  workspace: {
    kind: "folder",
    path: "/Users/test/project",
    name: "project",
    contentHash: "workspace-hash",
    fileCount: 1,
    totalBytes: 10,
    omittedCount: 0
  },
  prompt: "Use token=sk-abcdefghijklmnop in /private/evaluation/root for /Users/test/project",
  startedAt: "2026-08-01T00:00:00.000Z",
  completedAt: "2026-08-01T00:00:01.000Z",
  durationMs: 1_000,
  current: {
    environment: "current",
    environmentContentHash: "current-hash",
    skillContentHashes: {},
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:00:00.500Z",
    durationMs: 500,
    exitCode: 0,
    finalResponse: "Current response",
    diff: "",
    fileDiffs: [],
    changedFiles: [],
    fidelity: "full",
    warnings: []
  },
  proposed: {
    environment: "proposed",
    environmentContentHash: "proposed-hash",
    skillContentHashes: {},
    startedAt: "2026-08-01T00:00:00.500Z",
    completedAt: "2026-08-01T00:00:01.000Z",
    durationMs: 500,
    exitCode: 0,
    finalResponse: "Completed with password=very-secret-value",
    diff: "diff --git a/file b/file\n+secret=sk-abcdefghijklmnop\n",
    fileDiffs: [{ path: "file", diff: "+secret=sk-abcdefghijklmnop\n" }],
    changedFiles: ["file"],
    fidelity: "full",
    warnings: []
  },
  delta: {
    diff: "diff --git a/file b/file\n+secret=sk-abcdefghijklmnop\n",
    fileDiffs: [{ path: "file", diff: "+secret=sk-abcdefghijklmnop\n" }],
    changedFiles: ["file"]
  },
  baselineSource: "fresh-run",
  comparisonSignature: "comparison-hash",
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
    expect(raw).not.toContain("/Users/test/project");
    expect(stored.prompt).toContain("<comparison-workspace>");
    expect(stored.workspace.path).toBeUndefined();
    expect(stored.proposed.finalResponse).toContain("<redacted>");
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
      proposed: {
        ...result().proposed,
        finalResponse: "r".repeat(200),
        diff: "d".repeat(200),
        fileDiffs: [
          { path: "one", diff: "1".repeat(200) },
          { path: "two", diff: "2".repeat(200) }
        ]
      }
    });
    expect(stored.warnings).toContain(
      "Stored comparison output was truncated to protect local storage"
    );
    expect(stored.prompt).toContain("[Truncated by AgentEnv]");
    expect(stored.proposed.fileDiffs).toHaveLength(1);
  });

  it("removes terminal control sequences from comparison errors", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-result-"));
    const path = join(root, "latest.json");
    const store = createEvaluationResultStore({ path });
    const stored = await store.saveLatest({
      ...result(),
      current: {
        ...result().current,
        error: "\u001b[91m\u001b[1mError:\u001b[0m operation not permitted"
      }
    });

    expect(stored.current.error).toBe("Error: operation not permitted");
    expect(await readFile(path, "utf8")).not.toContain("\u001b");
  });

  it("ignores malformed reports instead of exposing partial data to the renderer", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-result-"));
    const path = join(root, "latest.json");
    const store = createEvaluationResultStore({ path });
    await writeFile(path, JSON.stringify({
      ...result(),
      delta: { ...result().delta, fileDiffs: "not-an-array" }
    }));

    await expect(store.readLatest()).resolves.toBeUndefined();
  });
});
