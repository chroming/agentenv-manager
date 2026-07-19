import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { RepositorySkillSourceInput } from "../../shared/types";
import { isMissingFileError, pathEntryExists, writeAtomic } from "../fileUtils";
import type { ResolvedGitRepository } from "./contract";
import { GitCommandError, type GitCommandRunner } from "./gitCommandRunner";
import { parseRepositoryLocation } from "./repositoryLocation";

interface RepositoryCacheMarker {
  formatVersion: 1;
  cacheKeyLocator: string;
  transportLocator: string;
}

export interface GitRepositoryCacheOptions {
  cacheRoot: string;
  runner: GitCommandRunner;
  maxConcurrentFetches?: number;
}

export interface GitRepositoryCache {
  fetch(input: RepositorySkillSourceInput, signal?: AbortSignal): Promise<ResolvedGitRepository>;
}

const safeRef = (value: string | undefined): string | undefined => {
  const ref = value?.trim();
  if (!ref) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(ref) || ref.startsWith("-") || ref.includes("@{")) {
    throw new Error("Repository ref is unsafe");
  }
  return ref;
};

const markerPathFor = (cachePath: string) => join(cachePath, ".agentenv-repository.json");

const readMarker = async (cachePath: string): Promise<RepositoryCacheMarker | undefined> => {
  try {
    return JSON.parse(await readFile(markerPathFor(cachePath), "utf8")) as RepositoryCacheMarker;
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return undefined;
    throw error;
  }
};

const isFilterUnsupported = (error: unknown) =>
  error instanceof GitCommandError &&
  /filtering not recognized|does not support filter|filter.*not supported/i.test(error.stderr);

export const createGitRepositoryCache = (
  options: GitRepositoryCacheOptions
): GitRepositoryCache => {
  const inflight = new Map<string, Promise<ResolvedGitRepository>>();
  const repositoryQueues = new Map<string, Promise<void>>();
  const waiters: Array<() => void> = [];
  const maxConcurrentFetches = Math.max(1, options.maxConcurrentFetches ?? 2);
  let activeFetches = 0;

  const acquire = async () => {
    if (activeFetches < maxConcurrentFetches) {
      activeFetches += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    activeFetches += 1;
  };

  const release = () => {
    activeFetches -= 1;
    waiters.shift()?.();
  };

  const serializeRepository = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = repositoryQueues.get(key) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    repositoryQueues.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      releaseQueue();
      if (repositoryQueues.get(key) === queued) repositoryQueues.delete(key);
    }
  };

  const ensureCache = async (
    cachePath: string,
    marker: RepositoryCacheMarker,
    signal?: AbortSignal
  ) => {
    const rebuild = async () => {
      await rm(cachePath, { recursive: true, force: true });
      await mkdir(options.cacheRoot, { recursive: true });
      await options.runner.run(["init", "--bare", cachePath], { signal, timeoutMs: 30_000 });
      await options.runner.run(
        ["--git-dir", cachePath, "remote", "add", "origin", marker.transportLocator],
        { signal, timeoutMs: 30_000 }
      );
      await writeAtomic(markerPathFor(cachePath), `${JSON.stringify(marker, null, 2)}\n`);
    };

    if (!(await pathEntryExists(cachePath))) {
      await rebuild();
      return;
    }
    const existing = await readMarker(cachePath);
    if (
      existing?.formatVersion !== 1 ||
      existing.cacheKeyLocator !== marker.cacheKeyLocator ||
      existing.transportLocator !== marker.transportLocator
    ) {
      await rebuild();
      return;
    }
    try {
      const bare = await options.runner.run(
        ["--git-dir", cachePath, "rev-parse", "--is-bare-repository"],
        { signal, timeoutMs: 30_000 }
      );
      const origin = await options.runner.run(
        ["--git-dir", cachePath, "remote", "get-url", "origin"],
        { signal, timeoutMs: 30_000 }
      );
      if (bare.stdout.trim() !== "true" || origin.stdout.trim() !== marker.transportLocator) {
        await rebuild();
      }
    } catch {
      await rebuild();
    }
  };

  const resolveDefaultRef = async (repository: string, signal?: AbortSignal) => {
    const result = await options.runner.run(["ls-remote", "--symref", repository, "HEAD"], {
      signal,
      timeoutMs: 15_000
    });
    const match = result.stdout.match(/^ref:\s+refs\/heads\/(.+)\tHEAD$/m);
    return match?.[1] ?? "HEAD";
  };

  const fetch = (
    input: RepositorySkillSourceInput,
    signal?: AbortSignal
  ): Promise<ResolvedGitRepository> => {
    const location = parseRepositoryLocation(input.repository, { allowLocal: true });
    const requestedRef = safeRef(input.ref ?? location.inferredRef);
    const requestKey = `${location.cacheKeyLocator}\0${requestedRef ?? "<default>"}`;
    const existing = inflight.get(requestKey);
    if (existing) return existing;

    const operation = serializeRepository(location.cacheKeyLocator, async () => {
      await acquire();
      try {
        const ref = requestedRef ?? (await resolveDefaultRef(location.transportLocator, signal));
        const cacheKey = createHash("sha256").update(location.cacheKeyLocator).digest("hex");
        const cachePath = join(options.cacheRoot, `${cacheKey}.git`);
        const marker: RepositoryCacheMarker = {
          formatVersion: 1,
          cacheKeyLocator: location.cacheKeyLocator,
          transportLocator: location.transportLocator
        };
        await ensureCache(cachePath, marker, signal);

        const baseFetchArgs = [
          "--git-dir",
          cachePath,
          "fetch",
          "--depth=1",
          "--no-tags",
          "origin",
          ref
        ];
        try {
          await options.runner.run(
            [...baseFetchArgs.slice(0, 4), "--filter=blob:none", ...baseFetchArgs.slice(4)],
            { signal, timeoutMs: 120_000 }
          );
        } catch (error) {
          if (!isFilterUnsupported(error)) throw error;
          await options.runner.run(baseFetchArgs, { signal, timeoutMs: 120_000 });
        }
        const resolved = await options.runner.run(
          ["--git-dir", cachePath, "rev-parse", "FETCH_HEAD^{commit}"],
          { signal, timeoutMs: 30_000 }
        );
        const resolvedCommit = resolved.stdout.trim();
        if (!/^[a-f0-9]{40,64}$/i.test(resolvedCommit)) {
          throw new Error("Repository returned an invalid commit revision");
        }
        const cacheRef = `refs/agentenv/${createHash("sha256").update(ref).digest("hex")}`;
        await options.runner.run(
          ["--git-dir", cachePath, "update-ref", cacheRef, resolvedCommit],
          { signal, timeoutMs: 30_000 }
        );
        return {
          repository: location.transportLocator,
          location,
          ref,
          resolvedCommit,
          cachePath,
          cacheRef
        };
      } finally {
        release();
      }
    });
    inflight.set(requestKey, operation);
    void operation.then(
      () => {
        if (inflight.get(requestKey) === operation) inflight.delete(requestKey);
      },
      () => {
        if (inflight.get(requestKey) === operation) inflight.delete(requestKey);
      }
    );
    return operation;
  };

  return { fetch };
};
