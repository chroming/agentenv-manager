import { describe, expect, it, vi } from "vitest";
import { readWorktreeAnalysis } from "../../src/main/worktrees/worktreeAnalysis";
import type { WorktreeEntry } from "../../src/shared/worktrees";
import type { GitCommandRunner, GitCommandRunOptions } from "../../src/main/skillSources/gitCommandRunner";

const entry: WorktreeEntry = {
  path: "/worktree", repositoryPath: "/repo", commonDir: "/repo/.git", head: "a".repeat(40),
  main: false, state: "review", reasons: [], changes: [], ignored: [], submodules: false,
  detached: false, exists: true, cleanupReviewAvailable: true, manualReviewAvailable: true, headNeedsProtection: false,
  integration: { ref: "refs/heads/release", head: "b".repeat(40), merged: false, explicit: true, choices: [] }
};

describe("bounded Worktree AI evidence", () => {
  it("discloses omitted diff evidence instead of claiming the worktree has no differences", async () => {
    const run = vi.fn(async (args: string[], _options?: GitCommandRunOptions) => {
      if (args.includes("diff")) throw new Error("output limit");
      return { stdout: args.includes("rev-list") ? "1" : args.includes("merge-base") ? "c".repeat(40) : "local commit", stderr: "", exitCode: 0 };
    });
    const input = await readWorktreeAnalysis(entry, { run } as unknown as GitCommandRunner);
    expect(input.partial).toBe(true);
    expect(input.documents.map((doc) => doc.id)).toEqual(["state", "baseline", "commits"]);
    expect(input.warnings.filter((message) => message.includes("evidence limits"))).toHaveLength(4);
    expect(run.mock.calls.every(([, options]) => options!.timeoutMs! <= 8_000)).toBe(true);
  });
  it("separates branch changes from later target changes using the reviewed target, not the main checkout", async () => {
    const run = vi.fn(async (args: string[]) => ({
      stdout: args.includes("merge-base") ? "c".repeat(40) : args.includes("rev-list") ? "25" : "evidence",
      stderr: "", exitCode: 0
    }));
    const input = await readWorktreeAnalysis(entry, { run } as unknown as GitCommandRunner);
    expect(input.documents.find((doc) => doc.id === "baseline")?.content).toContain("refs/heads/release");
    expect(run.mock.calls.some(([args]) => args.includes("rev-parse"))).toBe(false);
    const branch = run.mock.calls.find(([args]) => args.includes("diff") && args.includes("c".repeat(40)) && args.includes(entry.head!))![0];
    expect(branch).toContain("--no-ext-diff");
    expect(branch).toContain("--no-textconv");
    expect(input.documents.map((doc) => doc.id)).toContain("target-diff");
    expect(input.partial).toBe(true);
    expect(input.warnings.join(" ")).toContain("commit list is incomplete");
  });
  it("does not guess a baseline when integration is unknown", async () => {
    const run = vi.fn(async () => ({ stdout: "local diff", stderr: "", exitCode: 0 }));
    const input = await readWorktreeAnalysis({ ...entry, integration: undefined }, { run } as unknown as GitCommandRunner);
    expect(input.partial).toBe(true);
    expect(input.documents.map((doc) => doc.id)).toEqual(["state", "local-diff"]);
    expect(input.warnings.join(" ")).toContain("No integration target");
  });
});
