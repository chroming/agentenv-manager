import { z } from "zod";

export const SafeIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

export const ResourceIconKeySchema = z.enum([
  "opencode",
  "codex",
  "claude",
  "antigravity",
  "trae",
  "pi",
  "github",
  "folder",
  "code",
  "rocket",
  "shield",
  "flask",
  "pen",
  "terminal",
  "database",
  "search",
  "workflow",
  "book",
  "palette",
  "bot",
  "sparkles",
  "bug",
  "cloud",
  "cpu",
  "file",
  "globe",
  "key",
  "layers",
  "lightbulb",
  "lock",
  "message",
  "package",
  "plug",
  "settings",
  "test",
  "wand",
  "wrench",
  "chart",
  "boxes",
  "braces",
  "server"
]);

export const ProfileManifestSchema = z.object({
  id: SafeIdSchema,
  name: z.string().min(1),
  description: z.string().default(""),
  iconKey: ResourceIconKeySchema.optional(),
  createdAt: z.string().datetime().optional(),
  preferredTargetId: SafeIdSchema.optional(),
  createdFromTargetId: SafeIdSchema.optional(),
  version: z.literal(2)
});

const TargetResourceNameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

export const ProfileSkillSchema = z.object({
  libraryId: SafeIdSchema,
  targetName: TargetResourceNameSchema,
  enabled: z.boolean().default(true)
});

export const ProfileMcpSelectionSchema = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean()
});

export const ProfileResourceModeSchema = z.enum(["ignore", "manage", "disable"]);

export const ProfileMcpPolicySchema = z.object({
  mode: ProfileResourceModeSchema,
  selections: z.array(ProfileMcpSelectionSchema).default([])
});

export const ProfileTargetResourcePolicySchema = z.object({
  instructions: ProfileResourceModeSchema.default("manage"),
  skills: ProfileResourceModeSchema.default("manage")
});

export const ProfileResourcesSchema = z.object({
  skills: z.array(ProfileSkillSchema).default([]),
  managementByTarget: z
    .record(SafeIdSchema, ProfileTargetResourcePolicySchema)
    .optional(),
  mcpByTarget: z.record(SafeIdSchema, ProfileMcpPolicySchema).default({})
}).superRefine((resources, context) => {
  const libraryIds = new Set<string>();
  const targetNames = new Set<string>();
  resources.skills.forEach((skill, index) => {
    if (libraryIds.has(skill.libraryId)) {
      context.addIssue({
        code: "custom",
        path: ["skills", index, "libraryId"],
        message: `Library Skill ${skill.libraryId} is referenced more than once`
      });
    }
    if (targetNames.has(skill.targetName)) {
      context.addIssue({
        code: "custom",
        path: ["skills", index, "targetName"],
        message: `Skill target ${skill.targetName} is declared more than once`
      });
    }
    libraryIds.add(skill.libraryId);
    targetNames.add(skill.targetName);
  });
  for (const [targetId, policy] of Object.entries(resources.mcpByTarget)) {
    const names = new Set<string>();
    policy.selections.forEach((selection, index) => {
      if (names.has(selection.name)) {
        context.addIssue({
          code: "custom",
          path: ["mcpByTarget", targetId, "selections", index, "name"],
          message: `${targetId} MCP ${selection.name} is declared more than once`
        });
      }
      names.add(selection.name);
    });
  }
});

export type ProfileManifest = z.infer<typeof ProfileManifestSchema>;
export type ProfileSkill = z.infer<typeof ProfileSkillSchema>;
export type ProfileMcpSelection = z.infer<typeof ProfileMcpSelectionSchema>;
export type ProfileMcpPolicy = z.infer<typeof ProfileMcpPolicySchema>;
export type ProfileResourceMode = z.infer<typeof ProfileResourceModeSchema>;
export type ProfileTargetResourcePolicy = z.infer<typeof ProfileTargetResourcePolicySchema>;
export type ProfileResources = z.infer<typeof ProfileResourcesSchema>;
export type ResourceIconKey = z.infer<typeof ResourceIconKeySchema>;
