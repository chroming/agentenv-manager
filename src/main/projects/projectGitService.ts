import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ProjectGitObservation, ProjectGitPathState } from "../../shared/types";
import {
  GitCommandError,
  type GitCommandRunner
} from "../skillSources/gitCommandRunner";

interface ProjectGitServiceOptions {
  resolveRunner(): Promise<GitCommandRunner | undefined>;
}

export interface ProjectGitService {
  inspect(workspaceRoot: string, relativePaths: readonly string[]): Promise<ProjectGitObservation>;
}

const MAX_PATHS = 256;

const assertRelativePath = (value: string) => {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    isAbsolute(value) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`Unsafe Workspace Git path: ${value}`);
  }
  return normalized;
};

const stateFromPorcelain = (output: string): ProjectGitPathState | undefined => {
  const entries = output.split("\0").filter(Boolean);
  if (entries.some((entry) => !entry.startsWith("?? ") && !entry.startsWith("!! "))) {
    return "tracked-modified";
  }
  if (entries.some((entry) => entry.startsWith("?? "))) return "untracked";
  if (entries.some((entry) => entry.startsWith("!! "))) return "ignored";
  return undefined;
};

export const createProjectGitService = ({
  resolveRunner
}: ProjectGitServiceOptions): ProjectGitService => ({
  inspect: async (workspaceRoot, unsafePaths) => {
    const paths = [...new Set(unsafePaths.map(assertRelativePath))];
    if (paths.length > MAX_PATHS) throw new Error("Workspace has too many Git paths to inspect");
    const runner = await resolveRunner();
    if (!runner) {
      return {
        repository: "unavailable",
        pathStates: {},
        issue: "System Git is unavailable"
      };
    }

    let repositoryRoot: string;
    try {
      repositoryRoot = (await runner.run(
        ["rev-parse", "--show-toplevel"],
        { cwd: workspaceRoot, timeoutMs: 2_000, maxOutputBytes: 16 * 1024 }
      )).stdout.trim();
    } catch (error) {
      if (
        error instanceof GitCommandError &&
        /not a git repository/i.test(`${error.message}\n${error.stderr}`)
      ) {
        return { repository: "not-git", pathStates: {} };
      }
      return {
        repository: "unavailable",
        pathStates: {},
        issue: error instanceof Error ? error.message : "Git status is unavailable"
      };
    }

    const pathStates: Record<string, ProjectGitPathState> = {};
    for (const path of paths) {
      try {
        const status = await runner.run(
          ["status", "--porcelain=v1", "-z", "--ignored", "--untracked-files=all", "--", path],
          { cwd: workspaceRoot, timeoutMs: 2_000, maxOutputBytes: 128 * 1024 }
        );
        const state = stateFromPorcelain(status.stdout);
        if (state) {
          pathStates[path] = state;
          continue;
        }
        const tracked = await runner.run(
          ["ls-files", "--error-unmatch", "--", path],
          { cwd: workspaceRoot, timeoutMs: 2_000, maxOutputBytes: 128 * 1024 }
        ).then(() => true, () => false);
        pathStates[path] = tracked ? "tracked-clean" : "untracked";
      } catch (error) {
        pathStates[path] = "unavailable";
      }
    }

    const relation = relative(resolve(repositoryRoot), resolve(workspaceRoot));
    return {
      repository: "git",
      rootRelation: !relation || relation === "."
        ? "workspace-root"
        : relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)
          ? "workspace-inside-repository"
          : "repository-inside-workspace",
      pathStates
    };
  }
});
