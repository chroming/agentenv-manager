import { z } from "zod";

export const SafeIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

const RelativeSkillSourceSchema = z
  .string()
  .regex(/^skills\/[a-zA-Z0-9._/-]+$/)
  .refine(
    (value) => !value.split("/").includes(".."),
    "Skill source cannot traverse directories"
  );

export const ProfileManifestSchema = z.object({
  id: SafeIdSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  version: z.literal(1),
  managed: z.object({
    agents: z.boolean(),
    mcp: z.boolean(),
    skills: z.boolean()
  })
});

export const SkillsPolicySchema = z.object({
  ownedSkillDirs: z
    .array(
      z.object({
        source: RelativeSkillSourceSchema,
        targetName: z.string().regex(/^agentenv-[a-zA-Z0-9._-]+$/)
      })
    )
    .default([]),
  disabledSkillPaths: z.array(z.string().min(1)).default([])
});

export type ProfileManifest = z.infer<typeof ProfileManifestSchema>;
export type SkillsPolicy = z.infer<typeof SkillsPolicySchema>;
