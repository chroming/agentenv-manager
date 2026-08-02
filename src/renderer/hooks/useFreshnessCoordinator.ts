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
    update(resource, (current) => ({ ...current, invalidated: true }));
  }, [update]);

  const run = useCallback(<T,>(
    resource: FreshResource,
    reason: FreshnessReason,
    task: () => Promise<T>,
    options: RunFreshnessOptions = {}
  ): Promise<FreshnessResult<T>> => {
    const existing = inFlightRef.current.get(resource);
    if (existing) return existing as Promise<FreshnessResult<T>>;

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
        update(resource, (current) => ({
          ...current,
          error: partialError,
          invalidated: false,
          lastAttemptAt: startedAt,
          lastSuccessAt: completedAt,
          status: partialError ? "partial" : "ready"
        }));
        return { performed: true, value };
      })
      .catch((error) => {
        update(resource, (current) => ({
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
  }, [now, update]);

  return {
    states,
    statesRef,
    invalidate,
    markFresh,
    run
  };
};
