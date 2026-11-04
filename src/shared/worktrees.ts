export type WorktreeReviewState =
  | "candidate"
  | "review"
  | "kept"
  | "unavailable";

export interface WorktreeIntegration {
  ref?: string;
  head?: string;
  merged?: boolean;
  explicit: boolean;
  choices: string[];
}

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
  pathAvailability?: "unknown";
  state: WorktreeReviewState;
  reasons: string[];
  reasonDetails?: Array<{ message: string; values?: Record<string, string | number>; detail?: string }>;
  changes: string[];
  ignored: string[];
  submodules: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
  measurementPending?: boolean;
  keptReason?: string;
  repositoryKeptReason?: string;
  cleanupReviewAvailable: boolean;
  manualReviewAvailable: boolean;
  headNeedsProtection: boolean;
  pausedOperations?: string[];
  localContentUncertain?: boolean;
  integration?: WorktreeIntegration;
}

export const canSelectWorktreeForCleanup = (entry: WorktreeEntry): boolean =>
  (entry.exists || entry.pathAvailability === "unknown") && !entry.main && !entry.keptReason && !entry.repositoryKeptReason;

export const isAutomaticCleanupCandidate = (entry: WorktreeEntry): boolean =>
  canSelectWorktreeForCleanup(entry) &&
  entry.exists && entry.pathAvailability !== "unknown" &&
  entry.state === "candidate" && entry.cleanupReviewAvailable &&
  !entry.locked && !entry.prunable && !entry.submodules && Boolean(entry.head) &&
  !entry.localContentUncertain &&
  !entry.detached && !entry.headNeedsProtection && !entry.submodules &&
  entry.reasons.length === 0 && entry.changes.length === 0 && entry.ignored.length === 0;

export interface WorktreeInventory {
  measuring?: boolean;
  measurementRevision?: number;
  scanRoots: string[];
  configuredRoots: string[];
  builtinRoots: string[];
  entries: WorktreeEntry[];
  issues: string[];
  incomplete: boolean;
  scannedAt: string;
}

export type WorktreeScanResult = WorktreeInventory | { cancelled: true };

export type WorktreeDisposalMode = "trash" | "permanent";
export interface WorktreeCleanupRequest { commonDir: string; path: string; allowDirty: boolean; mode?: WorktreeDisposalMode }
export type WorktreeCleanupPreparation = { path: string; preview: WorktreeCleanupPreview; error?: never } | { path: string; error: string; preview?: never };
export type WorktreeOperationPhase = "preparing" | "backing-up" | "removing" | "verifying";
export interface WorktreeFileProgress {
  step: "fingerprinting" | "copying" | "verifying-source" | "verifying-backup";
  // Per-pass observed counts, not totals or a percentage. Copying counts source
  // entries enumerated by cp, not bytes durably written; verification counts reads.
  filesCounted: number;
  bytesCounted: number;
}
export interface WorktreeOperationProgress {
  requestId: string;
  phase: WorktreeOperationPhase;
  path: string;
  completed: number;
  total: number;
  fileProgress?: WorktreeFileProgress;
  preparation?: WorktreeCleanupPreparation;
}

export interface WorktreeCleanupPreview {
  mode?: WorktreeDisposalMode;
  previewId: string;
  entry: WorktreeEntry;
  fingerprint: string;
  // Legacy previews omit this field and cannot execute. This digest is not a
  // full-content hash: exact folder contents are captured only after Remove.
  fingerprintScope?: "git-and-selected-paths";
  checkedAt: string;
  backupRequired: boolean;
  forceRequired: boolean;
  savedWorkspace: boolean;
  gitWriteInProgress?: boolean;
  workspaceImpactUnknown?: boolean;
  gitFingerprint?: string;
}

export interface WorktreeRestoreRegistration {
  gitDir: string;
  commonDir: string;
  adminDevice: string;
  adminInode: string;
  worktreeDevice: string;
  worktreeInode: string;
  linkDevice: string;
  linkInode: string;
  gitFileHash: string;
  backlinkHash: string;
  commonLinkHash: string;
}

export interface WorktreeRecoveryRecord {
  mode?: WorktreeDisposalMode;
  pendingGitCleanup?: boolean;
  disposalIncomplete?: boolean;
  retainedPath?: string;
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
  operationHash?: string;
  protectedRefs?: Array<{ ref: string; object: string }>;
  unavailableOperationObjects?: Array<{ field: string; object: string }>;
  restoreAttemptGitHash?: string;
  restoreRegistration?: WorktreeRestoreRegistration;
  legacyCheckoutMigration?: boolean;
  gitStatusHash?: string;
  sourceGitFingerprint?: string;
  sourceHash?: string;
  restoreAttemptHash?: string;
  sourceSizeBytes?: number;
  reclaimedSizeBytes?: number;
  verificationWarnings?: string[];
}

export interface WorktreeRecoveryInventory {
  records: WorktreeRecoveryRecord[];
  issues: string[];
}
