import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import type { WorkspaceSyncConnectInput } from "../../shared/workspaceSync";
import type { AgentEnvPaths } from "../paths";
import { isMissingFileError, writeAtomic } from "../fileUtils";
import { parseRepositoryLocation } from "../skillSources/repositoryLocation";

const RepositorySchema = z.string().trim().min(1).max(2_048).superRefine((value, context) => {
  try {
    parseRepositoryLocation(value, { allowLocal: true });
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

const BranchSchema = z.string().trim().min(1).max(255)
  .regex(/^(?![-./])(?!.*(?:\.\.|@\{|\\|\s|~|\^|:|\?|\*|\[))(?!.*\/$)(?!.*\.lock$)[\x21-\x7e]+$/);

const WorkspaceSyncStateSchema = z.object({
  formatVersion: z.literal(1),
  repository: RepositorySchema,
  branch: BranchSchema,
  workspaceId: z.string().uuid(),
  baseRevision: z.string().optional(),
  baseSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  lastCheckedRevision: z.string().optional(),
  lastCheckedAt: z.string().datetime().optional()
});

export type WorkspaceSyncState = z.infer<typeof WorkspaceSyncStateSchema>;
export const parseWorkspaceSyncStateData = (value: unknown): WorkspaceSyncState =>
  WorkspaceSyncStateSchema.parse(value);

export interface WorkspaceSyncStateStore {
  read(): Promise<WorkspaceSyncState | undefined>;
  connect(input: WorkspaceSyncConnectInput): Promise<WorkspaceSyncState>;
  write(state: WorkspaceSyncState): Promise<void>;
  disconnect(): Promise<void>;
}

export const parseWorkspaceSyncConnection = (input: WorkspaceSyncConnectInput) => ({
  repository: RepositorySchema.parse(input.repository),
  branch: BranchSchema.parse(input.branch)
});

export const createWorkspaceSyncStateStore = (paths: AgentEnvPaths): WorkspaceSyncStateStore => ({
  read: async () => {
    try {
      return parseWorkspaceSyncStateData(JSON.parse(await readFile(paths.workspaceSyncStatePath, "utf8")));
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  },
  connect: async (input) => {
    const connection = parseWorkspaceSyncConnection(input);
    const state: WorkspaceSyncState = { formatVersion: 1, ...connection, workspaceId: randomUUID() };
    await writeAtomic(paths.workspaceSyncStatePath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  },
  write: async (state) => {
    const parsed = WorkspaceSyncStateSchema.parse(state);
    await writeAtomic(paths.workspaceSyncStatePath, `${JSON.stringify(parsed, null, 2)}\n`);
  },
  disconnect: async () => {
    await rm(paths.workspaceSyncStatePath, { force: true });
    await rm(paths.workspaceSyncCacheDir, { recursive: true, force: true });
  }
});
