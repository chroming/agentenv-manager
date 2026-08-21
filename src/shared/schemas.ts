import { z } from "zod";
import {
  isPortableFileName,
  portableIdentityKey
} from "./portableNames";

export const SafeIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
  .refine(isPortableFileName, "ID is not portable across supported filesystems");

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

export const ProjectReferenceSchema = z.object({
  id: SafeIdSchema,
  name: z.string().trim().min(1).max(120),
  rootPath: z.string().min(1).max(4096),
  createdAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime().optional(),
  lastAgentId: SafeIdSchema.optional()
}).strict();

export const ProjectReferenceFileSchema = z.object({
  formatVersion: z.literal(1),
  projects: z.array(ProjectReferenceSchema)
}).strict();

const ProjectContentHashSchema = z.string().min(1).max(256);

export const UpdateProjectInputSchema = z.object({
  id: SafeIdSchema,
  name: z.string().trim().min(1).max(120).optional(),
  lastAgentId: SafeIdSchema.optional(),
  markOpened: z.boolean().optional()
}).strict().refine(
  ({ name, lastAgentId, markOpened }) => name !== undefined || lastAgentId !== undefined || markOpened !== undefined,
  "Project update must change at least one field"
);

export const SaveProjectResourceInputSchema = z.object({
  projectId: SafeIdSchema,
  resourceId: SafeIdSchema,
  expectedHash: ProjectContentHashSchema,
  content: z.string().max(2_000_000)
}).strict();

export const CreateProjectInstructionInputSchema = z.object({
  projectId: SafeIdSchema,
  agentId: SafeIdSchema,
  content: z.string().max(2_000_000)
}).strict();

export const AddProjectSkillInputSchema = z.object({
  projectId: SafeIdSchema,
  locationId: SafeIdSchema,
  libraryId: SafeIdSchema,
  conflictResolution: z.literal("replace").optional()
}).strict();

export const RemoveProjectSkillInputSchema = z.object({
  projectId: SafeIdSchema,
  resourceId: SafeIdSchema,
  expectedHash: ProjectContentHashSchema
}).strict();

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
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .refine(
    isPortableFileName,
    "Resource name is not portable across supported filesystems"
  );

export const ProfileSkillSchema = z.object({
  libraryId: SafeIdSchema,
  targetName: TargetResourceNameSchema,
  enabled: z.boolean().default(true),
  direct: z.boolean().optional(),
  groupIds: z.array(SafeIdSchema).optional()
});

export const ProfileSkillGroupSchema = z.object({
  id: SafeIdSchema,
  kind: z.enum(["manual", "source"]),
  groupId: SafeIdSchema,
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  memberIds: z.array(SafeIdSchema).default([])
}).strict().superRefine((group, context) => {
  if (new Set(group.memberIds).size !== group.memberIds.length) {
    context.addIssue({
      code: "custom",
      path: ["memberIds"],
      message: `Skill Group ${group.id} contains duplicate members`
    });
  }
});

export const ProfileInstructionReferenceSchema = z.object({
  libraryId: SafeIdSchema,
  enabled: z.boolean().default(true)
});

export const InstructionBlockMetadataSchema = z.object({
  formatVersion: z.literal(1),
  id: SafeIdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

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
  instructions: z.array(ProfileInstructionReferenceSchema).optional(),
  skills: z.array(ProfileSkillSchema).default([]),
  skillGroups: z.array(ProfileSkillGroupSchema).optional(),
  managementByTarget: z
    .record(SafeIdSchema, ProfileTargetResourcePolicySchema)
    .optional(),
  mcpByTarget: z.record(SafeIdSchema, ProfileMcpPolicySchema).default({})
}).superRefine((resources, context) => {
  const instructionIds = new Set<string>();
  (resources.instructions ?? []).forEach((instruction, index) => {
    if (instructionIds.has(instruction.libraryId)) {
      context.addIssue({
        code: "custom",
        path: ["instructions", index, "libraryId"],
        message: `Instruction Block ${instruction.libraryId} is referenced more than once`
      });
    }
    instructionIds.add(instruction.libraryId);
  });
  const libraryIds = new Set<string>();
  const targetNames = new Set<string>();
  const groupIds = new Set<string>();
  (resources.skillGroups ?? []).forEach((group, index) => {
    if (groupIds.has(group.id)) {
      context.addIssue({
        code: "custom",
        path: ["skillGroups", index, "id"],
        message: `Profile Skill Group ${group.id} is referenced more than once`
      });
    }
    groupIds.add(group.id);
  });
  resources.skills.forEach((skill, index) => {
    if (libraryIds.has(skill.libraryId)) {
      context.addIssue({
        code: "custom",
        path: ["skills", index, "libraryId"],
        message: `Library Skill ${skill.libraryId} is referenced more than once`
      });
    }
    const targetNameKey = portableIdentityKey(skill.targetName);
    if (targetNames.has(targetNameKey)) {
      context.addIssue({
        code: "custom",
        path: ["skills", index, "targetName"],
        message: `Skill target ${skill.targetName} is declared more than once`
      });
    }
    libraryIds.add(skill.libraryId);
    targetNames.add(targetNameKey);
    (skill.groupIds ?? []).forEach((groupId) => {
      if (!groupIds.has(groupId)) {
        context.addIssue({
          code: "custom",
          path: ["skills", index, "groupIds"],
          message: `Skill ${skill.libraryId} references missing Profile Skill Group ${groupId}`
        });
      }
    });
  });
  (resources.skillGroups ?? []).forEach((group, groupIndex) => {
    group.memberIds.forEach((libraryId, memberIndex) => {
      const reference = resources.skills.find((skill) => skill.libraryId === libraryId);
      if (!reference || !(reference.groupIds ?? []).includes(group.id)) {
        context.addIssue({
          code: "custom",
          path: ["skillGroups", groupIndex, "memberIds", memberIndex],
          message: `Profile Skill Group ${group.id} member ${libraryId} is not linked to the group`
        });
      }
    });
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
export type InstructionBlockMetadata = z.infer<typeof InstructionBlockMetadataSchema>;
export type ProfileInstructionReference = z.infer<typeof ProfileInstructionReferenceSchema>;
export type ProfileSkill = z.infer<typeof ProfileSkillSchema>;
export type ProfileSkillGroup = z.infer<typeof ProfileSkillGroupSchema>;
export type ProfileMcpSelection = z.infer<typeof ProfileMcpSelectionSchema>;
export type ProfileMcpPolicy = z.infer<typeof ProfileMcpPolicySchema>;
export type ProfileResourceMode = z.infer<typeof ProfileResourceModeSchema>;
export type ProfileTargetResourcePolicy = z.infer<typeof ProfileTargetResourcePolicySchema>;
export type ProfileResources = z.infer<typeof ProfileResourcesSchema>;
export type ResourceIconKey = z.infer<typeof ResourceIconKeySchema>;
