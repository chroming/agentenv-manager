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

export interface WorktreeInventory {
  scanRoots: string[];
  configuredRoots: string[];
  entries: WorktreeEntry[];
  issues: string[];
  incomplete: boolean;
  scannedAt: string;
}

export interface WorktreeCleanupPreview {
  previewId: string;
  entry: WorktreeEntry;
  fingerprint: string;
  checkedAt: string;
  backupRequired: boolean;
  forceRequired: boolean;
}

export interface WorktreeRecoveryRecord {
  id: string;
  path: string;
  repositoryPath: string;
  head: string;
  branch?: string;
  createdAt: string;
  status: "prepared" | "removed" | "restored" | "unchanged";
  protectedRef?: string;
  backupHash?: string;
  indexHash?: string;
}

export interface WorktreeRecoveryInventory {
  records: WorktreeRecoveryRecord[];
  issues: string[];
}
