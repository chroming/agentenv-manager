import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const runGit = async (cwd: string, args: string[]) => {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  return stdout.trim();
};

export interface GitTestRepository {
  remoteDir: string;
  workDir: string;
  commit(message: string): Promise<string>;
  write(relativePath: string, content: string): Promise<void>;
}

export const createGitTestRepository = async (
  root: string,
  files: Record<string, string>
): Promise<GitTestRepository> => {
  const remoteDir = join(root, "remote.git");
  const workDir = join(root, "work");
  await mkdir(remoteDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  await runGit(remoteDir, ["init", "--bare", "--initial-branch=main"]);
  await runGit(workDir, ["init", "--initial-branch=main"]);
  await runGit(workDir, ["config", "user.name", "AgentEnv Tests"]);
  await runGit(workDir, ["config", "user.email", "agentenv@example.test"]);
  await runGit(workDir, ["remote", "add", "origin", remoteDir]);

  const write = async (relativePath: string, content: string) => {
    const path = join(workDir, ...relativePath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  };
  for (const [path, content] of Object.entries(files)) {
    await write(path, content);
  }

  const commit = async (message: string) => {
    await runGit(workDir, ["add", "--all"]);
    await runGit(workDir, ["commit", "-m", message]);
    const branch = await runGit(workDir, ["branch", "--show-current"]);
    await runGit(workDir, ["push", "--force", "origin", `HEAD:refs/heads/${branch}`]);
    return runGit(workDir, ["rev-parse", "HEAD"]);
  };

  await commit("initial skills");
  return { remoteDir, workDir, commit, write };
};
