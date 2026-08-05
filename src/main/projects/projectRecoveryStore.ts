import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ProjectRecoverySummary } from "../../shared/types";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import { copyPathVerified } from "../filesystemIntegrity";
import { hashSkillContent } from "../skillContentHash";
import { pathsEqual } from "../platformPaths";

const ReceiptSchema = z.object({
  formatVersion: z.literal(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  resourceId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  path: z.string().min(1),
  createdAt: z.string().datetime(),
  status: z.enum(["prepared", "committed", "failed-restored", "recovery-required", "restored"]),
  kind: z.enum(["instructions", "skill"]),
  originalContentBase64: z.string().optional(),
  originalWasAbsent: z.boolean().optional(),
  originalHash: z.string().min(1),
  appliedHash: z.string().min(1)
}).strict();

export type ProjectRecoveryReceipt = z.infer<typeof ReceiptSchema>;

export interface ProjectRecoveryStore {
  prepare(input: Omit<ProjectRecoveryReceipt, "formatVersion" | "id" | "createdAt" | "status">): Promise<ProjectRecoveryReceipt>;
  prepareDirectory(input: {
    projectId: string;
    resourceId: string;
    path: string;
    originalHash: string;
    appliedHash: string;
    originalWasAbsent: boolean;
    sourcePath?: string;
  }): Promise<ProjectRecoveryReceipt>;
  directoryBackupPath(id: string): string;
  assertWritablePath(path: string): Promise<void>;
  update(id: string, status: ProjectRecoveryReceipt["status"]): Promise<ProjectRecoveryReceipt>;
  get(id: string): Promise<ProjectRecoveryReceipt>;
  list(projectId?: string): Promise<ProjectRecoverySummary[]>;
}

export const createProjectRecoveryStore = (appDataRoot: string): ProjectRecoveryStore => {
  const recoveryDir = join(appDataRoot, "project-recovery");
  const receiptPath = (id: string) => join(recoveryDir, `${id}.json`);
  const directoryBackupPath = (id: string) => join(recoveryDir, "artifacts", id);
  const write = async (receipt: ProjectRecoveryReceipt) => {
    await mkdir(recoveryDir, { recursive: true, mode: 0o700 });
    await writeAtomic(receiptPath(receipt.id), `${JSON.stringify(ReceiptSchema.parse(receipt), null, 2)}\n`);
  };
  const get = async (id: string) => ReceiptSchema.parse(
    JSON.parse(await readFile(receiptPath(id), "utf8"))
  );
  return {
    prepare: async (input) => {
      const receipt = ReceiptSchema.parse({
        ...input,
        formatVersion: 1,
        id: `project-recovery-${randomUUID()}`,
        createdAt: new Date().toISOString(),
        status: "prepared"
      });
      await write(receipt);
      return receipt;
    },
    prepareDirectory: async (input) => {
      const id = `project-recovery-${randomUUID()}`;
      const receipt = ReceiptSchema.parse({
        formatVersion: 1,
        id,
        projectId: input.projectId,
        resourceId: input.resourceId,
        path: input.path,
        createdAt: new Date().toISOString(),
        status: "prepared",
        kind: "skill",
        originalWasAbsent: input.originalWasAbsent,
        originalHash: input.originalHash,
        appliedHash: input.appliedHash
      });
      if (input.sourcePath) {
        const backupPath = directoryBackupPath(id);
        await mkdir(join(recoveryDir, "artifacts"), { recursive: true, mode: 0o700 });
        await copyPathVerified(input.sourcePath, backupPath, { recursive: true });
        if (await hashSkillContent(backupPath) !== input.originalHash) {
          throw new Error("Project Skill recovery backup could not be verified");
        }
      }
      await write(receipt);
      return receipt;
    },
    directoryBackupPath,
    assertWritablePath: async (path) => {
      let entries: string[];
      try {
        entries = await readdir(recoveryDir);
      } catch (error) {
        if (isMissingFileError(error)) return;
        throw error;
      }
      for (const name of entries.filter((entry) => entry.endsWith(".json"))) {
        const receipt = ReceiptSchema.parse(JSON.parse(await readFile(join(recoveryDir, name), "utf8")));
        if (
          (receipt.status === "prepared" || receipt.status === "recovery-required") &&
          pathsEqual(receipt.path, path)
        ) {
          throw new Error(`Project path requires recovery before another change: ${path}`);
        }
      }
    },
    update: async (id, status) => {
      const receipt = { ...await get(id), status };
      await write(receipt);
      return receipt;
    },
    get,
    list: async (projectId) => {
      let entries: string[];
      try {
        entries = await readdir(recoveryDir);
      } catch (error) {
        if (isMissingFileError(error)) return [];
        throw error;
      }
      const receipts = await Promise.all(entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => readFile(join(recoveryDir, name), "utf8").then((value) => ReceiptSchema.parse(JSON.parse(value)))));
      return receipts
        .filter((receipt) => !projectId || receipt.projectId === projectId)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map(({ id, projectId: receiptProjectId, resourceId, path, createdAt, status, kind }) => ({
          id,
          projectId: receiptProjectId,
          resourceId,
          path,
          createdAt,
          status: status === "prepared" ? "recovery-required" : status as ProjectRecoverySummary["status"],
          kind
        }));
    }
  };
};
