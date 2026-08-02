import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

interface MutationLockOwner {
  token: string;
  pid: number;
  operation: string;
  startedAt: string;
  dataRoot: string;
}

export interface MutationCoordinator {
  runExclusive<T>(operation: string, task: () => Promise<T>): Promise<T>;
}

interface MutationCoordinatorOptions {
  processId?: number;
  isProcessAlive?: (pid: number) => boolean;
}

const isExistingPathError = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");

const LOCK_INITIALIZATION_GRACE_MS = 5_000;

const defaultIsProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error && typeof error === "object" && "code" in error && error.code === "EPERM"
    );
  }
};

const lockPathFor = (appDataRoot: string) => {
  const canonicalRoot = resolve(appDataRoot);
  const rootHash = createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 16);
  return join(dirname(canonicalRoot), ".agentenv-manager-locks", `${rootHash}.lock`);
};

export const createMutationCoordinator = (
  appDataRoot: string,
  options: MutationCoordinatorOptions = {}
): MutationCoordinator => {
  const lockPath = lockPathFor(appDataRoot);
  const processId = options.processId ?? process.pid;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  let queue = Promise.resolve();

  const readOwner = async (): Promise<MutationLockOwner | undefined> => {
    try {
      const owner = JSON.parse(await readFile(lockPath, "utf8")) as Partial<MutationLockOwner>;
      return typeof owner.token === "string" &&
        typeof owner.pid === "number" &&
        typeof owner.operation === "string" &&
        typeof owner.startedAt === "string" &&
        typeof owner.dataRoot === "string"
        ? owner as MutationLockOwner
        : undefined;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
  };

  const acquire = async (operation: string): Promise<MutationLockOwner> => {
    await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const owner: MutationLockOwner = {
        token: randomUUID(),
        pid: processId,
        operation,
        startedAt: new Date().toISOString(),
        dataRoot: resolve(appDataRoot)
      };
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        return owner;
      } catch (error) {
        if (!isExistingPathError(error)) throw error;
        let current = await readOwner();
        if (!current) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
          current = await readOwner();
        }
        if (current && isProcessAlive(current.pid)) {
          throw new Error(
            `Another AgentEnv operation is already running: ${current.operation}`
          );
        }
        if (!current) {
          const stats = await lstat(lockPath).catch(() => undefined);
          if (stats && Date.now() - stats.mtimeMs < LOCK_INITIALIZATION_GRACE_MS) {
            throw new Error("Another AgentEnv operation is acquiring the data lock; retry");
          }
        }
        await rm(lockPath, { force: true });
      }
    }
    throw new Error("Another AgentEnv operation acquired the data lock; retry");
  };

  const release = async (owner: MutationLockOwner) => {
    const current = await readOwner();
    if (current?.token === owner.token) {
      await rm(lockPath, { force: true });
    }
  };

  const runExclusive = async <T>(operation: string, task: () => Promise<T>): Promise<T> => {
    const previous = queue;
    let releaseQueue!: () => void;
    queue = new Promise<void>((resolveQueue) => {
      releaseQueue = resolveQueue;
    });
    await previous;
    let owner: MutationLockOwner | undefined;
    try {
      owner = await acquire(operation);
      return await task();
    } finally {
      try {
        if (owner) await release(owner);
      } finally {
        releaseQueue();
      }
    }
  };

  return { runExclusive };
};
