import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  AppliedProfileSnapshot,
  LibraryResourceVersions,
  ManagedResourceSnapshot,
  TargetRecoveryState
} from "../../shared/types";
import { ProfileManifestSchema, ProfileResourcesSchema } from "../../shared/schemas";
import type { AgentEnvPaths } from "../paths";
import { isMissingFileError, writeAtomic } from "../fileUtils";

const ManagedResourceSchema = z.object({
  kind: z.enum(["instructions", "config", "mcp", "skill", "agent", "file", "directory"]),
  id: z.string().min(1),
  path: z.string().min(1),
  contentHash: z.string().min(1),
  source: z.string().optional(),
  paused: z.boolean().optional(),
  materialization: z.enum(["copy", "link"]).optional(),
  origin: z.enum(["adopted", "created", "replaced", "unknown"]).optional(),
  deploymentMode: z.enum(["adopted", "linked", "copied"]).optional(),
  createdByAgentEnv: z.boolean().optional()
}).strict();

const AppliedProfileSnapshotSchema = z.object({
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  capturedAt: z.string().datetime(),
  contentHash: z.string().min(1),
  snapshotHash: z.string().min(1),
  manifest: ProfileManifestSchema,
  instructions: z.string(),
  resources: ProfileResourcesSchema
}).strict();

const LibraryResourceVersionsSchema = z.object({
  skills: z.record(z.string(), z.string())
}).strict();

const RecoverySchema = z.object({
  operation: z.enum(["apply", "rollback"]),
  error: z.string().min(1),
  backupId: z.string().optional(),
  safetyBackupId: z.string().optional(),
  operationId: z.string().optional(),
  occurredAt: z.string().min(1)
}).strict();

const PendingAppliedStateSchema = z.object({
  activeProfileId: z.string().min(1),
  appliedProfileHash: z.string().min(1),
  appliedProfileSnapshot: AppliedProfileSnapshotSchema,
  appliedLibraryVersions: LibraryResourceVersionsSchema,
  lastAppliedAt: z.string().datetime(),
  managedResources: z.array(ManagedResourceSchema)
}).strict();

const RemoteEndpointStateSchema = z.object({
  formatVersion: z.literal(1),
  endpointId: z.string().min(1),
  deviceFingerprint: z.string().min(1),
  activeProfileId: z.string().optional(),
  appliedProfileHash: z.string().optional(),
  appliedProfileSnapshot: AppliedProfileSnapshotSchema.optional(),
  appliedLibraryVersions: LibraryResourceVersionsSchema.optional(),
  lastAppliedAt: z.string().datetime().optional(),
  managedResources: z.array(ManagedResourceSchema).optional(),
  recoveryRequired: RecoverySchema.optional(),
  pendingAppliedState: PendingAppliedStateSchema.optional()
}).strict();

export const parseRemoteEndpointStateData = (value: unknown): RemoteEndpointState =>
  RemoteEndpointStateSchema.parse(value);

export interface RemoteEndpointState {
  formatVersion: 1;
  endpointId: string;
  deviceFingerprint: string;
  activeProfileId?: string;
  appliedProfileHash?: string;
  appliedProfileSnapshot?: AppliedProfileSnapshot;
  appliedLibraryVersions?: LibraryResourceVersions;
  lastAppliedAt?: string;
  managedResources?: ManagedResourceSnapshot[];
  recoveryRequired?: TargetRecoveryState & { operationId?: string };
  pendingAppliedState?: {
    activeProfileId: string;
    appliedProfileHash: string;
    appliedProfileSnapshot: AppliedProfileSnapshot;
    appliedLibraryVersions: LibraryResourceVersions;
    lastAppliedAt: string;
    managedResources: ManagedResourceSnapshot[];
  };
}

export interface RemoteEndpointStateRepository {
  list(): Promise<RemoteEndpointState[]>;
  read(endpointId: string): Promise<RemoteEndpointState | undefined>;
  write(state: RemoteEndpointState): Promise<void>;
  removeDevice(deviceId: string): Promise<void>;
}

const safeFileName = (endpointId: string) =>
  Buffer.from(endpointId, "utf8").toString("base64url");

export const createRemoteEndpointStateRepository = (
  paths: AgentEnvPaths
): RemoteEndpointStateRepository => {
  const statePath = (endpointId: string) =>
    join(paths.remoteEndpointStatesDir, `${safeFileName(endpointId)}.json`);
  const list = async () => {
    let names: string[];
    try {
      names = await readdir(paths.remoteEndpointStatesDir);
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
    return Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) =>
      parseRemoteEndpointStateData(
        JSON.parse(await readFile(join(paths.remoteEndpointStatesDir, name), "utf8"))
      )
    ));
  };
  return {
    list,
    read: async (endpointId) => {
      try {
        const parsed = parseRemoteEndpointStateData(
          JSON.parse(await readFile(statePath(endpointId), "utf8"))
        );
        return parsed;
      } catch (error) {
        if (isMissingFileError(error)) return undefined;
        throw new Error(`Remote Agent state is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    write: async (state) => {
      await mkdir(paths.remoteEndpointStatesDir, { recursive: true, mode: 0o700 });
      await writeAtomic(statePath(state.endpointId), `${JSON.stringify(state, null, 2)}\n`);
    },
    removeDevice: async (deviceId) => {
      const states = (await list()).filter((state) =>
        state.endpointId.startsWith(`ssh:${deviceId}:`)
      );
      await Promise.all(states.map((state) => rm(statePath(state.endpointId), { force: true })));
    }
  };
};
