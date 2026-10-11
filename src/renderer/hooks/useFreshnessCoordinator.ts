import { useCallback, useRef, useState } from "react";
import {
  FRESHNESS_MAX_AGE_MS,
  createFreshnessStateMap,
  shouldRefreshResource,
  type FreshResource,
  type FreshnessReason,
  type FreshnessState,
  type FreshnessStateMap,
  type FreshnessStatus
} from "../freshness";

interface FreshnessResult<T> {
  performed: boolean;
  value?: T;
}

interface RunFreshnessOptions {
  force?: boolean;
  maxAgeMs?: number;
  partialError?: (value: unknown) => string | undefined;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const useFreshnessCoordinator = (now: () => number = Date.now) => {
  const [states, setStates] = useState<FreshnessStateMap>(createFreshnessStateMap);
  const statesRef = useRef(states);
  const inFlightRef = useRef(
    new Map<FreshResource, Promise<FreshnessResult<unknown>>>()
  );
  const versions = useRef(new Map<FreshResource, number>());
  const queued = useRef(new Map<FreshResource, {
    task: () => Promise<unknown>; options: RunFreshnessOptions;
    promise: Promise<FreshnessResult<unknown>>;
  }>());

  const update = useCallback((
    resource: FreshResource,
    change: (current: FreshnessState) => FreshnessState
  ) => {
    const next = {
      ...statesRef.current,
      [resource]: change(statesRef.current[resource])
    };
    statesRef.current = next;
    setStates(next);
  }, []);

  const markFresh = useCallback((
    resource: FreshResource,
    options: {
      at?: number;
      error?: string;
      status?: Extract<FreshnessStatus, "ready" | "partial">;
    } = {}
  ) => {
    const at = options.at ?? now();
    versions.current.set(resource, (versions.current.get(resource) ?? 0) + 1);
    update(resource, (current) => ({
      ...current,
      error: options.error,
      invalidated: false,
      lastAttemptAt: at,
      lastSuccessAt: at,
      status: options.status ?? "ready"
    }));
  }, [now, update]);

  const invalidate = useCallback((resource: FreshResource) => {
    versions.current.set(resource, (versions.current.get(resource) ?? 0) + 1);
    update(resource, (current) => ({ ...current, invalidated: true }));
  }, [update]);

  const run = useCallback(function runResource<T>(
    resource: FreshResource,
    reason: FreshnessReason,
    task: () => Promise<T>,
    options: RunFreshnessOptions = {}
  ): Promise<FreshnessResult<T>> {
    const existing = inFlightRef.current.get(resource);
    if (existing) {
      if (reason !== "mutation" && reason !== "manual" && !options.force) {
        return existing as Promise<FreshnessResult<T>>;
      }
      invalidate(resource);
      const pending = queued.current.get(resource);
      if (pending) {
        pending.task = task;
        pending.options = options;
        return pending.promise as Promise<FreshnessResult<T>>;
      }
      const next = { task, options, promise: undefined! as Promise<FreshnessResult<unknown>> };
      next.promise = existing.catch(() => undefined).then(() => {
        queued.current.delete(resource);
        return runResource(resource, "mutation", next.task, { ...next.options, force: true });
      });
      queued.current.set(resource, next);
      return next.promise as Promise<FreshnessResult<T>>;
    }

    const configuredMaxAge =
      resource === "skill-upstreams"
        ? undefined
        : FRESHNESS_MAX_AGE_MS[resource][reason];
    const maxAgeMs = options.maxAgeMs ?? configuredMaxAge ?? 0;
    const force = options.force ?? (
      reason === "manual" || reason === "mutation"
    );
    if (!shouldRefreshResource({
      force,
      maxAgeMs,
      now: now(),
      state: statesRef.current[resource]
    })) {
      return Promise.resolve({ performed: false });
    }

    const startedAt = now();
    const version = versions.current.get(resource) ?? 0;
    update(resource, (current) => ({
      ...current,
      error: undefined,
      lastAttemptAt: startedAt,
      status: "refreshing"
    }));
    const operation = task()
      .then((value) => {
        const partialError = options.partialError?.(value);
        const completedAt = now();
        update(resource, (current) => (versions.current.get(resource) ?? 0) !== version ? {
          ...current,
          status: current.status === "refreshing" ? "idle" : current.status
        } : ({
          ...current,
          error: partialError,
          invalidated: false,
          lastAttemptAt: startedAt,
          lastSuccessAt: !partialError ? completedAt : current.lastSuccessAt,
          status: partialError ? "partial" : "ready"
        }));
        return { performed: true, value };
      })
      .catch((error) => {
        update(resource, (current) => (versions.current.get(resource) ?? 0) !== version ? {
          ...current,
          status: current.status === "refreshing" ? "idle" : current.status
        } : ({
          ...current,
          error: errorMessage(error),
          lastAttemptAt: startedAt,
          status: "error"
        }));
        throw error;
      })
      .finally(() => {
        inFlightRef.current.delete(resource);
      });
    inFlightRef.current.set(
      resource,
      operation as Promise<FreshnessResult<unknown>>
    );
    return operation;
  }, [now, update, invalidate]);

  return {
    states,
    statesRef,
    invalidate,
    markFresh,
    run
  };
};
