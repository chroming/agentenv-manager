import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type {
  AgentEnvSettings,
  SkillLibraryEntry,
  SkillSourceType,
  TargetPaths,
  UnmanagedSkillEntry
} from "../shared/types";
import { pathExists } from "./fileUtils";
import type { AgentEnvPaths } from "./paths";
import { resolveSkillsLibraryDir, type SettingsStore } from "./settingsStore";

interface SkillMetadataFile {
  sourceType?: SkillSourceType;
  source?: string;
  contentHash?: string;
  updatedAt?: string;
}

export interface ImportSkillInput {
  sourcePath: string;
  id?: string;
  sourceType?: SkillSourceType;
}

export interface SkillLibraryStore {
  listSkills(): Promise<SkillLibraryEntry[]>;
  scanUnmanaged(targetPaths: TargetPaths[]): Promise<UnmanagedSkillEntry[]>;
  importSkill(input: ImportSkillInput): Promise<SkillLibraryEntry>;
  updateSkill(id: string): Promise<SkillLibraryEntry>;
}

const DEFAULT_SETTINGS: AgentEnvSettings = {
  skillSyncMethod: "symlink",
  skillStorageLocation: "appData"
};

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const metadataValue = (content: string, key: "name" | "description") => {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
};

const readJsonIfExists = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
};

const hashPath = async (path: string, hash = createHash("sha256")) => {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".agentenv-skill.json") {
      continue;
    }
    const child = join(path, entry.name);
    hash.update(entry.name);
    if (entry.isDirectory()) {
      await hashPath(child, hash);
    } else if (entry.isFile()) {
      hash.update(await readFile(child));
    }
  }
  return hash;
};

const computeContentHash = async (path: string) => (await hashPath(path)).digest("hex");

const removeAndCopy = async (source: string, destination: string) => {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
};

export const createSkillLibraryStore = (
  paths: AgentEnvPaths,
  settingsStore?: Pick<SettingsStore, "readSettings">
): SkillLibraryStore => {
  const readSettings = () => settingsStore?.readSettings() ?? Promise.resolve(DEFAULT_SETTINGS);
  const libraryDir = async () => resolveSkillsLibraryDir(paths, await readSettings());

  const entryFor = async (id: string, skillDir: string): Promise<SkillLibraryEntry> => {
    const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
    const metadata =
      (await readJsonIfExists<SkillMetadataFile>(join(skillDir, ".agentenv-skill.json"))) ?? {};
    const contentHash = await computeContentHash(skillDir);
    const stats = await stat(join(skillDir, "SKILL.md"));
    return {
      id,
      name: metadataValue(content, "name") || id,
      description: metadataValue(content, "description"),
      path: skillDir,
      sourceType: metadata.sourceType ?? "local",
      source: metadata.source,
      contentHash: metadata.contentHash ?? contentHash,
      updatedAt: metadata.updatedAt ?? stats.mtime.toISOString()
    };
  };

  const writeMetadata = async (
    skillDir: string,
    metadata: Pick<SkillMetadataFile, "sourceType" | "source">
  ) => {
    const contentHash = await computeContentHash(skillDir);
    await writeFile(
      join(skillDir, ".agentenv-skill.json"),
      `${JSON.stringify(
        {
          sourceType: metadata.sourceType ?? "local",
          source: metadata.source,
          contentHash,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  };

  const listSkills = async () => {
    let entries;
    const root = await libraryDir();
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry): Promise<SkillLibraryEntry | undefined> => {
          const skillDir = join(root, entry.name);
          try {
            return await entryFor(entry.name, skillDir);
          } catch (error) {
            if (isMissingFileError(error)) {
              return undefined;
            }
            throw error;
          }
        })
    );

    return skills
      .filter((skill): skill is SkillLibraryEntry => Boolean(skill))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const scanUnmanaged = async (targetPaths: TargetPaths[]) => {
    const libraryIds = new Set((await listSkills()).map((skill) => skill.id));
    const byId = new Map<string, UnmanagedSkillEntry>();
    for (const target of targetPaths) {
      if (!target.skillsDir || !(await pathExists(target.skillsDir))) {
        continue;
      }
      const entries = await readdir(target.skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || libraryIds.has(entry.name)) {
          continue;
        }
        const skillDir = join(target.skillsDir, entry.name);
        if (!(await pathExists(join(skillDir, "SKILL.md")))) {
          continue;
        }
        const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
        const existing = byId.get(entry.name);
        if (existing) {
          existing.foundIn.push(target.targetId);
          continue;
        }
        byId.set(entry.name, {
          id: entry.name,
          name: metadataValue(content, "name") || entry.name,
          description: metadataValue(content, "description"),
          path: skillDir,
          foundIn: [target.targetId]
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const importSkill = async ({
    sourcePath,
    id,
    sourceType = "local"
  }: ImportSkillInput): Promise<SkillLibraryEntry> => {
    if (!(await pathExists(join(sourcePath, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${sourcePath}`);
    }
    const safeId = SafeIdSchema.parse(id ?? basename(sourcePath));
    const targetDir = join(await libraryDir(), safeId);
    if (await pathExists(targetDir)) {
      throw new Error(`Library skill already exists: ${safeId}`);
    }
    await removeAndCopy(sourcePath, targetDir);
    await writeMetadata(targetDir, { sourceType, source: sourcePath });
    return entryFor(safeId, targetDir);
  };

  const updateSkill = async (id: string): Promise<SkillLibraryEntry> => {
    const safeId = SafeIdSchema.parse(id);
    const targetDir = join(await libraryDir(), safeId);
    const metadata =
      (await readJsonIfExists<SkillMetadataFile>(join(targetDir, ".agentenv-skill.json"))) ?? {};
    if (metadata.sourceType !== "local" || !metadata.source) {
      throw new Error(`Skill ${safeId} cannot be updated without a local source`);
    }
    if (!(await pathExists(join(metadata.source, "SKILL.md")))) {
      throw new Error(`Skill source is missing SKILL.md: ${metadata.source}`);
    }
    await removeAndCopy(metadata.source, targetDir);
    await writeMetadata(targetDir, { sourceType: "local", source: metadata.source });
    return entryFor(safeId, targetDir);
  };

  return { listSkills, scanUnmanaged, importSkill, updateSkill };
};
