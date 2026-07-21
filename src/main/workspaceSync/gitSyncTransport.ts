import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WorkspaceSyncConnection } from "../../shared/workspaceSync";
import type { GitCommandRunner } from "../skillSources/gitCommandRunner";
import { parseWorkspaceSyncConnection } from "./syncStateStore";

export interface RemoteWorkspaceRevision {
  revision?: string;
  snapshotRoot?: string;
}

export interface GitSyncTransport {
  fetch(connection: WorkspaceSyncConnection, destination: string, expectedAncestor?: string): Promise<RemoteWorkspaceRevision>;
  publish(input: {
    connection: WorkspaceSyncConnection;
    snapshotRoot: string;
    expectedRevision?: string;
    workDir: string;
  }): Promise<string>;
  cancel(): void;
  dispose(): void;
}

const gitEnv = {
  GIT_CONFIG_NOSYSTEM: "0",
  GIT_AUTHOR_NAME: "AgentEnv Manager",
  GIT_AUTHOR_EMAIL: "agentenv-manager@localhost",
  GIT_COMMITTER_NAME: "AgentEnv Manager",
  GIT_COMMITTER_EMAIL: "agentenv-manager@localhost"
};

const run = async (runner: GitCommandRunner, args: string[], cwd?: string) =>
  runner.run(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: gitEnv,
    timeoutMs: 90_000
  });

const remoteHead = async (runner: GitCommandRunner, connection: WorkspaceSyncConnection) => {
  const result = await run(runner, ["ls-remote", "--heads", connection.repository, `refs/heads/${connection.branch}`]);
  const line = result.stdout.trim().split("\n").find(Boolean);
  return line?.split(/\s+/)[0];
};

const assertSyncManifest = async (root: string) => {
  try {
    await stat(join(root, "agentenv-sync.json"));
  } catch {
    throw new Error("The selected Git branch does not contain an AgentEnv Workspace snapshot");
  }
};

export const createGitSyncTransport = (runner: GitCommandRunner): GitSyncTransport => ({
  fetch: async (rawConnection, destination, expectedAncestor) => {
    const connection = parseWorkspaceSyncConnection(rawConnection);
    const revision = await remoteHead(runner, connection);
    await rm(destination, { recursive: true, force: true });
    if (!revision) return {};
    await mkdir(dirname(destination), { recursive: true });
    await run(runner, ["clone", "--depth", "1", "--no-tags", "--branch", connection.branch, "--single-branch", connection.repository, destination]);
    if (expectedAncestor && expectedAncestor !== revision) {
      try {
        await run(runner, ["fetch", "--unshallow", "--no-tags", "origin", connection.branch], destination);
      } catch {
        // Local and already-complete clones do not have a shallow boundary.
      }
      try {
        await run(runner, ["merge-base", "--is-ancestor", expectedAncestor, revision], destination);
      } catch {
        throw new Error("The remote Workspace history was rewritten. Reconnect and review it as a new source.");
      }
    }
    await rm(join(destination, ".git"), { recursive: true, force: true });
    await assertSyncManifest(destination);
    return { revision, snapshotRoot: destination };
  },
  publish: async ({ connection: rawConnection, snapshotRoot, expectedRevision, workDir }) => {
    const connection = parseWorkspaceSyncConnection(rawConnection);
    const currentRevision = await remoteHead(runner, connection);
    if (currentRevision !== expectedRevision) {
      throw new Error("The remote Workspace changed. Check again before publishing.");
    }
    await rm(workDir, { recursive: true, force: true });
    await mkdir(dirname(workDir), { recursive: true });
    if (currentRevision) {
      await run(runner, ["clone", "--depth", "1", "--no-tags", "--branch", connection.branch, "--single-branch", connection.repository, workDir]);
    } else {
      await mkdir(workDir, { recursive: true });
      await run(runner, ["init"], workDir);
      await run(runner, ["remote", "add", "origin", connection.repository], workDir);
      await run(runner, ["checkout", "--orphan", connection.branch], workDir);
    }
    await rm(join(workDir, "agentenv-sync.json"), { force: true });
    await rm(join(workDir, "workspace"), { recursive: true, force: true });
    await cp(join(snapshotRoot, "agentenv-sync.json"), join(workDir, "agentenv-sync.json"));
    await cp(join(snapshotRoot, "workspace"), join(workDir, "workspace"), { recursive: true });
    await run(runner, ["add", "--", "agentenv-sync.json", "workspace"], workDir);
    const status = await run(runner, ["status", "--porcelain", "--", "agentenv-sync.json", "workspace"], workDir);
    if (!status.stdout.trim()) {
      const revision = currentRevision ?? (await run(runner, ["rev-parse", "HEAD"], workDir)).stdout.trim();
      return revision;
    }
    await run(runner, ["commit", "--no-verify", "-m", "Update AgentEnv workspace"], workDir);
    const revision = (await run(runner, ["rev-parse", "HEAD"], workDir)).stdout.trim();
    await run(runner, ["push", "origin", `HEAD:refs/heads/${connection.branch}`], workDir);
    return revision;
  },
  cancel: () => runner.cancelActive(),
  dispose: () => runner.dispose()
});
