import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SkillLibraryEntry } from "../shared/types";
import {
  CreateSkillGroupInputSchema,
  SkillGroupFileSchema,
  SkillGroupSchema,
  UpdateSkillGroupInputSchema,
  type CreateSkillGroupInput,
  type SkillGroup,
  type UpdateSkillGroupInput
} from "../shared/skillGroups";
import { isMissingFileError, writeAtomic } from "./fileUtils";

export interface SkillGroupStore {
  list(): Promise<SkillGroup[]>;
  create(input: CreateSkillGroupInput): Promise<SkillGroup>;
  update(input: UpdateSkillGroupInput): Promise<SkillGroup>;
  remove(id: string): Promise<void>;
  replace(groups: SkillGroup[]): Promise<void>;
}

export const createSkillGroupStore = (
  path: string,
  listSkills: () => Promise<SkillLibraryEntry[]>
): SkillGroupStore => {
  let mutationQueue = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const list = async () => {
    try {
      const parsed = SkillGroupFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
      return parsed.groups.map((group) => ({ ...group, skillIds: [...group.skillIds] }));
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  };

  const write = async (groups: SkillGroup[]) => {
    const parsed = SkillGroupFileSchema.parse({
      formatVersion: 1,
      groups: [...groups].sort((left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
      )
    });
    await writeAtomic(path, `${JSON.stringify(parsed, null, 2)}\n`);
  };

  const validateMembers = async (skillIds: string[]) => {
    const available = new Set((await listSkills()).map((skill) => skill.id));
    const missing = skillIds.filter((id) => !available.has(id));
    if (missing.length > 0) {
      throw new Error(`Skill Group contains unavailable Library Skills: ${missing.join(", ")}`);
    }
  };

  const assertUniqueName = (groups: SkillGroup[], name: string, exceptId?: string) => {
    const normalized = name.trim().toLocaleLowerCase();
    if (groups.some((group) => group.id !== exceptId && group.name.toLocaleLowerCase() === normalized)) {
      throw new Error(`A Skill Group named ${name} already exists`);
    }
  };

  const create = (unsafeInput: CreateSkillGroupInput) => serialize(async () => {
    const input = CreateSkillGroupInputSchema.parse(unsafeInput);
    const groups = await list();
    assertUniqueName(groups, input.name);
    const skillIds = [...new Set(input.skillIds)].sort();
    await validateMembers(skillIds);
    const now = new Date().toISOString();
    const group = SkillGroupSchema.parse({
      formatVersion: 1,
      id: `group-${randomUUID()}`,
      ...input,
      skillIds,
      createdAt: now,
      updatedAt: now
    });
    await write([...groups, group]);
    return group;
  });

  const update = (unsafeInput: UpdateSkillGroupInput) => serialize(async () => {
    const input = UpdateSkillGroupInputSchema.parse(unsafeInput);
    const groups = await list();
    const current = groups.find((group) => group.id === input.id);
    if (!current) throw new Error("Skill Group no longer exists");
    assertUniqueName(groups, input.name, input.id);
    const skillIds = [...new Set(input.skillIds)].sort();
    await validateMembers(skillIds);
    const next = SkillGroupSchema.parse({
      ...current,
      ...input,
      skillIds,
      updatedAt: new Date().toISOString()
    });
    await write(groups.map((group) => group.id === next.id ? next : group));
    return next;
  });

  const remove = (id: string) => serialize(async () => {
    const groups = await list();
    if (!groups.some((group) => group.id === id)) return;
    await write(groups.filter((group) => group.id !== id));
  });

  const replace = (groups: SkillGroup[]) => serialize(() => write(groups));

  return { list, create, update, remove, replace };
};
