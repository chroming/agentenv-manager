import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import type {
  AddProjectSkillInput,
  AddProjectSkillsInput,
  CreateProjectInstructionInput,
  ProjectInstructionDraft,
  ProjectMutationResult,
  ProjectSkillBatchMutationResult,
  ProjectResourceFile,
  RemoveProjectSkillInput,
  SaveProjectResourceInput
} from "../../shared/types";
import { isMissingFileError, pathEntryExists, writeAtomic } from "../fileUtils";
import { copyPathVerified, hashFileContent } from "../filesystemIntegrity";
import { hashSkillContent } from "../skillContentHash";
import { copySkillEntries } from "../skillDeployment";
import { pathsEqual } from "../platformPaths";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { ProjectEnvironmentService } from "./projectEnvironmentService";
import type { ProjectRecoveryStore } from "./projectRecoveryStore";
import type { ProjectStore } from "./projectStore";
import type { RemoteDeviceStore } from "../remoteDevices/remoteDeviceStore";
import type { SshTransport } from "../remoteDevices/systemSshTransport";
import {
  archiveRemoteDirectory,
  createTarArchiveFromDirectory,
  deploySkillToRemote,
  extractTarArchiveSafely,
  readRemoteTextFile,
  removeRemotePath,
  writeRemoteTextFile
} from "./remoteProjectTransport";

const MAX_PROJECT_TEXT_BYTES = 2 * 1024 * 1024;

export interface ProjectMutationServiceOptions {
  environmentService: ProjectEnvironmentService;
  recoveryStore: ProjectRecoveryStore;
  skillLibraryStore: Pick<SkillLibraryStore, "listSkills">;
  enabledAgentIds(): Promise<string[]>;
  projectStore?: ProjectStore;
  deviceStore?: RemoteDeviceStore;
  sshTransport?: SshTransport;
}

export interface ProjectMutationService {
  read(projectId: string, resourceId: string): Promise<ProjectResourceFile>;
  prepareInstruction(projectId: string, agentId: string): Promise<ProjectInstructionDraft>;
  save(input: SaveProjectResourceInput): Promise<ProjectMutationResult>;
  createInstruction(input: CreateProjectInstructionInput): Promise<ProjectMutationResult>;
  addSkill(input: AddProjectSkillInput): Promise<ProjectMutationResult>;
  addSkills(input: AddProjectSkillsInput): Promise<ProjectSkillBatchMutationResult>;
  removeSkill(input: RemoveProjectSkillInput): Promise<ProjectMutationResult>;
  restore(receiptId: string): Promise<ProjectMutationResult>;
}

