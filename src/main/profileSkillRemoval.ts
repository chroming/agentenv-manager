import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProfileResourcesSchema, SafeIdSchema } from "../shared/schemas";
import { isMissingFileError, writeAtomic } from "./fileUtils";
import { hashFileContent } from "./filesystemIntegrity";

// Inspect references without compiling Instructions or reading unrelated Skill content.
export const readProfileSkillRemovalReferences = async (profilesDir: string, skillId: string) => {
  const entries = await readdir(profilesDir, { withFileTypes: true }).catch((error) => {
    if (isMissingFileError(error)) return [];
    throw error;
  });
  const references = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.includes(".agentenv-")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const id = SafeIdSchema.parse(entry.name), directory = join(profilesDir, id);
    if ((await lstat(directory)).isSymbolicLink()) throw new Error(`Profile storage must be a real directory: ${id}`);
    const path = join(directory, "resources.json");
    const content = await readFile(path, "utf8");
    const resources = ProfileResourcesSchema.parse(JSON.parse(content));
    if (!resources.skills.some((skill) => skill.libraryId === skillId) &&
        !resources.skillGroups?.some((group) => group.memberIds.includes(skillId))) continue;
    const name = await readFile(join(directory, "profile.json"), "utf8")
      .then((value) => JSON.parse(value).name as unknown).catch(() => id);
    references.push({ id, name: typeof name === "string" ? name : id, path,
      sha256: hashFileContent(content), resources: ProfileResourcesSchema.parse({ ...resources,
        skills: resources.skills.filter((skill) => skill.libraryId !== skillId),
        ...(resources.skillGroups ? { skillGroups: resources.skillGroups.map((group) => ({ ...group,
          memberIds: group.memberIds.filter((member) => member !== skillId)
        })) } : {})
      }) });
  }
  return references;
};

export const applyProfileSkillRemoval = async (
  reference: Awaited<ReturnType<typeof readProfileSkillRemovalReferences>>[number]
) => writeAtomic(reference.path, `${JSON.stringify(reference.resources, null, 2)}\n`, {
  expectedTargetHash: reference.sha256
});
