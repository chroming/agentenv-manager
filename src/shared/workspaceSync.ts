export type WorkspaceSyncStatusKind =
  | "not-connected"
  | "up-to-date"
  | "local-changes"
  | "remote-changes"
  | "review-required"
  | "error"
  | "recovery-required";

export type WorkspaceSyncWorkingState = "checking" | "publishing" | "updating";

export interface WorkspaceSyncConnection {
  repository: string;
  branch: string;
}

export interface WorkspaceSyncStatus {
  kind: WorkspaceSyncStatusKind;
  connection?: WorkspaceSyncConnection;
  working?: WorkspaceSyncWorkingState;
  message?: string;
  lastCheckedAt?: string;
  localChangeCount: number;
  remoteChangeCount: number;
  conflictCount: number;
  immediateAgentCount: number;
}

export type WorkspaceSyncResourceKind = "profile" | "skill" | "source";
export type WorkspaceSyncChangeDirection = "local" | "remote" | "both" | "conflict";
export type WorkspaceSyncChangeAction = "add" | "update" | "delete";

export interface WorkspaceSyncChange {
  key: string;
  resourceKind: WorkspaceSyncResourceKind;
  resourceId: string;
  section: string;
  action: WorkspaceSyncChangeAction;
  direction: WorkspaceSyncChangeDirection;
  title: string;
  detail?: string;
}

export interface WorkspaceSyncReview {
  baseRevision?: string;
  remoteRevision?: string;
  changes: WorkspaceSyncChange[];
  liveSkillIds: string[];
  liveAgentIds: string[];
  canUpdate: boolean;
  canPublish: boolean;
}

export type WorkspaceSyncConflictChoice = "local" | "remote";

export interface WorkspaceSyncUpdateInput {
  expectedRemoteRevision?: string;
  conflictChoices?: Record<string, WorkspaceSyncConflictChoice>;
  acceptLiveSkillUpdates?: boolean;
}

export interface WorkspaceSyncConnectInput extends WorkspaceSyncConnection {}

export interface WorkspaceSyncOperationResult {
  status: WorkspaceSyncStatus;
  backupId?: string;
  revision?: string;
}
