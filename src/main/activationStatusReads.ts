import { resolve } from "node:path";
import type { ManagedResourceSnapshot, ProfileDetail } from "../shared/types";
import { hashManagedResourcePath } from "./managedResourceHashes";
import type { ProfileStore } from "./profileStore";

export const hasCurrentManagedSkillLocations = (
  resources: readonly Pick<ManagedResourceSnapshot, "kind" | "path" | "paused">[],
  expectedPaths: Iterable<string>
) => {
  const recordedPaths = new Set(resources
    .filter((resource) => resource.kind === "skill" && !resource.paused)
    .map((resource) => resolve(resource.path)));
  // Obsolete adapter paths cannot prove the current runtime is deployed.
  return [...expectedPaths].every((path) => recordedPaths.has(resolve(path)));
};

// Create per observation, never reuse across status requests or mutation previews.
export const createActivationStatusReads = (profileStore: Pick<ProfileStore, "readProfile">) => {
  const profiles = new Map<string, Promise<ProfileDetail | undefined>>();
  const hashes = new Map<string, ReturnType<typeof hashManagedResourcePath>>();
  const readProfile = (id: string) => {
    let pending = profiles.get(id);
    if (!pending) {
      pending = profileStore.readProfile(id).catch(() => undefined);
      profiles.set(id, pending);
    }
    return pending;
  };
  const readResourceHash: typeof hashManagedResourcePath = (path, kind) => {
    const key = JSON.stringify([kind, resolve(path)]);
    let pending = hashes.get(key);
    if (!pending) {
      pending = hashManagedResourcePath(path, kind);
      hashes.set(key, pending);
    }
    return pending;
  };
  return { readProfile, readResourceHash };
};
