import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
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
  createTarArchiveFromDirectory,
  deploySkillToRemote,
  extractTarArchiveSafely,
  readRemoteTextFile,
  removeRemotePath,
  writeRemoteTextFile
} from "./remoteProjectTransport";
import { readRemoteProjectState, recoverFailedRemoteProjectMutation, remoteProjectIdentity, restoreRemoteProjectReceipt } from "./remoteProjectRecovery";

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
    const remoteContext = await getProjectAndDevice(input.projectId);
    await recoveryStore.assertWritablePath(current.path, remoteContext ? input.projectId : undefined);
    const receipt = await recoveryStore.prepare({
      projectId: input.projectId,
      remoteIdentity: remoteContext ? remoteProjectIdentity(remoteContext) : undefined,
      resourceId: input.resourceId,
      path: current.path,
      kind: "instructions",
      originalContentBase64: Buffer.from(current.content, "utf8").toString("base64"),
      originalHash: current.contentHash,
      appliedHash
    });

    if (remoteContext) {
      try {
        await writeRemoteTextFile(remoteContext.device, remoteContext.transport, current.path, input.content, current.contentHash);
        const verified = hashFileContent(await readRemoteTextFile(remoteContext.device, remoteContext.transport, current.path));
        if (verified !== appliedHash) throw new Error("Project instruction verification failed after save");
        await recoveryStore.update(receipt.id, "committed");
        return { status: "saved", contentHash: appliedHash, receiptId: receipt.id };
      } catch (error) {
        await recoverFailedRemoteProjectMutation(remoteContext, receipt, recoveryStore, error);
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
        } catch (error) {
          if (!isMissingFileError(error)) throw error;
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
        } catch (error) {
          if (!isMissingFileError(error)) throw error;
        }
        if (exists) {
          throw new Error("Project instruction changed outside AgentEnv. Refresh before saving.");
        }
        const appliedHash = hashFileContent(input.content);
        await recoveryStore.assertWritablePath(destination, input.projectId);
        const receipt = await recoveryStore.prepare({
          projectId: input.projectId,
          remoteIdentity: remoteProjectIdentity(remoteContext),
          resourceId: `instruction-create:${input.agentId}`,
          agentId: input.agentId,
          path: destination,
          kind: "instructions",
          originalWasAbsent: true,
          originalHash: "absent",
          appliedHash
        });
        try {
          await writeRemoteTextFile(remoteContext.device, remoteContext.transport, destination, input.content, "absent");
          const verified = hashFileContent(await readRemoteTextFile(remoteContext.device, remoteContext.transport, destination));
          if (verified !== appliedHash) throw new Error("Project instruction verification failed after save");
          await recoveryStore.update(receipt.id, "committed");
          return { status: "saved", contentHash: appliedHash, receiptId: receipt.id };
        } catch (error) {
          await recoverFailedRemoteProjectMutation(remoteContext, receipt, recoveryStore, error);
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
        const existing = await readRemoteProjectState(remoteContext, destination, "skill");
        if (existing.hash === sourceHash) return { status: "no-op", contentHash: sourceHash };
        if (existing.hash !== "absent" && input.conflictResolution !== "replace") {
          throw new Error(`Project Skill replacement requires an explicit replacement choice: ${destination}`);
        }
        const staging = await mkdtemp(join(tmpdir(), "agentenv-project-deploy-"));
        try {
          await copySkillEntries(library.path, staging);
          if (await hashSkillContent(staging) !== sourceHash) {
            throw new Error("Library Skill changed while preparing its copy. Retry.");
          }
          const tarToDeploy = await createTarArchiveFromDirectory(staging);
          await recoveryStore.assertWritablePath(destination, input.projectId);
          const receipt = await recoveryStore.prepareDirectory({
            projectId: input.projectId,
            remoteIdentity: remoteProjectIdentity(remoteContext),
            resourceId: `skill-add:${input.locationId}:${library.id}`,
            path: destination,
            originalHash: existing.hash,
            appliedHash: sourceHash,
            originalWasAbsent: existing.hash === "absent"
          });
          try {
            if (existing.archive) {
              const backup = recoveryStore.directoryBackupPath(receipt.id);
              await extractTarArchiveSafely(existing.archive, backup);
              if (await hashSkillContent(backup) !== existing.hash) throw new Error("Workspace recovery backup verification failed");
            }
            await deploySkillToRemote(remoteContext.device, remoteContext.transport, tarToDeploy, destination, existing.guard);
            const verified = await readRemoteProjectState(remoteContext, destination, "skill");
            if (verified.hash !== sourceHash) throw new Error("Remote Skill verification failed after copy");
            await recoveryStore.update(receipt.id, "committed");
            return { status: "saved", contentHash: sourceHash, receiptId: receipt.id };
          } catch (error) {
            await recoverFailedRemoteProjectMutation(remoteContext, receipt, recoveryStore, error);
            throw error;
          }
        } finally {
          await rm(staging, { recursive: true, force: true });
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
        const current = await readRemoteProjectState(remoteContext, resource.absolutePath, "skill");
        if (current.hash !== input.expectedHash || !current.archive) {
          throw new Error("Project Skill changed outside AgentEnv. Refresh before removing it.");
        }
        await recoveryStore.assertWritablePath(resource.absolutePath, input.projectId);
        const receipt = await recoveryStore.prepareDirectory({
          projectId: input.projectId,
          remoteIdentity: remoteProjectIdentity(remoteContext),
          resourceId: input.resourceId,
          path: resource.absolutePath,
          originalHash: current.hash,
          appliedHash: "absent",
          originalWasAbsent: false
        });
        try {
          const backup = recoveryStore.directoryBackupPath(receipt.id);
          await extractTarArchiveSafely(current.archive, backup);
          if (await hashSkillContent(backup) !== current.hash) throw new Error("Workspace recovery backup verification failed");
          await removeRemotePath(remoteContext.device, remoteContext.transport, resource.absolutePath, current.guard);
          if ((await readRemoteProjectState(remoteContext, resource.absolutePath, "skill")).hash !== "absent") {
            throw new Error("Remote Skill still exists after removal");
          }
          await recoveryStore.update(receipt.id, "committed");
          return { status: "saved", contentHash: "absent", receiptId: receipt.id };
        } catch (error) {
          await recoverFailedRemoteProjectMutation(remoteContext, receipt, recoveryStore, error);
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
        const relativePath = posix.relative(remoteContext.project.rootPath, receipt.path);
        if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || posix.isAbsolute(relativePath)) {
          throw new Error("Remote Workspace recovery path is outside its project");
        }
        await restoreRemoteProjectReceipt(remoteContext, receipt, recoveryStore);
        return { status: "restored", contentHash: receipt.originalHash, receiptId };
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
