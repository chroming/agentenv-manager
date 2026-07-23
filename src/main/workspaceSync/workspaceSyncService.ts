import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  WorkspaceSyncConnectInput,
  WorkspaceSyncOperationResult,
  WorkspaceSyncReview,
  WorkspaceSyncStatus,
  WorkspaceSyncUpdateInput
} from "../../shared/workspaceSync";
import type { AgentEnvPaths } from "../paths";
import type { TargetPaths } from "../../shared/types";
import type { GitSyncTransport } from "./gitSyncTransport";
import type { PortableWorkspaceCodec } from "./portableWorkspaceCodec";
import { validatePortableWorkspace } from "./portableWorkspaceValidator";
import { materializeMergedWorkspace, planWorkspaceSync, type WorkspaceSnapshotDescriptor } from "./syncPlanner";
import type { WorkspaceSyncState, WorkspaceSyncStateStore } from "./syncStateStore";
import { parseWorkspaceSyncConnection } from "./syncStateStore";
import type { WorkspaceSyncTransaction } from "./workspaceSyncTransaction";
import { pathEntryExists, replacePathAtomically } from "../fileUtils";

export interface WorkspaceSyncService {
  readStatus(): Promise<WorkspaceSyncStatus>;
  connect(input: WorkspaceSyncConnectInput): Promise<WorkspaceSyncStatus>;
  check(): Promise<WorkspaceSyncStatus>;
  review(): Promise<WorkspaceSyncReview>;
  update(input: WorkspaceSyncUpdateInput): Promise<WorkspaceSyncOperationResult>;
  publish(): Promise<WorkspaceSyncOperationResult>;
  recover(): Promise<WorkspaceSyncStatus>;
  disconnect(): Promise<WorkspaceSyncStatus>;
  cancel(): void;
  dispose(): void;
}

interface CheckedWorkspace {
  state: WorkspaceSyncState;
  local: WorkspaceSnapshotDescriptor;
  remote?: WorkspaceSnapshotDescriptor;
  base?: WorkspaceSnapshotDescriptor;
  remoteRevision?: string;
  plan: ReturnType<typeof planWorkspaceSync>;
  status: WorkspaceSyncStatus;
  operationRoot: string;
}

const emptyStatus = (): WorkspaceSyncStatus => ({
  kind: "not-connected",
  localChangeCount: 0,
  remoteChangeCount: 0,
  conflictCount: 0,
  immediateAgentCount: 0
});

const descriptorAt = async (root: string): Promise<WorkspaceSnapshotDescriptor> => {
  const validated = await validatePortableWorkspace(root);
  return { root, manifest: validated.manifest };
};

const parseUpdateInput = (value: WorkspaceSyncUpdateInput): WorkspaceSyncUpdateInput => {
  if (!value || typeof value !== "object") throw new Error("Workspace update confirmation is invalid");
  if (value.expectedRemoteRevision !== undefined && typeof value.expectedRemoteRevision !== "string") {
    throw new Error("Workspace update revision is invalid");
  }
  if (value.acceptLiveSkillUpdates !== undefined && typeof value.acceptLiveSkillUpdates !== "boolean") {
    throw new Error("Workspace live-update confirmation is invalid");
  }
  if (value.conflictChoices !== undefined) {
    if (!value.conflictChoices || typeof value.conflictChoices !== "object" || Array.isArray(value.conflictChoices)) {
      throw new Error("Workspace conflict choices are invalid");
    }
    for (const [key, choice] of Object.entries(value.conflictChoices)) {
      if (!key || (choice !== "local" && choice !== "remote")) {
        throw new Error("Workspace conflict choices are invalid");
      }
    }
  }
  return value;
};

const statusFor = (checked: Omit<CheckedWorkspace, "status">): WorkspaceSyncStatus => {
  const conflicts = checked.plan.review.changes.filter((change) => change.direction === "conflict").length;
  const local = checked.plan.review.changes.filter((change) => change.direction === "local" || change.direction === "conflict").length;
  const remote = checked.plan.review.changes.filter((change) => change.direction === "remote" || change.direction === "conflict").length;
  const kind = conflicts || (local && remote)
    ? "review-required"
    : remote
      ? "remote-changes"
      : local
        ? "local-changes"
        : "up-to-date";
  return {
    kind,
    connection: { repository: checked.state.repository, branch: checked.state.branch },
    lastCheckedAt: checked.state.lastCheckedAt,
    localChangeCount: local,
    remoteChangeCount: remote,
    conflictCount: conflicts,
    immediateAgentCount: checked.plan.review.liveAgentIds.length
  };
};

