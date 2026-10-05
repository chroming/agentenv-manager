import { resolve } from "node:path";
import type { ProfileDetail } from "../shared/types";
import { hashManagedResourcePath } from "./managedResourceHashes";
import type { ProfileStore } from "./profileStore";

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
