import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemoteDevice } from "../../shared/types";
import type { SshTransport } from "../remoteDevices/systemSshTransport";
import { hashFileContent } from "../filesystemIntegrity";
import { isMissingFileError } from "../fileUtils";
import { hashSkillContent } from "../skillContentHash";
import type { ProjectRecoveryReceipt, ProjectRecoveryStore } from "./projectRecoveryStore";
import { remoteFileGuard, remoteTreeGuard, RemoteProjectPreconditionError } from "./remoteProjectGuards";
import { archiveRemoteDirectory, createTarArchiveFromDirectory, deploySkillToRemote,
  extractTarArchiveSafely, readRemoteTextFile, removeRemotePath, writeRemoteTextFile } from "./remoteProjectTransport";

export interface RemoteProjectContext {
  device: RemoteDevice;
  transport: SshTransport;
  project: { rootPath: string };
}

export const remoteProjectIdentity = ({ device, project }: RemoteProjectContext) =>
  hashFileContent(JSON.stringify([device.id, device.host, device.user ?? "", device.port ?? 22, project.rootPath]));

export const readRemoteProjectState = async (
  context: RemoteProjectContext, path: string, kind: "instructions" | "skill"
): Promise<{ hash: string; guard: string[]; archive?: Buffer }> => {
  const { device, transport } = context;
  try {
    if (kind === "instructions") {
      const hash = hashFileContent(await readRemoteTextFile(device, transport, path));
      return { hash, guard: remoteFileGuard(path, hash) };
    }
    const archive = await archiveRemoteDirectory(device, transport, path);
    const temporary = await mkdtemp(join(tmpdir(), "agentenv-remote-skill-"));
    try {
      await extractTarArchiveSafely(archive, temporary);
      return { hash: await hashSkillContent(temporary), guard: await remoteTreeGuard(temporary, path), archive };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return { hash: "absent", guard: remoteFileGuard(path, "absent") };
  }
};

export const restoreRemoteProjectReceipt = async (
  context: RemoteProjectContext,
  receipt: ProjectRecoveryReceipt,
  store: ProjectRecoveryStore,
  status: "restored" | "failed-restored" = "restored"
) => {
  const { device, transport } = context;
  if (receipt.remoteIdentity !== remoteProjectIdentity(context)) {
    throw new Error("Remote recovery point does not match this SSH device and Workspace. Check the saved device settings before restoring.");
  }
  const current = await readRemoteProjectState(context, receipt.path, receipt.kind);
  if (current.hash === receipt.originalHash) {
    await store.update(receipt.id, status);
    return;
  }
  if (current.hash !== receipt.appliedHash) {
    throw new Error("Remote Workspace resource changed after this recovery point. Refresh before restoring.");
  }
  if (receipt.originalWasAbsent) {
    await removeRemotePath(device, transport, receipt.path, current.guard);
  } else if (receipt.kind === "instructions") {
    const original = Buffer.from(receipt.originalContentBase64 ?? "", "base64").toString("utf8");
    if (hashFileContent(original) !== receipt.originalHash) throw new Error("Workspace recovery backup failed its integrity check");
    await writeRemoteTextFile(device, transport, receipt.path, original, current.hash);
  } else {
    const backup = store.directoryBackupPath(receipt.id);
    const archive = await createTarArchiveFromDirectory(backup);
    const temporary = await mkdtemp(join(tmpdir(), "agentenv-remote-restore-"));
    try {
      await extractTarArchiveSafely(archive, temporary);
      if (await hashSkillContent(temporary) !== receipt.originalHash) throw new Error("Workspace recovery backup failed its integrity check");
      await deploySkillToRemote(device, transport, archive, receipt.path, current.guard);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const restored = await readRemoteProjectState(context, receipt.path, receipt.kind);
  if (restored.hash !== receipt.originalHash) throw new Error("Remote Workspace recovery verification failed");
  await store.update(receipt.id, status);
};

export const recoverFailedRemoteProjectMutation = async (
  context: RemoteProjectContext, receipt: ProjectRecoveryReceipt, store: ProjectRecoveryStore, cause?: unknown
) => {
  if (cause instanceof RemoteProjectPreconditionError) {
    await store.update(receipt.id, "failed-restored");
    return;
  }
  try {
    await restoreRemoteProjectReceipt(context, receipt, store, "failed-restored");
  } catch (error) {
    await store.update(receipt.id, "recovery-required");
    throw new Error(`Remote Workspace change failed and recovery requires attention: ${error instanceof Error ? error.message : String(error)}`);
  }
};
