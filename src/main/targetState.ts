import { z } from "zod";
import type { TargetState } from "../shared/types";
import { ProfileManifestSchema, ProfileResourcesSchema, SafeIdSchema } from "../shared/schemas";

const ManagedResourceSchema = z.object({
  kind: z.enum(["instructions", "config", "mcp", "skill", "agent", "file", "directory"]),
  id: z.string().min(1),
  path: z.string().min(1),
  contentHash: z.string().min(1),
  source: z.string().optional(),
  paused: z.boolean().optional(),
  deploymentMode: z.enum(["adopted", "linked", "copied"]).optional(),
  createdByAgentEnv: z.boolean().optional()
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

const LegacyTargetKeptOutsideSkillSchema = z.object({
  path: z.string().min(1),
  skillKey: z.string().min(1),
  libraryId: z.string().min(1),
  targetName: z.string().min(1)
});

const AppliedSkillReceiptSchema = z.object({
  libraryId: z.string().min(1),
  targetName: z.string().min(1),
  path: z.string().min(1).optional(),
  desired: z.enum(["install", "omit"]),
  observed: z.enum(["missing", "managed", "external", "unavailable"]),
  authority: z.enum(["agentenv", "leave-unmanaged"]),
  action: z.enum(["none", "install", "adopt", "replace", "remove", "preserve"]),
  outcome: z.enum([
    "managed-active",
    "absent",
    "external-active",
    "external-remains"
  ]),
  requiresReview: z.boolean(),
  localOverride: z.boolean(),
  policyId: z.string().optional(),
  contentHash: z.string().optional()
});

const TargetRecoverySchema = z.object({
  operation: z.enum(["apply", "rollback"]),
  error: z.string().min(1),
  backupId: z.string().optional(),
  safetyBackupId: z.string().optional(),
  occurredAt: z.string().min(1)
});

const LibraryResourceVersionsSchema = z.object({
  skills: z.record(z.string(), z.string())
});

const AppliedProfileSnapshotSchema = z.object({
  profileId: SafeIdSchema,
  profileName: z.string().min(1),
  capturedAt: z.string().datetime(),
  contentHash: z.string().min(1),
  snapshotHash: z.string().min(1),
  manifest: ProfileManifestSchema,
  instructions: z.string(),
  resources: ProfileResourcesSchema
}).strict();

const TargetStateBaseSchema = z.object({
  managedMcpNames: z.array(z.string()).default([]),
  activeProfileId: z.string().optional(),
  appliedProfileHash: z.string().optional(),
  appliedProfileSnapshot: AppliedProfileSnapshotSchema.optional(),
  appliedLibraryVersions: LibraryResourceVersionsSchema.optional(),
  lastAppliedAt: z.string().optional(),
  managedResources: z.array(ManagedResourceSchema).default([]),
  sharedSkillPreparations: z.array(SharedSkillPreparationSchema).default([]),
  recoveryRequired: TargetRecoverySchema.optional()
});

const TargetStateV3Schema = TargetStateBaseSchema.extend({
  formatVersion: z.literal(3),
  skillReceipts: z.array(AppliedSkillReceiptSchema).default([])
});

const TargetStateV2Schema = TargetStateBaseSchema.extend({
  formatVersion: z.literal(2),
  keptOutsideSkills: z.array(LegacyTargetKeptOutsideSkillSchema).default([])
});

export const TargetStateSchema = z
  .union([TargetStateV3Schema, TargetStateV2Schema])
  .transform((state): TargetState => {
    if (state.formatVersion === 3) return state;
    const { keptOutsideSkills, ...legacyState } = state;
    return {
      ...legacyState,
      formatVersion: 3,
      skillReceipts: keptOutsideSkills.map((entry) => ({
        libraryId: entry.libraryId,
        targetName: entry.targetName,
        path: entry.path,
        desired: "install",
        observed: "external",
        authority: "leave-unmanaged",
        action: "preserve",
        outcome: "external-active",
        requiresReview: false,
        localOverride: true,
        contentHash: undefined
      }))
    };
  });

export const parseTargetState = (value: unknown): TargetState =>
  TargetStateSchema.parse(value);

export const defaultTargetState = (): TargetState => ({
  formatVersion: 3,
  managedMcpNames: [],
  managedResources: [],
  skillReceipts: [],
  sharedSkillPreparations: []
});
