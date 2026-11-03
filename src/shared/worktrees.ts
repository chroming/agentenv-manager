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
  (entry.manualReviewAvailable ||
    ((Boolean(entry.pausedOperations?.length) || entry.reasons.includes("Git operation in progress") ||
      entry.reasons.includes("Git operation in progress: active writer lock")) &&
      entry.reasons.every((reason) => reason === "Git operation in progress" || reason === "Unresolved Git conflicts" ||
        reason === "Git operation in progress: active writer lock" ||
        reason === "Paused Git operation; manual recovery backup required" ||
        reason === "Index flags can hide local changes; recovery backup required" ||
        reason === "Detached commit has no branch or tag reference" ||
        /^\d+ (changed or untracked paths|ignored paths)$/.test(reason) || reason.endsWith("; confirm the task is finished")))) && entry.exists && Boolean(entry.head) &&
  !entry.main && !entry.locked && !entry.prunable && !entry.submodules && !entry.keptReason && !entry.repositoryKeptReason &&
  (entry.state === "candidate" || entry.state === "review");

export const isAutomaticCleanupCandidate = (entry: WorktreeEntry): boolean =>
  canSelectWorktreeForCleanup(entry) &&
  entry.state === "candidate" && entry.cleanupReviewAvailable &&
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

export interface WorktreeCleanupRequest { commonDir: string; path: string; allowDirty: boolean }
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
