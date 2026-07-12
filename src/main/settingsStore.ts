import { cp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AgentEnvSettings } from "../shared/types";
import type { AgentEnvPaths } from "./paths";
import { hashComparableResource } from "./resourceHash";

const SettingsSchema = z.object({
  locale: z.enum(["system", "en", "zh_CN", "zh_TW"]).default("system"),
  skillSyncMethod: z.enum(["symlink", "copy", "auto"]).default("symlink"),
  skillStorageLocation: z.enum(["appData", "agents"]).default("appData"),
  skillAutoCheckEnabled: z.boolean().default(true),
  skillAutoCheckIntervalMinutes: z.number().int().min(5).max(1440).default(60)
});

const DEFAULT_SETTINGS: AgentEnvSettings = {
  locale: "system",
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
  if (next.skillStorageLocation === "agents") {
    throw new Error("~/.agents/skills is a shared runtime location and cannot store Library originals");
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
      if (await hashComparableResource(source) === await hashComparableResource(target)) {
        continue;
      }
      let conflictPath = join(newDir, `${entry.name}-pre-shared-migration`);
      for (let index = 2; await pathExists(conflictPath); index += 1) {
        conflictPath = join(newDir, `${entry.name}-pre-shared-migration-${index}`);
      }
      await rename(target, conflictPath);
    }
    await cp(source, target, { recursive: true, dereference: true });
  }
};

export const createSettingsStore = (paths: AgentEnvPaths): SettingsStore => {
  const readSettings = async (): Promise<AgentEnvSettings> => {
    try {
      const current = SettingsSchema.parse(JSON.parse(await readFile(settingsPathFor(paths), "utf8")));
      if (current.skillStorageLocation !== "agents") return current;
      const next = { ...current, skillStorageLocation: "appData" as const };
      await migrateSkillStorage(paths, current, next);
      await writeFile(settingsPathFor(paths), `${JSON.stringify(next, null, 2)}\n`, "utf8");
      return next;
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
    if (input.skillStorageLocation === "agents") {
      throw new Error("~/.agents/skills is reserved for shared runtime installs");
    }
    const next = SettingsSchema.parse({ ...current, ...input, skillStorageLocation: "appData" });
    await migrateSkillStorage(paths, current, next);
    const settingsPath = settingsPathFor(paths);
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  };

  return { readSettings, updateSettings };
};