export const createWorkspaceSyncService = (input: {
  paths: AgentEnvPaths;
  codec: PortableWorkspaceCodec;
  stateStore: WorkspaceSyncStateStore;
  transaction: WorkspaceSyncTransaction;
  loadTransport(): Promise<GitSyncTransport>;
  targetPathsProvider(): Promise<TargetPaths[]>;
  findManagedInstallPaths(libraryId: string, targetPaths: TargetPaths[]): Promise<string[]>;
}): WorkspaceSyncService => {
  let lastStatus = emptyStatus();
  let transport: GitSyncTransport | undefined;
  let operationQueue = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const loadTransport = async () => transport ??= await input.loadTransport();
  const baseRoot = join(input.paths.workspaceSyncCacheDir, "base");

  const exportLocal = async (state: WorkspaceSyncState, destination: string) => {
    const manifest = await input.codec.exportSnapshot(destination, state.workspaceId);
    return { root: destination, manifest };
  };

  const loadBase = async (state: WorkspaceSyncState) => {
    if (!state.baseSnapshotHash) return undefined;
    try {
      const base = await descriptorAt(baseRoot);
      return base.manifest.snapshotHash === state.baseSnapshotHash ? base : undefined;
    } catch {
      return undefined;
    }
  };

  const liveImpactFor = async (plan: ReturnType<typeof planWorkspaceSync>) => {
    const candidateIds = [...new Set(plan.review.changes
      .filter((change) => change.resourceKind === "skill" && change.section === "content" &&
        (change.direction === "remote" || change.direction === "conflict"))
      .map((change) => change.resourceId))];
    const targetPaths = await input.targetPathsProvider();
    const live: string[] = [];
    const agents: string[] = [];
    for (const id of candidateIds) {
      for (const target of targetPaths) {
        const installs = await input.findManagedInstallPaths(id, [target]);
        for (const path of installs) {
          try {
            if ((await lstat(path)).isSymbolicLink()) {
              live.push(id);
              agents.push(target.targetId);
              break;
            }
          } catch {
            // A stale deployment is handled by the existing Target reconciliation flow.
          }
        }
      }
    }
    return { liveSkillIds: [...new Set(live)], liveAgentIds: [...new Set(agents)] };
  };

  const performCheck = async (options: {
    state?: WorkspaceSyncState;
    persist?: boolean;
    useBase?: boolean;
  } = {}): Promise<CheckedWorkspace> => {
    const operationRoot = join(input.paths.workspaceSyncCacheDir, "operations", randomUUID());
    const localRoot = join(operationRoot, "local");
    const remoteRoot = join(operationRoot, "remote");
    const persist = options.persist !== false;
    let state = options.state ?? await input.stateStore.read();
    if (!state) throw new Error("Workspace Sync is not connected");
    try {
      await mkdir(operationRoot, { recursive: true, mode: 0o700 });
      let local = await exportLocal(state, localRoot);
      const remoteResult = await (await loadTransport()).fetch(
        { repository: state.repository, branch: state.branch },
        remoteRoot,
        state.baseRevision
      );
      const remote = remoteResult.snapshotRoot ? await descriptorAt(remoteResult.snapshotRoot) : undefined;
      if (remote && remote.manifest.workspaceId !== state.workspaceId) {
        if (state.baseRevision) {
          throw new Error("The remote repository belongs to a different AgentEnv Workspace");
        }
        state = { ...state, workspaceId: remote.manifest.workspaceId };
        if (persist) await input.stateStore.write(state);
        local = await exportLocal(state, localRoot);
      }
      let base = options.useBase === false ? undefined : await loadBase(state);
      if (remote && local.manifest.snapshotHash === remote.manifest.snapshotHash &&
        (base?.manifest.snapshotHash !== remote.manifest.snapshotHash || state.baseRevision !== remoteResult.revision)) {
        if (persist) {
          await replacePathAtomically(baseRoot, (path) => cp(remote.root, path, { recursive: true }));
        }
        base = { root: baseRoot, manifest: remote.manifest };
        state = {
          ...state,
          baseRevision: remoteResult.revision,
          baseSnapshotHash: remote.manifest.snapshotHash
        };
      }
      let plan = planWorkspaceSync({ base, local, remote, baseRevision: state.baseRevision, remoteRevision: remoteResult.revision });
      const liveImpact = await liveImpactFor(plan);
      plan = planWorkspaceSync({
        base,
        local,
        remote,
        baseRevision: state.baseRevision,
        remoteRevision: remoteResult.revision,
        ...liveImpact
      });
      const nextState = {
        ...state,
        lastCheckedRevision: remoteResult.revision,
        lastCheckedAt: new Date().toISOString()
      };
      if (persist) await input.stateStore.write(nextState);
      const partial = { state: nextState, local, remote, base, remoteRevision: remoteResult.revision, plan, operationRoot };
      const status = statusFor(partial);
      if (persist) lastStatus = status;
      return { ...partial, status };
    } catch (error) {
      await rm(operationRoot, { recursive: true, force: true });
      throw error;
    }
  };

  const checkInternal = async () => {
    if (await input.transaction.isRecoveryRequired()) {
      lastStatus = { ...lastStatus, kind: "recovery-required", working: undefined, message: "A Workspace update needs recovery before Sync can continue." };
      return lastStatus;
    }
    const state = await input.stateStore.read();
    if (!state) return lastStatus = emptyStatus();
    lastStatus = { ...lastStatus, connection: { repository: state.repository, branch: state.branch }, working: "checking" };
    let checked: CheckedWorkspace | undefined;
    try {
      checked = await performCheck();
      return checked.status;
    } catch (error) {
      return lastStatus = {
        ...lastStatus,
        kind: "error",
        working: undefined,
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (checked) await rm(checked.operationRoot, { recursive: true, force: true });
    }
  };

  const reviewInternal = async () => {
    if (await input.transaction.isRecoveryRequired()) {
      throw new Error("Recover the interrupted Workspace update before reviewing Sync changes.");
    }
    const checked = await performCheck();
    try {
      return checked.plan.review;
    } finally {
      await rm(checked.operationRoot, { recursive: true, force: true });
    }
  };

  const updateInternal = async (rawUpdateInput: WorkspaceSyncUpdateInput) => {
    const updateInput = parseUpdateInput(rawUpdateInput);
    lastStatus = { ...lastStatus, working: "updating" };
    let checked: CheckedWorkspace | undefined;
    try {
      checked = await performCheck();
      if (!checked.remote) throw new Error("The remote Workspace is empty. Publish this Mac first.");
      if (updateInput.expectedRemoteRevision !== undefined && updateInput.expectedRemoteRevision !== checked.remoteRevision) {
        throw new Error("The remote Workspace changed. Review it again before updating this Mac.");
      }
      if (checked.plan.review.liveSkillIds.length && !updateInput.acceptLiveSkillUpdates) {
        throw new Error("This update changes linked Skills immediately. Confirm the live Agent impact first.");
      }
      const mergedRoot = join(checked.operationRoot, "merged");
      const merged = await materializeMergedWorkspace({
        plan: checked.plan,
        local: checked.local,
        remote: checked.remote,
        destination: mergedRoot,
        conflictChoices: updateInput.conflictChoices
      });
      await validatePortableWorkspace(merged.root);
      const result = await input.transaction.apply(merged.root);
      const previousBaseRoot = join(checked.operationRoot, "previous-base");
      if (checked.base) await cp(checked.base.root, previousBaseRoot, { recursive: true });
      const state = {
        ...checked.state,
        baseRevision: checked.remoteRevision,
        baseSnapshotHash: checked.remote.manifest.snapshotHash,
        lastCheckedRevision: checked.remoteRevision,
        lastCheckedAt: new Date().toISOString()
      };
      try {
        await replacePathAtomically(baseRoot, (path) => cp(checked!.remote!.root, path, { recursive: true }));
        await input.stateStore.write(state);
      } catch (stateError) {
        try {
          await input.transaction.restore(result.backupId);
        } catch (restoreError) {
          throw new Error(
            `Workspace content changed but Sync state could not be saved, and recovery is required: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
            { cause: stateError }
          );
        }
        if (checked.base) {
          await replacePathAtomically(baseRoot, (path) => cp(previousBaseRoot, path, { recursive: true })).catch(() => undefined);
        } else {
          await rm(baseRoot, { recursive: true, force: true }).catch(() => undefined);
        }
        await input.stateStore.write(checked.state).catch(() => undefined);
        throw stateError;
      }
      const postUpdatePlan = planWorkspaceSync({ base: checked.remote, local: merged, remote: checked.remote });
      lastStatus = { ...statusFor({ ...checked, state, local: merged, base: checked.remote, plan: postUpdatePlan }), working: undefined };
      return { status: lastStatus, backupId: result.backupId, revision: checked.remoteRevision };
    } catch (error) {
      lastStatus = { ...lastStatus, working: undefined };
      throw error;
    } finally {
      if (checked) await rm(checked.operationRoot, { recursive: true, force: true });
    }
  };

  const publishInternal = async () => {
    lastStatus = { ...lastStatus, working: "publishing" };
    let checked: CheckedWorkspace | undefined;
    try {
      checked = await performCheck();
      const blockers = checked.plan.review.changes.filter((change) => change.direction === "remote" || change.direction === "conflict");
      if (blockers.length) throw new Error("Review and update this Mac before publishing over remote changes.");
      const revision = await (await loadTransport()).publish({
        connection: { repository: checked.state.repository, branch: checked.state.branch },
        snapshotRoot: checked.local.root,
        expectedRevision: checked.remoteRevision,
        workDir: join(checked.operationRoot, "publish")
      });
      await replacePathAtomically(baseRoot, (path) => cp(checked!.local.root, path, { recursive: true }));
      const state = {
        ...checked.state,
        baseRevision: revision,
        baseSnapshotHash: checked.local.manifest.snapshotHash,
        lastCheckedRevision: revision,
        lastCheckedAt: new Date().toISOString()
      };
      await input.stateStore.write(state);
      lastStatus = {
        kind: "up-to-date",
        connection: { repository: state.repository, branch: state.branch },
        lastCheckedAt: state.lastCheckedAt,
        localChangeCount: 0,
        remoteChangeCount: 0,
        conflictCount: 0,
        immediateAgentCount: 0
      };
      return { status: lastStatus, revision };
    } catch (error) {
      lastStatus = { ...lastStatus, working: undefined };
      throw error;
    } finally {
      if (checked) await rm(checked.operationRoot, { recursive: true, force: true });
    }
  };

  return {
    readStatus: async () => {
      if (await input.transaction.isRecoveryRequired()) {
        return { ...lastStatus, kind: "recovery-required", working: undefined, message: "A Workspace update needs recovery before Sync can continue." };
      }
      const state = await input.stateStore.read();
      if (!state) return emptyStatus();
      return {
        ...lastStatus,
        connection: { repository: state.repository, branch: state.branch },
        working: lastStatus.connection ? lastStatus.working : "checking"
      };
    },
    connect: (connection) => serialize(async () => {
      const parsed = parseWorkspaceSyncConnection(connection);
      const previousState = await input.stateStore.read();
      if (
        previousState?.repository === parsed.repository &&
        previousState.branch === parsed.branch
      ) {
        return checkInternal();
      }

      const candidateState: WorkspaceSyncState = {
        formatVersion: 1,
        ...parsed,
        workspaceId: randomUUID()
      };
      const checked = await performCheck({
        state: candidateState,
        persist: false,
        useBase: false
      });
      const previousBaseRoot = join(checked.operationRoot, "previous-base");
      let hadPreviousBase = false;
      try {
        if (await pathEntryExists(baseRoot)) {
          await cp(baseRoot, previousBaseRoot, { recursive: true });
          hadPreviousBase = true;
        }

        const hasAcceptedBase =
          checked.remote &&
          checked.local.manifest.snapshotHash === checked.remote.manifest.snapshotHash;
        const connectionState = hasAcceptedBase
          ? {
              ...checked.state,
              baseRevision: undefined,
              baseSnapshotHash: undefined
            }
          : checked.state;
        await input.stateStore.write(connectionState);
        if (hasAcceptedBase) {
          await replacePathAtomically(baseRoot, (path) => cp(checked.remote!.root, path, { recursive: true }));
          await input.stateStore.write(checked.state);
        } else {
          await rm(baseRoot, { recursive: true, force: true });
        }
        lastStatus = checked.status;
        return lastStatus;
      } catch (error) {
        if (previousState) {
          await input.stateStore.write(previousState).catch(() => undefined);
        } else {
          await input.stateStore.disconnect().catch(() => undefined);
        }
        if (hadPreviousBase) {
          await replacePathAtomically(baseRoot, (path) =>
            cp(previousBaseRoot, path, { recursive: true })
          ).catch(() => undefined);
        } else {
          await rm(baseRoot, { recursive: true, force: true }).catch(() => undefined);
        }
        throw error;
      } finally {
        await rm(checked.operationRoot, { recursive: true, force: true });
      }
    }),
    check: () => serialize(checkInternal),
    review: () => serialize(reviewInternal),
    update: (updateInput) => serialize(() => updateInternal(updateInput)),
    publish: () => serialize(publishInternal),
    recover: () => serialize(async () => {
      await input.transaction.recover();
      return checkInternal();
    }),
    disconnect: () => serialize(async () => {
      transport?.cancel();
      await input.stateStore.disconnect();
      return lastStatus = emptyStatus();
    }),
    cancel: () => transport?.cancel(),
    dispose: () => transport?.dispose()
  };
};
