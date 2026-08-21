import { z } from "zod";
import { ResourceIconKeySchema, SafeIdSchema } from "./schemas";

export const SkillGroupSchema = z.object({
  formatVersion: z.literal(1),
  id: SafeIdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  iconKey: ResourceIconKeySchema.optional(),
  skillIds: z.array(SafeIdSchema).max(1000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict().superRefine((group, context) => {
  if (new Set(group.skillIds).size !== group.skillIds.length) {
    context.addIssue({ code: "custom", path: ["skillIds"], message: "Skill Group members must be unique" });
  }
});

export const SkillGroupFileSchema = z.object({
  formatVersion: z.literal(1),
  groups: z.array(SkillGroupSchema)
}).strict().superRefine((file, context) => {
  const ids = new Set<string>();
  const names = new Set<string>();
  file.groups.forEach((group, index) => {
    const name = group.name.toLocaleLowerCase();
    if (ids.has(group.id)) {
      context.addIssue({ code: "custom", path: ["groups", index, "id"], message: "Skill Group IDs must be unique" });
    }
    if (names.has(name)) {
      context.addIssue({ code: "custom", path: ["groups", index, "name"], message: "Skill Group names must be unique" });
    }
    ids.add(group.id);
    names.add(name);
  });
});

export const CreateSkillGroupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  iconKey: ResourceIconKeySchema.optional(),
  skillIds: z.array(SafeIdSchema).max(1000).default([])
}).strict();

export const UpdateSkillGroupInputSchema = CreateSkillGroupInputSchema.extend({
  id: SafeIdSchema
}).strict();

export type SkillGroup = z.infer<typeof SkillGroupSchema>;
export type CreateSkillGroupInput = z.infer<typeof CreateSkillGroupInputSchema>;
export type UpdateSkillGroupInput = z.infer<typeof UpdateSkillGroupInputSchema>;
