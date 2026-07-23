import { z } from "zod";
import {
  ProfileManifestSchema,
  ProfileResourcesSchema,
  ResourceIconKeySchema,
  SafeIdSchema
} from "../../shared/schemas";

export const PortableSkillMetadataSchema = z.object({
  formatVersion: z.literal(1),
  id: SafeIdSchema,
  iconKey: ResourceIconKeySchema.optional(),
  globallyEnabled: z.boolean(),
  updatePolicy: z.enum(["tracked", "untracked"]),
  sourceType: z.enum(["local", "github", "git"]),
  source: z.string().optional(),
  remoteRef: z.string().optional(),
  remoteRevision: z.string().optional(),
  upstream: z.object({
    kind: z.enum(["github", "gitlab", "git", "local", "well-known"]),
    locator: z.string(),
    ref: z.string().optional(),
    subpath: z.string().optional(),
    revision: z.string().optional()
  }).optional(),
  sourceCollection: z.object({
    formatVersion: z.literal(1),
    sourceId: SafeIdSchema.optional(),
    canonicalLink: z.string(),
    repository: z.string(),
    ref: z.string(),
    directory: z.string(),
    sourceSubpath: z.string()
  }).optional()
});

export const PortableSkillSourceSchema = z.object({
  formatVersion: z.literal(1),
  id: SafeIdSchema,
  canonicalLink: z.string(),
  repository: z.string(),
  ref: z.string(),
  directory: z.string(),
  displayName: z.string().max(80).optional()
});

export const PortableSkillSourcesSchema = z.object({
  formatVersion: z.literal(1),
  sources: z.array(PortableSkillSourceSchema)
});

const SectionHashesSchema = z.object({
  manifest: z.string().regex(/^[a-f0-9]{64}$/),
  instructions: z.string().regex(/^[a-f0-9]{64}$/),
  resources: z.string().regex(/^[a-f0-9]{64}$/),
  total: z.string().regex(/^[a-f0-9]{64}$/)
});

const SkillHashesSchema = z.object({
  content: z.string().regex(/^[a-f0-9]{64}$/),
  metadata: z.string().regex(/^[a-f0-9]{64}$/),
  total: z.string().regex(/^[a-f0-9]{64}$/)
});

export const PortableWorkspaceManifestSchema = z.object({
  formatVersion: z.literal(1),
  workspaceId: SafeIdSchema,
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  profileHashes: z.record(SafeIdSchema, SectionHashesSchema),
  skillHashes: z.record(SafeIdSchema, SkillHashesSchema),
  sourcesHash: z.string().regex(/^[a-f0-9]{64}$/)
});

export const PortableProfileManifestSchema = ProfileManifestSchema;
export const PortableProfileResourcesSchema = ProfileResourcesSchema;

export type PortableSkillMetadata = z.infer<typeof PortableSkillMetadataSchema>;
export type PortableSkillSource = z.infer<typeof PortableSkillSourceSchema>;
export type PortableSkillSources = z.infer<typeof PortableSkillSourcesSchema>;
export type PortableWorkspaceManifest = z.infer<typeof PortableWorkspaceManifestSchema>;
