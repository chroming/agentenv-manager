import { describe, expect, it, vi } from "vitest";
import { readWorktreeAnalysis } from "../../src/main/worktrees/worktreeAnalysis";
import type { WorktreeEntry } from "../../src/shared/worktrees";
import type { GitCommandRunner, GitCommandRunOptions } from "../../src/main/skillSources/gitCommandRunner";

const entry: WorktreeEntry = {
  path: "/worktree", repositoryPath: "/repo", commonDir: "/repo/.git", head: "a".repeat(40),
  main: false, state: "review", reasons: [], changes: [], ignored: [], submodules: false,
  detached: false, exists: true, cleanupReviewAvailable: true, manualReviewAvailable: true, headNeedsProtection: false
};

describe("bounded Worktree AI evidence", () => {
  it("discloses omitted diff evidence instead of claiming the worktree has no differences", async () => {
    const run = vi.fn(async (args: string[], _options?: GitCommandRunOptions) => {
      if (args.includes("diff")) throw new Error("output limit");
      return { stdout: args.includes("rev-parse") ? "b".repeat(40) : "local commit", stderr: "", exitCode: 0 };
    });
    const input = await readWorktreeAnalysis(entry, { run } as unknown as GitCommandRunner);
    expect(input.partial).toBe(true);
    expect(input.documents.map((doc) => doc.id)).toEqual(["state", "baseline", "commits"]);
    expect(input.warnings.filter((message) => message.includes("evidence limits"))).toHaveLength(2);
    expect(run.mock.calls.every(([, options]) => options!.timeoutMs! <= 8_000)).toBe(true);
  });
});
