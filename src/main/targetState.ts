import { z } from "zod";
import type { TargetState } from "../shared/types";

const ManagedResourceSchema = z.object({
  kind: z.enum(["instructions", "config", "mcp", "skill", "agent", "file", "directory"]),
  id: z.string().min(1),
  path: z.string().min(1),
  contentHash: z.string().min(1),
  source: z.string().optional(),
  paused: z.boolean().optional()
});

const SharedSkillPreparationSchema = z.object({
  skillKey: z.string().min(1),
  libraryId: z.string().min(1),
  sharedPaths: z.array(z.string().min(1)),
  targetName: z.string().min(1),
  disposition: z.enum(["install", "omit"]),
  profileId: z.string().min(1),
  profileHash: z.string().min(1)
});

const TargetRecoverySchema = z.object({
  operation: z.enum(["apply", "rollback"]),
  error: z.string().min(1),
  backupId: z.string().optional(),
  occurredAt: z.string().min(1)
});

const LibraryResourceVersionsSchema = z.object({
  skills: z.record(z.string(), z.string())
});

export const TargetStateSchema = z.object({
  formatVersion: z.literal(2),
  managedMcpNames: z.array(z.string()).default([]),
  activeProfileId: z.string().optional(),
  appliedProfileHash: z.string().optional(),
  appliedLibraryVersions: LibraryResourceVersionsSchema.optional(),
  lastAppliedAt: z.string().optional(),
  managedResources: z.array(ManagedResourceSchema).default([]),
  sharedSkillPreparations: z.array(SharedSkillPreparationSchema).default([]),
  recoveryRequired: TargetRecoverySchema.optional()
});

export const parseTargetState = (value: unknown): TargetState =>
  TargetStateSchema.parse(value);

export const defaultTargetState = (): TargetState => ({
  formatVersion: 2,
  managedMcpNames: [],
  managedResources: [],
  sharedSkillPreparations: []
});