export const createProjectMutationService = (
  options: ProjectMutationServiceOptions
): ProjectMutationService => {
  const {
    environmentService,
    recoveryStore,
    skillLibraryStore,
    enabledAgentIds,
    projectStore,
    deviceStore,
    sshTransport
  } = options;

  const getProjectAndDevice = async (projectId: string) => {
    if (!projectStore) return undefined;
    const project = (await projectStore.listProjects()).find((p) => p.id === projectId);
    if (!project?.deviceId) return undefined;
    const device = await deviceStore?.get(project.deviceId).catch(() => undefined);
    if (!device) throw new Error(`Remote SSH device not found: ${project.deviceId}`);
    if (!sshTransport) throw new Error("SSH transport is not available");
    return { project, device, transport: sshTransport };
  };

  const ensureRegularProjectDirectory = async (projectRoot: string, target: string) => {
    const relativePath = relative(projectRoot, target);
    if (!relativePath || relativePath === ".") return [];
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error("Project directory destination escapes its root");
    }
    const created: string[] = [];
    let current = projectRoot;
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      current = join(current, segment);
      let entry;
      try {
        entry = await lstat(current);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        await mkdir(current);
        created.push(current);
        continue;
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`Project directory component is not a regular directory: ${current}`);
      }
    }
    return created;
  };

  const removeCreatedEmptyDirectories = async (directories: string[]) => {
    for (const directory of [...directories].reverse()) {
      try {
        await rmdir(directory);
      } catch (error) {
        if (!isMissingFileError(error)) break;
      }
    }
  };

  const assertPortableSkill = async (rootPath: string) => {
    const checkTree = async (current: string) => {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          throw new Error(`Project Skill contains an unsafe symbolic link: ${join(current, entry.name)}`);
        }
        if (entry.isDirectory()) await checkTree(join(current, entry.name));
      }
    };
    await checkTree(rootPath);
  };

  const copySkillAtomically = async (
    source: string,
    destination: string,
    expectedHash: string,
    excludeLibraryMetadata = false,
    replaceExisting = false
  ) => {
    const staging = join(dirname(destination), `.agentenv-project-skill-${randomUUID()}`);
    try {
      if (excludeLibraryMetadata) await copySkillEntries(source, staging);
      else await copyPathVerified(source, staging, { recursive: true });
      if (await hashSkillContent(staging) !== expectedHash) {
        throw new Error("Project Skill copy verification failed before commit");
      }
      if (replaceExisting) await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      if (await hashSkillContent(destination) !== expectedHash) {
        throw new Error("Project Skill copy verification failed after commit");
      }
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const resolveInstruction = async (projectId: string, resourceId: string) => {
    const resource = await environmentService.findResource(
      projectId,
      resourceId,
      await enabledAgentIds()
    );
    if (resource.kind !== "instructions" || resource.state !== "ready") {
      throw new Error("Only safe, regular Project instruction files can be edited");
    }
    if (!resource.editable) throw new Error("This Project instruction is inspect-only");
    return resource;
  };

  const read = async (projectId: string, resourceId: string): Promise<ProjectResourceFile> => {
    const resource = await resolveInstruction(projectId, resourceId);
    const remoteContext = await getProjectAndDevice(projectId);
    let content: string;
    if (remoteContext) {
      content = await readRemoteTextFile(remoteContext.device, remoteContext.transport, resource.absolutePath);
    } else {
      content = await readFile(resource.absolutePath, "utf8");
    }
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_PROJECT_TEXT_BYTES) throw new Error("Project instruction file is too large to edit safely");
    return {
      resourceId,
      name: resource.name,
      path: resource.absolutePath,
      content,
      contentHash: hashFileContent(content),
      modifiedAt: resource.modifiedAt ?? new Date(0).toISOString(),
      editable: true,
      gitState: resource.gitState
    };
  };

  const save = async (input: SaveProjectResourceInput): Promise<ProjectMutationResult> => {
    if (Buffer.byteLength(input.content) > MAX_PROJECT_TEXT_BYTES) {
      throw new Error("Project instruction file is too large to save safely");
    }
    const current = await read(input.projectId, input.resourceId);
    if (current.contentHash !== input.expectedHash) {
      throw new Error("Project instruction changed outside AgentEnv. Reload it before saving.");
    }
    const appliedHash = hashFileContent(input.content);
    if (appliedHash === current.contentHash) {
      return { status: "no-op", contentHash: current.contentHash };
    }
    await recoveryStore.assertWritablePath(current.path);
    const receipt = await recoveryStore.prepare({
      projectId: input.projectId,
      resourceId: input.resourceId,
      path: current.path,
      kind: "instructions",
      originalContentBase64: Buffer.from(current.content, "utf8").toString("base64"),
      originalHash: current.contentHash,
      appliedHash
    });

    const remoteContext = await getProjectAndDevice(input.projectId);
    if (remoteContext) {
      try {
        await writeRemoteTextFile(remoteContext.device, remoteContext.transport, current.path, input.content);
        const verified = hashFileContent(await readRemoteTextFile(remoteContext.device, remoteContext.transport, current.path));
        if (verified !== appliedHash) throw new Error("Project instruction verification failed after save");
        await recoveryStore.update(receipt.id, "committed");
        return { status: "saved", contentHash: appliedHash, receiptId: receipt.id };
      } catch (error) {
        try {
          await writeRemoteTextFile(remoteContext.device, remoteContext.transport, current.path, current.content);
          await recoveryStore.update(receipt.id, "failed-restored");
        } catch (restoreError) {
          await recoveryStore.update(receipt.id, "recovery-required");
          throw new Error(`Project save failed and recovery requires attention: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
        }
        throw error;
      }
    }

    try {
      await writeAtomic(current.path, input.content);
      const verified = hashFileContent(await readFile(current.path));
      if (verified !== appliedHash) throw new Error("Project instruction verification failed after save");
      await recoveryStore.update(receipt.id, "committed");
      return { status: "saved", contentHash: appliedHash, receiptId: receipt.id };
    } catch (error) {
      try {
        await writeAtomic(current.path, current.content);
        if (hashFileContent(await readFile(current.path)) !== current.contentHash) {
          throw new Error("Original Project instruction hash did not restore");
        }
        await recoveryStore.update(receipt.id, "failed-restored");
      } catch (restoreError) {
        await recoveryStore.update(receipt.id, "recovery-required");
        throw new Error(`Project save failed and recovery requires attention: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
      throw error;
    }
  };

  const service: ProjectMutationService = {
    read,
    prepareInstruction: async (projectId, agentId) => {
      const { destination } = await environmentService.resolveInstructionDestination(projectId, agentId);
      const remoteContext = await getProjectAndDevice(projectId);
      if (remoteContext) {
        let exists = false;
        try {
          await readRemoteTextFile(remoteContext.device, remoteContext.transport, destination);
          exists = true;
        } catch {
          exists = false;
        }
        if (exists) throw new Error("Project instruction already exists. Refresh the Project before editing it.");
      } else if (await pathEntryExists(destination)) {
        throw new Error("Project instruction already exists. Refresh the Project before editing it.");
      }
      return {
        agentId,
        name: dirname(destination) === destination ? destination : destination.split(/[\\/]/).pop()!,
        path: destination,
        content: "",
        contentHash: "absent",
        editable: true
      };
    },
    save,
    createInstruction: async (input) => {
      if (Buffer.byteLength(input.content) > MAX_PROJECT_TEXT_BYTES) {
        throw new Error("Project instruction file is too large to save safely");
      }
      const { projectRoot, destination } = await environmentService.resolveInstructionDestination(
        input.projectId,
        input.agentId
      );
      const remoteContext = await getProjectAndDevice(input.projectId);
      if (remoteContext) {
        let exists = false;
        try {
          await readRemoteTextFile(remoteContext.device, remoteContext.transport, destination);
          exists = true;
        } catch {
          exists = false;
        }
        if (exists) {
          throw new Error("Project instruction changed outside AgentEnv. Refresh before saving.");
        }
        const appliedHash = hashFileContent(input.content);
        await recoveryStore.assertWritablePath(destination);
        const receipt = await recoveryStore.prepare({
          projectId: input.projectId,
          resourceId: `instruction-create:${input.agentId}`,
          agentId: input.agentId,
          path: destination,
          kind: "instructions",
          originalWasAbsent: true,
          originalHash: "absent",
          appliedHash
        });
        try {
          await writeRemoteTextFile(remoteContext.device, remoteContext.transport, destination, input.content);
          const verified = hashFileContent(await readRemoteTextFile(remoteContext.device, remoteContext.transport, destination));
          if (verified !== appliedHash) throw new Error("Project instruction verification failed after save");
          await recoveryStore.update(receipt.id, "committed");
          return { status: "saved", contentHash: appliedHash, receiptId: receipt.id };
        } catch (error) {
          await removeRemotePath(remoteContext.device, remoteContext.transport, destination).catch(() => undefined);
          await recoveryStore.update(receipt.id, "failed-restored");
          throw error;
        }
      }
      if (await pathEntryExists(destination)) {
        throw new Error("Project instruction changed outside AgentEnv. Refresh before saving.");
      }
      const appliedHash = hashFileContent(input.content);
      await recoveryStore.assertWritablePath(destination);
      const receipt = await recoveryStore.prepare({
        projectId: input.projectId,
        resourceId: `instruction-create:${input.agentId}`,
        agentId: input.agentId,
        path: destination,
        kind: "instructions",
        originalWasAbsent: true,
        originalHash: "absent",
        appliedHash
      });
      let createdParents: string[] = [];
      try {
        createdParents = await ensureRegularProjectDirectory(projectRoot, dirname(destination));
        await writeAtomic(destination, input.content, { expectedTargetHash: undefined });
        const verified = hashFileContent(await readFile(destination));
        if (verified !== appliedHash) throw new Error("Project instruction verification failed after save");
        await recoveryStore.update(receipt.id, "committed");
        return { status: "saved", contentHash: appliedHash, receiptId: receipt.id };
      } catch (error) {
        const currentHash = await readFile(destination)
          .then(
            (content) => hashFileContent(content),
            (readError) => isMissingFileError(readError) ? "absent" : "unreadable"
          );
        if (currentHash === appliedHash) await rm(destination).catch(() => undefined);
        const restored = currentHash !== "unreadable" && (
          currentHash !== appliedHash || !await pathEntryExists(destination)
        );
        await removeCreatedEmptyDirectories(createdParents);
        await recoveryStore.update(receipt.id, restored ? "failed-restored" : "recovery-required");
        if (!restored) throw new Error("Project instruction creation failed and recovery requires attention");
        throw error;
      }
    },
    addSkill: async (input) => {
      const library = (await skillLibraryStore.listSkills()).find((skill) => skill.id === input.libraryId);
      if (!library) throw new Error(`Library Skill not found: ${input.libraryId}`);
      if (!await pathEntryExists(join(library.path, "SKILL.md"))) {
        throw new Error(`Library Skill is unavailable: ${library.id}`);
      }
      await assertPortableSkill(library.path);
      const sourceHash = await hashSkillContent(library.path);
      const { projectRoot, skillRoot, destination } = await environmentService.resolveSkillDestination(
        input.projectId,
        input.locationId,
        library.id,
        await enabledAgentIds()
      );

      const remoteContext = await getProjectAndDevice(input.projectId);
      if (remoteContext) {
        let existingHash = "absent";
        let existingArchive: Buffer | undefined;
        try {
          existingArchive = await archiveRemoteDirectory(remoteContext.device, remoteContext.transport, destination);
          const tempCheckDir = join(tmpdir(), `check-skill-${randomUUID()}`);
          await extractTarArchiveSafely(existingArchive, tempCheckDir);
          existingHash = await hashSkillContent(tempCheckDir).catch(() => "unreadable");
          await rm(tempCheckDir, { recursive: true, force: true }).catch(() => undefined);
          if (existingHash === sourceHash) {
            return { status: "no-op", contentHash: sourceHash };
          }
          if (input.conflictResolution !== "replace") {
            throw new Error(`Project Skill replacement requires an explicit replacement choice: ${destination}`);
          }
        } catch (e: unknown) {
          if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
        }

        await recoveryStore.assertWritablePath(destination);
        const receipt = await recoveryStore.prepareDirectory({
          projectId: input.projectId,
          resourceId: `skill-add:${input.locationId}:${library.id}`,
          path: destination,
          originalHash: existingHash,
          appliedHash: sourceHash,
          originalWasAbsent: existingHash === "absent",
          sourcePath: undefined
        });
        if (existingArchive && existingHash !== "absent") {
          const backupDest = recoveryStore.directoryBackupPath(receipt.id);
          await extractTarArchiveSafely(existingArchive, backupDest);
        }
        try {
          const tarToDeploy = await createTarArchiveFromDirectory(library.path);
          await deploySkillToRemote(remoteContext.device, remoteContext.transport, tarToDeploy, destination);
          await recoveryStore.update(receipt.id, "committed");
          return { status: "saved", contentHash: sourceHash, receiptId: receipt.id };
        } catch (error) {
          if (existingArchive && existingHash !== "absent") {
            await deploySkillToRemote(remoteContext.device, remoteContext.transport, existingArchive, destination).catch(() => undefined);
          } else {
            await removeRemotePath(remoteContext.device, remoteContext.transport, destination).catch(() => undefined);
          }
          await recoveryStore.update(receipt.id, "failed-restored");
          throw error;
        }
      }

      let existingHash = "absent";
      if (await pathEntryExists(destination)) {
        const existing = await lstat(destination);
        if (!existing.isDirectory() || existing.isSymbolicLink()) {
          throw new Error(`Project Skill destination is not a regular directory: ${destination}`);
        }
        await assertPortableSkill(destination);
        existingHash = await hashSkillContent(destination);
        if (existingHash === sourceHash) {
          return { status: "no-op", contentHash: sourceHash };
        }
        if (input.conflictResolution !== "replace") {
          throw new Error(`Project Skill replacement requires an explicit replacement choice: ${destination}`);
        }
      }
      await recoveryStore.assertWritablePath(destination);
      const receipt = await recoveryStore.prepareDirectory({
        projectId: input.projectId,
        resourceId: `skill-add:${input.locationId}:${library.id}`,
        path: destination,
        originalHash: existingHash,
        appliedHash: sourceHash,
        originalWasAbsent: existingHash === "absent",
        sourcePath: existingHash === "absent" ? undefined : destination
      });
      let createdParents: string[] = [];
      try {
        createdParents = await ensureRegularProjectDirectory(projectRoot, skillRoot);
        await copySkillAtomically(
          library.path,
          destination,
          sourceHash,
          true,
          existingHash !== "absent"
        );
        await recoveryStore.update(receipt.id, "committed");
        return { status: "saved", contentHash: sourceHash, receiptId: receipt.id };
      } catch (error) {
        const currentHash = await pathEntryExists(destination)
          ? await hashSkillContent(destination).catch(() => "unreadable")
          : "absent";
        if (currentHash === sourceHash) await rm(destination, { recursive: true, force: true }).catch(() => undefined);
        if (existingHash !== "absent" && !await pathEntryExists(destination)) {
          await copySkillAtomically(
            recoveryStore.directoryBackupPath(receipt.id),
            destination,
            existingHash
          ).catch(() => undefined);
        }
        await removeCreatedEmptyDirectories(createdParents);
        const restored = existingHash === "absent"
          ? !await pathEntryExists(destination)
          : await pathEntryExists(destination) && await hashSkillContent(destination).catch(() => "unreadable") === existingHash;
        await recoveryStore.update(receipt.id, restored ? "failed-restored" : "recovery-required");
        if (!restored) throw new Error("Project Skill add failed and recovery requires attention");
        throw error;
      }
    },
    addSkills: async (input) => {
      const results: ProjectSkillBatchMutationResult["results"] = [];
      try {
        for (const item of input.items) {
          results.push({
            libraryId: item.libraryId,
            ...await service.addSkill({
              projectId: input.projectId,
              locationId: input.locationId,
              libraryId: item.libraryId,
              conflictResolution: item.conflictResolution
            })
          });
        }
      } catch (error) {
        const rollbackErrors: string[] = [];
        for (const result of [...results].reverse()) {
          if (!result.receiptId) continue;
          try {
            await service.restore(result.receiptId);
          } catch (rollbackError) {
            rollbackErrors.push(
              rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            );
          }
        }
        if (rollbackErrors.length > 0) {
          throw new Error(
            `Workspace Skill batch failed and recovery requires attention: ${rollbackErrors.join("; ")}`
          );
        }
        throw error;
      }
      return {
        status: results.every((result) => result.status === "no-op") ? "no-op" : "saved",
        results
      };
    },
    removeSkill: async (input) => {
      const resource = await environmentService.findResource(
        input.projectId,
        input.resourceId,
        await enabledAgentIds()
      );
      if (resource.kind !== "skill" || !resource.editable || resource.state === "unsafe") {
        throw new Error("Only safe Project Skills can be removed");
      }
      await environmentService.assertProjectSkillPath(input.projectId, resource.absolutePath);

      const remoteContext = await getProjectAndDevice(input.projectId);
      if (remoteContext) {
        if (resource.contentHash !== input.expectedHash) {
          throw new Error("Project Skill changed outside AgentEnv. Refresh before removing it.");
        }
        await recoveryStore.assertWritablePath(resource.absolutePath);
        const receipt = await recoveryStore.prepareDirectory({
          projectId: input.projectId,
          resourceId: input.resourceId,
          path: resource.absolutePath,
          originalHash: resource.contentHash ?? "absent",
          appliedHash: "absent",
          originalWasAbsent: false,
          sourcePath: undefined
        });
        const backupArchive = await archiveRemoteDirectory(remoteContext.device, remoteContext.transport, resource.absolutePath);
        const backupDest = recoveryStore.directoryBackupPath(receipt.id);
        await extractTarArchiveSafely(backupArchive, backupDest);
        try {
          await removeRemotePath(remoteContext.device, remoteContext.transport, resource.absolutePath);
          await recoveryStore.update(receipt.id, "committed");
          return { status: "saved", contentHash: "absent", receiptId: receipt.id };
        } catch (error) {
          await deploySkillToRemote(remoteContext.device, remoteContext.transport, backupArchive, resource.absolutePath).catch(() => undefined);
          await recoveryStore.update(receipt.id, "failed-restored");
          throw error;
        }
      }

      await assertPortableSkill(resource.absolutePath);
      const currentHash = await hashSkillContent(resource.absolutePath);
      if (currentHash !== input.expectedHash) {
        throw new Error("Project Skill changed outside AgentEnv. Refresh before removing it.");
      }
      await recoveryStore.assertWritablePath(resource.absolutePath);
      const receipt = await recoveryStore.prepareDirectory({
        projectId: input.projectId,
        resourceId: input.resourceId,
        path: resource.absolutePath,
        originalHash: currentHash,
        appliedHash: "absent",
        originalWasAbsent: false,
        sourcePath: resource.absolutePath
      });
      try {
        await rm(resource.absolutePath, { recursive: true });
        if (await pathEntryExists(resource.absolutePath)) throw new Error("Project Skill still exists after removal");
        await recoveryStore.update(receipt.id, "committed");
        return { status: "saved", contentHash: "absent", receiptId: receipt.id };
      } catch (error) {
        try {
          await rm(resource.absolutePath, { recursive: true, force: true });
          await copySkillAtomically(
            recoveryStore.directoryBackupPath(receipt.id),
            resource.absolutePath,
            currentHash
          );
          await recoveryStore.update(receipt.id, "failed-restored");
        } catch {
          await recoveryStore.update(receipt.id, "recovery-required");
          throw new Error("Project Skill removal failed and recovery requires attention");
        }
        throw error;
      }
    },
    restore: async (receiptId) => {
      const receipt = await recoveryStore.get(receiptId);
      const remoteContext = await getProjectAndDevice(receipt.projectId);
      if (remoteContext) {
        if (receipt.kind === "instructions") {
          if (receipt.originalWasAbsent) {
            await removeRemotePath(remoteContext.device, remoteContext.transport, receipt.path).catch(() => undefined);
            await recoveryStore.update(receipt.id, "restored");
            return { status: "restored", contentHash: "absent", receiptId };
          }
          const original = Buffer.from(receipt.originalContentBase64 ?? "", "base64").toString("utf8");
          await writeRemoteTextFile(remoteContext.device, remoteContext.transport, receipt.path, original);
          await recoveryStore.update(receipt.id, "restored");
          return { status: "restored", contentHash: receipt.originalHash, receiptId };
        }
        if (receipt.kind === "skill") {
          if (receipt.originalWasAbsent) {
            await removeRemotePath(remoteContext.device, remoteContext.transport, receipt.path).catch(() => undefined);
            await recoveryStore.update(receipt.id, "restored");
            return { status: "restored", contentHash: "absent", receiptId };
          }
          const backupDir = recoveryStore.directoryBackupPath(receipt.id);
          const tar = await createTarArchiveFromDirectory(backupDir);
          await deploySkillToRemote(remoteContext.device, remoteContext.transport, tar, receipt.path);
          await recoveryStore.update(receipt.id, "restored");
          return { status: "restored", contentHash: receipt.originalHash, receiptId };
        }
      }

      if (receipt.kind === "skill") {
        await environmentService.assertProjectSkillPath(receipt.projectId, receipt.path);
        const exists = await pathEntryExists(receipt.path);
        const currentHash = exists ? await hashSkillContent(receipt.path) : "absent";
        if (receipt.originalWasAbsent) {
          if (currentHash === "absent") {
            await recoveryStore.update(receipt.id, "restored");
            return { status: "no-op", contentHash: "absent", receiptId };
          }
          if (currentHash !== receipt.appliedHash) {
            throw new Error("Project Skill changed after this recovery point. Refresh before restoring.");
          }
          await rm(receipt.path, { recursive: true });
          if (await pathEntryExists(receipt.path)) throw new Error("Project Skill recovery could not remove the added copy");
          await recoveryStore.update(receipt.id, "restored");
          return { status: "restored", contentHash: "absent", receiptId };
        }
        if (currentHash === receipt.originalHash) {
          await recoveryStore.update(receipt.id, "restored");
          return { status: "no-op", contentHash: currentHash, receiptId };
        }
        if (currentHash !== receipt.appliedHash) {
          throw new Error("Project Skill changed after this recovery point. Refresh before restoring.");
        }
        await copySkillAtomically(
          recoveryStore.directoryBackupPath(receipt.id),
          receipt.path,
          receipt.originalHash,
          false,
          currentHash !== "absent"
        );
        await recoveryStore.update(receipt.id, "restored");
        return { status: "restored", contentHash: receipt.originalHash, receiptId };
      }
      if (receipt.originalWasAbsent) {
        if (!receipt.agentId) throw new Error("Project instruction recovery is missing its Agent declaration");
        const { destination } = await environmentService.resolveInstructionDestination(
          receipt.projectId,
          receipt.agentId
        );
        if (!pathsEqual(destination, receipt.path)) {
          throw new Error("Project recovery path no longer matches the declared instruction file");
        }
        if (!await pathEntryExists(receipt.path)) {
          await recoveryStore.update(receipt.id, "restored");
          return { status: "no-op", contentHash: "absent", receiptId };
        }
        const currentHash = hashFileContent(await readFile(receipt.path));
        if (currentHash !== receipt.appliedHash) {
          throw new Error("Project instruction changed after this recovery point. Review the current file before restoring.");
        }
        await rm(receipt.path);
        if (await pathEntryExists(receipt.path)) {
          await recoveryStore.update(receipt.id, "recovery-required");
          throw new Error("Project recovery could not remove the created instruction file");
        }
        await recoveryStore.update(receipt.id, "restored");
        return { status: "restored", contentHash: "absent", receiptId };
      }
      const resource = await resolveInstruction(receipt.projectId, receipt.resourceId);
      if (!pathsEqual(resource.absolutePath, receipt.path)) {
        throw new Error("Project recovery path no longer matches the declared resource");
      }
      const current = await readFile(receipt.path);
      const currentHash = hashFileContent(current);
      if (currentHash === receipt.originalHash) {
        await recoveryStore.update(receipt.id, "restored");
        return { status: "no-op", contentHash: currentHash, receiptId };
      }
      if (currentHash !== receipt.appliedHash) {
        throw new Error("Project instruction changed after this recovery point. Review the current file before restoring.");
      }
      if (receipt.originalContentBase64 === undefined) throw new Error("Project instruction recovery content is unavailable");
      await writeAtomic(receipt.path, Buffer.from(receipt.originalContentBase64, "base64"));
      const restoredHash = hashFileContent(await readFile(receipt.path));
      if (restoredHash !== receipt.originalHash) {
        await recoveryStore.update(receipt.id, "recovery-required");
        throw new Error("Project recovery could not verify the restored file");
      }
      await recoveryStore.update(receipt.id, "restored");
      return { status: "restored", contentHash: restoredHash, receiptId };
    }
  };
  return service;
};
