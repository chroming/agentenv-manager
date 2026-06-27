import { z } from "zod";

export const SafeIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

const RelativeAssetSourceSchema = z
  .string()
  .regex(/^(agents|skills)\/[a-zA-Z0-9._/-]+$/)
  .refine(
    (value) => !value.split("/").includes(".."),
    "Asset source cannot traverse directories"
  );

const ManagedSurfaceSchema = z
  .union([
    z.object({
      instructions: z.boolean(),
      config: z.boolean(),
      assets: z.boolean()
    }),
    z
      .object({
        agents: z.boolean(),
        mcp: z.boolean(),
        skills: z.boolean()
      })
      .transform((value) => ({
        instructions: value.agents,
        config: value.mcp,
        assets: value.skills
      }))
  ])
  .default({ instructions: true, config: true, assets: true });

export const ProfileManifestSchema = z.object({
  id: SafeIdSchema,
  targetId: SafeIdSchema.default("codex"),
  name: z.string().min(1),
  description: z.string().default(""),
  version: z.literal(1),
  managed: ManagedSurfaceSchema
});

export const AssetPolicySchema = z.object({
  ownedDirs: z
    .array(
      z.object({
        kind: z.enum(["agent", "skill"]),
        source: RelativeAssetSourceSchema,
        targetName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      })
    )
    .default([]),
  ownedFiles: z
    .array(
      z.object({
        kind: z.enum(["agent", "skill"]),
        source: RelativeAssetSourceSchema,
        targetName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      })
    )
    .default([]),
  skillRefs: z
    .array(
      z.object({
        libraryId: SafeIdSchema,
        targetName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      })
    )
    .default([]),
  disabledSkillPaths: z.array(z.string().min(1)).default([])
});

export const LegacySkillsPolicySchema = z
  .object({
    ownedSkillDirs: z
      .array(
        z.object({
          source: z
            .string()
            .regex(/^skills\/[a-zA-Z0-9._/-]+$/)
            .refine(
              (value) => !value.split("/").includes(".."),
              "Skill source cannot traverse directories"
            ),
          targetName: z.string().regex(/^agentenv-[a-zA-Z0-9._-]+$/)
        })
      )
      .default([]),
    disabledSkillPaths: z.array(z.string().min(1)).default([])
  })
  .transform((value) => ({
    ownedDirs: value.ownedSkillDirs.map((entry) => ({
      kind: "skill" as const,
      source: entry.source,
      targetName: entry.targetName
    })),
    ownedFiles: [],
    skillRefs: [],
    disabledSkillPaths: value.disabledSkillPaths
  }));

export const SkillsPolicySchema = LegacySkillsPolicySchema;

export type ProfileManifest = z.infer<typeof ProfileManifestSchema>;
export type AssetPolicy = z.infer<typeof AssetPolicySchema>;
export type SkillsPolicy = AssetPolicy;
