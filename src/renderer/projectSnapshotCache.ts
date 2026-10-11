import type { ProjectEnvironmentSnapshot } from "../shared/types";

export const projectSnapshotCache = new Map<string, ProjectEnvironmentSnapshot>();
const timestamps = new Map<string, number>();
const versions = new Map<string, number>();
const requests = new Map<string, { version: number; promise: Promise<ProjectEnvironmentSnapshot> }>();
const queued = new Map<string, Promise<ProjectEnvironmentSnapshot>>();
let epoch = 0;

export const clearProjectSnapshotCache = (id?: string) => {
  if (id) {
    versions.set(id, (versions.get(id) ?? 0) + 1);
    timestamps.delete(id);
    projectSnapshotCache.delete(id);
    queued.delete(id);
  } else {
    epoch++;
    versions.clear();
    timestamps.clear();
    projectSnapshotCache.clear();
    requests.clear();
    queued.clear();
  }
};

export const readProjectSnapshot = (id: string, force = false): Promise<ProjectEnvironmentSnapshot> => {
  if (force) {
    versions.set(id, (versions.get(id) ?? 0) + 1);
    timestamps.delete(id);
  }
  const version = versions.get(id) ?? 0;
  const waiting = queued.get(id);
  if (waiting) return waiting;
  const pending = requests.get(id);
  if (pending && pending.version !== version) {
    const next: Promise<ProjectEnvironmentSnapshot> = pending.promise.catch(() => undefined).then(() => {
      if (queued.get(id) !== next) throw new Error("Workspace changed while reading. Refresh the Workspace.");
      queued.delete(id);
      return readProjectSnapshot(id);
    });
    queued.set(id, next);
    return next;
  }
  const previous = projectSnapshotCache.get(id);
  if (!force && previous && Date.now() - (timestamps.get(id) ?? 0) < 60_000) return Promise.resolve(previous);
  if (pending?.version === version) return pending.promise;
  const startedEpoch = epoch;
  const promise = window.agentEnv.inspectProject(id).then((next) => {
    if (epoch === startedEpoch && (versions.get(id) ?? 0) === version) {
      projectSnapshotCache.set(id, next);
      timestamps.set(id, Date.now());
    }
    return next;
  }).finally(() => {
    if (requests.get(id)?.promise === promise) requests.delete(id);
  });
  requests.set(id, { version, promise });
  return promise;
};
