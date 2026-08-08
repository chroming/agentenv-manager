import { rm } from "node:fs/promises";
import type { SkillUpdateInfo } from "../shared/types";
import type { SkillMetadataFile } from "./skillLibraryMetadata";

export interface PendingSkillUpdate {
  previewId: string;
  id: string;
  candidateDir: string;
  candidateContentHash: string;
  expectedLibraryContentHash: string;
  expectedMetadataHash: string;
  createdAt: number;
  nextMetadata: SkillMetadataFile;
}

interface SkillUpdatePreviewStoreOptions {
  now?: () => number;
  ttlMs?: number;
  removeCandidate?: (path: string) => Promise<void>;
}

export const createSkillUpdatePreviewStore = ({
  now = Date.now,
  ttlMs = 30 * 60 * 1000,
  removeCandidate = (path) => rm(path, { recursive: true, force: true })
}: SkillUpdatePreviewStoreOptions = {}) => {
  const pending = new Map<string, PendingSkillUpdate>();

  const discard = async (previewId: string) => {
    const entry = pending.get(previewId);
    if (!entry) return;
    pending.delete(previewId);
    await removeCandidate(entry.candidateDir);
  };

  const discardForSkill = async (id: string, exceptPreviewId?: string) => {
    await Promise.all(
      [...pending.values()]
        .filter((entry) => entry.id === id && entry.previewId !== exceptPreviewId)
        .map((entry) => discard(entry.previewId))
    );
  };

  const discardExpired = async () => {
    const cutoff = now() - ttlMs;
    await Promise.all(
      [...pending.values()]
        .filter((entry) => entry.createdAt < cutoff)
        .map((entry) => discard(entry.previewId))
    );
  };

  return {
    discard,
    discardExpired,
    discardForSkill,
    get: (previewId: string) => pending.get(previewId),
    isExpired: (entry: PendingSkillUpdate) => now() - entry.createdAt > ttlMs,
    ownsCandidateDirectory: (path: string) =>
      [...pending.values()].some((entry) => entry.candidateDir === path),
    set: (entry: PendingSkillUpdate) => pending.set(entry.previewId, entry)
  };
};

export interface RecentSkillUpdateCheck {
  checkedAt: number;
  metadataHash: string;
  sourceStatus?: SkillUpdateInfo["sourceStatus"];
}

export const createRecentSkillUpdateCheckStore = ({
  now = Date.now,
  ttlMs = 2 * 60 * 1000
}: { now?: () => number; ttlMs?: number } = {}) => {
  const checks = new Map<string, RecentSkillUpdateCheck>();
  return {
    getFresh(id: string, metadataHash: string) {
      const check = checks.get(id);
      return check && check.metadataHash === metadataHash && now() - check.checkedAt <= ttlMs
        ? check
        : undefined;
    },
    set(id: string, check: RecentSkillUpdateCheck) {
      checks.set(id, check);
    }
  };
};
