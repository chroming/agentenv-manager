import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  AddProjectSkillInput,
  ProjectMutationResult,
  ProjectResourceFile,
  RemoveProjectSkillInput,
  SaveProjectResourceInput
} from "../../shared/types";
import { pathEntryExists, writeAtomic } from "../fileUtils";
import { copyPathVerified, hashFileContent } from "../filesystemIntegrity";
import { hashSkillContent } from "../skillContentHash";
import { copySkillEntries } from "../skillDeployment";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { ProjectEnvironmentService } from "./projectEnvironmentService";
import type { ProjectRecoveryStore } from "./projectRecoveryStore";

const MAX_PROJECT_TEXT_BYTES = 2 * 1024 * 1024;

interface ProjectMutationServiceOptions {
  environmentService: ProjectEnvironmentService;
  recoveryStore: ProjectRecoveryStore;
  skillLibraryStore: Pick<SkillLibraryStore, "listSkills">;
  enabledAgentIds(): Promise<string[]>;
}

export interface ProjectMutationService {
  read(projectId: string, resourceId: string): Promise<ProjectResourceFile>;
  save(input: SaveProjectResourceInput): Promise<ProjectMutationResult>;
  addSkill(input: AddProjectSkillInput): Promise<ProjectMutationResult>;
  removeSkill(input: RemoveProjectSkillInput): Promise<ProjectMutationResult>;
  restore(receiptId: string): Promise<ProjectMutationResult>;
}

export const createProjectMutationService = ({
  environmentService,
  recoveryStore,
  skillLibraryStore,
  enabledAgentIds
}: ProjectMutationServiceOptions): ProjectMutationService => {
  const assertPortableSkill = async (root: string) => {
    const queue = [root];
    let count = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const entry of await readdir(current, { withFileTypes: true })) {
        count += 1;
        if (count > 2_000) throw new Error("Project Skill contains too many files");
        const path = join(current, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Project Skill contains a symbolic link: ${path}`);
        if (entry.isDirectory()) queue.push(path);
        else if (!entry.isFile()) throw new Error(`Project Skill contains an unsupported entry: ${path}`);
      }
    }
  };

  const copySkillAtomically = async (
    source: string,
    destination: string,
    expectedHash: string,
    excludeLibraryMetadata = false
  ) => {
    const staging = join(dirname(destination), `.agentenv-project-skill-${randomUUID()}`);
    try {
      if (excludeLibraryMetadata) await copySkillEntries(source, staging);
      else await copyPathVerified(source, staging, { recursive: true });
      if (await hashSkillContent(staging) !== expectedHash) {
        throw new Error("Project Skill copy verification failed before commit");
      }
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
    const content = await readFile(resource.absolutePath, "utf8");
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_PROJECT_TEXT_BYTES) throw new Error("Project instruction file is too large to edit safely");
    return {
      resourceId,
      name: resource.name,
      path: resource.absolutePath,
      content,
      contentHash: hashFileContent(content),
      modifiedAt: resource.modifiedAt ?? new Date(0).toISOString(),
      editable: true
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

  return {
    read,
    save,
    addSkill: async (input) => {
      const library = (await skillLibraryStore.listSkills()).find((skill) => skill.id === input.libraryId);
      if (!library) throw new Error(`Library Skill not found: ${input.libraryId}`);
      if (!await pathEntryExists(join(library.path, "SKILL.md"))) {
        throw new Error(`Library Skill is unavailable: ${library.id}`);
      }
      await assertPortableSkill(library.path);
      const sourceHash = await hashSkillContent(library.path);
      const { destination } = await environmentService.resolveSkillDestination(
        input.projectId,
        input.agentId,
        library.id
      );
      if (await pathEntryExists(destination)) {
        const existing = await lstat(destination);
        if (existing.isDirectory() && !existing.isSymbolicLink() && await hashSkillContent(destination) === sourceHash) {
          return { status: "no-op", contentHash: sourceHash };
        }
        throw new Error(`Project Skill destination already exists: ${destination}`);
      }
      await recoveryStore.assertWritablePath(destination);
      const receipt = await recoveryStore.prepareDirectory({
        projectId: input.projectId,
        resourceId: `skill-add:${input.agentId}:${library.id}`,
        path: destination,
        originalHash: "absent",
        appliedHash: sourceHash,
        originalWasAbsent: true
      });
      try {
        await copySkillAtomically(library.path, destination, sourceHash, true);
        await recoveryStore.update(receipt.id, "committed");
        return { status: "saved", contentHash: sourceHash, receiptId: receipt.id };
      } catch (error) {
        await rm(destination, { recursive: true, force: true }).catch(() => undefined);
        const restored = !await pathEntryExists(destination);
        await recoveryStore.update(receipt.id, restored ? "failed-restored" : "recovery-required");
        if (!restored) throw new Error("Project Skill add failed and recovery requires attention");
        throw error;
      }
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
          receipt.originalHash
        );
        await recoveryStore.update(receipt.id, "restored");
        return { status: "restored", contentHash: receipt.originalHash, receiptId };
      }
      const resource = await resolveInstruction(receipt.projectId, receipt.resourceId);
      if (resource.absolutePath !== receipt.path) throw new Error("Project recovery path no longer matches the declared resource");
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
};
