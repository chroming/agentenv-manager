export type WorktreeReviewState =
  | "candidate"
  | "review"
  | "kept"
  | "unavailable";

export interface WorktreeEntry {
  path: string;
  repositoryPath: string;
  commonDir: string;
  head?: string;
  branch?: string;
  main: boolean;
  detached: boolean;
  locked?: string;
  prunable?: string;
  exists: boolean;
  state: WorktreeReviewState;
  reasons: string[];
  changes: string[];
  ignored: string[];
  submodules: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
  keptReason?: string;
  cleanupReviewAvailable: boolean;
  manualReviewAvailable: boolean;
  headNeedsProtection: boolean;
}

export const isBatchCleanupCandidate = (entry: WorktreeEntry): boolean =>
  entry.state === "candidate" && entry.cleanupReviewAvailable && entry.exists &&
  !entry.main && !entry.keptReason && !entry.locked && !entry.prunable &&
  !entry.detached && !entry.headNeedsProtection && !entry.submodules &&
  entry.reasons.length === 0 && entry.changes.length === 0 && entry.ignored.length === 0;

export interface WorktreeInventory {
  scanRoots: string[];
  configuredRoots: string[];
  builtinRoots: string[];
  entries: WorktreeEntry[];
  issues: string[];
  incomplete: boolean;
  scannedAt: string;
}

export type WorktreeScanResult = WorktreeInventory | { cancelled: true };

export interface WorktreeCleanupPreview {
  previewId: string;
  entry: WorktreeEntry;
  fingerprint: string;
  checkedAt: string;
  backupRequired: boolean;
  forceRequired: boolean;
  savedWorkspace: boolean;
}

export interface WorktreeRecoveryRecord {
  id: string;
  path: string;
  repositoryPath: string;
  head: string;
  branch?: string;
  createdAt: string;
  status: "prepared" | "removed" | "restoring" | "restored" | "unchanged";
  protectedRef?: string;
  backupHash?: string;
  indexHash?: string;
  sourceHash?: string;
  restoreAttemptHash?: string;
  sourceSizeBytes?: number;
  reclaimedSizeBytes?: number;
}

export interface WorktreeRecoveryInventory {
  records: WorktreeRecoveryRecord[];
  issues: string[];
}
