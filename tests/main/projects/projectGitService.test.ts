import { describe, expect, it, vi } from "vitest";
import { GitCommandError, type GitCommandRunner } from "../../../src/main/skillSources/gitCommandRunner";
import { createProjectGitService } from "../../../src/main/projects/projectGitService";

const result = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 });

describe("project Git service", () => {
  it("reports bounded path states without running mutating Git commands", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "rev-parse") return result("/work/repo\n");
      const path = args.at(-1);
      if (args[0] === "status" && path === "AGENTS.md") return result(" M AGENTS.md\0");
      if (args[0] === "status" && path === ".agents/skills/new") return result("?? .agents/skills/new/SKILL.md\0");
      if (args[0] === "status" && path === ".agents/skills/ignored") return result("!! .agents/skills/ignored/SKILL.md\0");
      if (args[0] === "status") return result();
      if (args[0] === "ls-files" && path === ".agents/skills/clean") return result(".agents/skills/clean/SKILL.md\n");
      throw new GitCommandError("Git command failed", { exitCode: 1 });
    });
    const service = createProjectGitService({
      resolveRunner: async () => ({ run } as unknown as GitCommandRunner)
    });

    const observation = await service.inspect("/work/repo/packages/app", [
      "AGENTS.md",
      ".agents/skills/new",
      ".agents/skills/ignored",
      ".agents/skills/clean"
    ]);

    expect(observation).toEqual({
      repository: "git",
      rootRelation: "workspace-inside-repository",
      pathStates: {
        "AGENTS.md": "tracked-modified",
        ".agents/skills/new": "untracked",
        ".agents/skills/ignored": "ignored",
        ".agents/skills/clean": "tracked-clean"
      }
    });
    expect(run.mock.calls.every(([args]) =>
      ["rev-parse", "status", "ls-files"].includes((args as string[])[0]!)))
      .toBe(true);
  });

  it("distinguishes non-Git folders from unavailable Git", async () => {
    const nonGit = createProjectGitService({
      resolveRunner: async () => ({
        run: vi.fn().mockRejectedValue(new GitCommandError(
          "Git command failed: not a git repository",
          { exitCode: 128, stderr: "not a git repository" }
        ))
      } as unknown as GitCommandRunner)
    });
    await expect(nonGit.inspect("/work/plain", ["AGENTS.md"]))
      .resolves.toEqual({ repository: "not-git", pathStates: {} });

    const unavailable = createProjectGitService({ resolveRunner: async () => undefined });
    await expect(unavailable.inspect("/work/plain", ["AGENTS.md"]))
      .resolves.toEqual({
        repository: "unavailable",
        pathStates: {},
        issue: "System Git is unavailable"
      });
  });

  it("rejects escaping paths before invoking Git", async () => {
    const run = vi.fn();
    const service = createProjectGitService({
      resolveRunner: async () => ({ run } as unknown as GitCommandRunner)
    });
    await expect(service.inspect("/work/repo", ["../secret"]))
      .rejects.toThrow("Unsafe Workspace Git path");
    expect(run).not.toHaveBeenCalled();
  });
});
