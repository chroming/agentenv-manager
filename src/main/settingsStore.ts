import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AgentEnvSettings } from "../shared/types";
import type { AgentEnvPaths } from "./paths";

const SettingsSchema = z.object({
  skillSyncMethod: z.enum(["symlink", "copy", "auto"]).default("symlink"),
  skillStorageLocation: z.enum(["appData", "agents"]).default("appData"),
  skillAutoCheckEnabled: z.boolean().default(true),
  skillAutoCheckIntervalMinutes: z.number().int().min(5).max(1440).default(60),
  githubOAuthClientId: z.string().trim().min(1).optional().or(z.literal(""))
    .transform((value) => value || undefined)
});

const DEFAULT_SETTINGS: AgentEnvSettings = {
  skillSyncMethod: "symlink",
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60
};

export interface SettingsStore {
  readSettings(): Promise<AgentEnvSettings>;
  updateSettings(input: Partial<AgentEnvSettings>): Promise<AgentEnvSettings>;
}

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const settingsPathFor = (paths: AgentEnvPaths) => join(paths.appDataRoot, "settings.json");

export const resolveSkillsLibraryDir = (
  paths: AgentEnvPaths,
  settings: Pick<AgentEnvSettings, "skillStorageLocation">
) => settings.skillStorageLocation === "agents" ? paths.userSkillsDir : paths.skillsLibraryDir;

const pathExists = async (path: string) => {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    return true;
  }
};

const migrateSkillStorage = async (
  paths: AgentEnvPaths,
  current: AgentEnvSettings,
  next: AgentEnvSettings
) => {
  if (current.skillStorageLocation === next.skillStorageLocation) {
    return;
  }
  const oldDir = resolveSkillsLibraryDir(paths, current);
  const newDir = resolveSkillsLibraryDir(paths, next);
  let entries;
  try {
    entries = await readdir(oldDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  await mkdir(newDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const source = join(oldDir, entry.name);
    const target = join(newDir, entry.name);
    if (await pathExists(target)) {
      continue;
    }
    try {
      await rename(source, target);
    } catch {
      await cp(source, target, { recursive: true, dereference: true });
      await rm(source, { recursive: true, force: true });
    }
  }
};

export const createSettingsStore = (paths: AgentEnvPaths): SettingsStore => {
  const readSettings = async (): Promise<AgentEnvSettings> => {
    try {
      return SettingsSchema.parse(JSON.parse(await readFile(settingsPathFor(paths), "utf8")));
    } catch (error) {
      if (isMissingFileError(error)) {
        return DEFAULT_SETTINGS;
      }
      throw error;
    }
  };

  const updateSettings = async (
    input: Partial<AgentEnvSettings>
  ): Promise<AgentEnvSettings> => {
    const current = await readSettings();
    const next = SettingsSchema.parse({ ...current, ...input });
    await migrateSkillStorage(paths, current, next);
    const settingsPath = settingsPathFor(paths);
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  };

  return { readSettings, updateSettings };
};
