import { z } from "zod";
import {
  ProfileManifestSchema,
  ProfileResourcesSchema,
  ResourceIconKeySchema,
  SafeIdSchema
} from "../../shared/schemas";

const RepositoryIndexManifestPathSchema = z.string().max(4096).refine((value) =>
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.split("/").some((segment) => !segment || segment === "." || segment === "..") &&
  !/[\u0000-\u001f\u007f]/.test(value) &&
  /(?:^|\/)llms\.txt$/i.test(value)
);

const PortableSourceSubpathSchema = z.string().max(4096).refine((value) =>
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.split("/").includes("..") &&
  !/[\u0000-\u001f\u007f]/.test(value)
);

export const PortableSkillMetadataSchema = z.object({
  formatVersion: z.literal(1),
  id: SafeIdSchema,
  iconKey: ResourceIconKeySchema.optional(),
  globallyEnabled: z.boolean(),
  tags: z.array(z.string().min(1).max(32)).max(12).optional(),
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
    indexManifestPath: RepositoryIndexManifestPathSchema.optional(),
    sourceSubpath: z.string()
  }).optional()
});

export const PortableSkillSourceSchema = z.object({
  formatVersion: z.literal(1),
  id: SafeIdSchema,
  kind: z.enum(["repository", "local"]).optional(),
  canonicalLink: z.string(),
  repository: z.string(),
  ref: z.string(),
  directory: z.string(),
  indexManifestPath: RepositoryIndexManifestPathSchema.optional(),
  displayName: z.string().max(80).optional(),
  automaticChecks: z.boolean().optional(),
  ignoredSubpaths: z.array(PortableSourceSubpathSchema).optional(),
  // Older AgentEnv exports could retain this collection-only field. Accept it
  // so their signed hash remains verifiable, but new exports omit it.
  sourceSubpath: PortableSourceSubpathSchema.optional()
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
