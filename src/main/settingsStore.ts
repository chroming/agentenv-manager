import { cp, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { AgentEnvSettings } from "../shared/types";
import type { AgentEnvPaths } from "./paths";
import { hashComparableResource } from "./resourceHash";
import { writeAtomic } from "./fileUtils";

export const SettingsSchema = z.object({
  locale: z.enum(["system", "en", "zh_CN", "zh_TW"]).default("system"),
  skillSyncMethod: z.enum(["symlink", "copy", "auto"]).default("symlink"),
  skillStorageLocation: z.enum(["appData", "agents"]).default("appData"),
  skillAutoCheckEnabled: z.boolean().default(true),
  skillAutoCheckIntervalMinutes: z.number().int().min(5).max(1440).default(60),
  backupRetentionDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]).default(null),
  enabledTargetIds: z.array(z.string().min(1)).optional(),
  targetConfigRoots: z.record(z.string().min(1), z.string().min(1)).optional()
});

export const parseSettingsData = (value: unknown): AgentEnvSettings =>
  SettingsSchema.parse(value);

const DEFAULT_SETTINGS: AgentEnvSettings = {
  locale: "system",
  skillSyncMethod: "symlink",
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60,
  backupRetentionDays: null
};

export interface SettingsStoreOptions {
  supportedTargetIds?: string[];
}

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

export const createSettingsStore = (
  paths: AgentEnvPaths,
  options: SettingsStoreOptions = {}
): SettingsStore => {
  const normalizeEnabledTargets = (settings: AgentEnvSettings): AgentEnvSettings => {
    const enabledTargetIds =
      settings.enabledTargetIds ??
      (options.supportedTargetIds ? [...new Set(options.supportedTargetIds)] : undefined);
    const targetConfigRoots = Object.fromEntries(
      Object.entries(settings.targetConfigRoots ?? {})
        .filter(([targetId, path]) =>
          (!options.supportedTargetIds || options.supportedTargetIds.includes(targetId)) &&
          isAbsolute(path)
        )
        .map(([targetId, path]) => [targetId, resolve(path)])
    );
    const normalized: AgentEnvSettings = {
      ...settings,
      ...(enabledTargetIds ? { enabledTargetIds } : {})
    };
    if (Object.keys(targetConfigRoots).length > 0) normalized.targetConfigRoots = targetConfigRoots;
    else delete normalized.targetConfigRoots;
    return normalized;
  };

  const readSettings = async (): Promise<AgentEnvSettings> => {
    try {
      const parsed = SettingsSchema.parse(JSON.parse(await readFile(settingsPathFor(paths), "utf8")));
      const current = normalizeEnabledTargets(parsed);
      const next = current.skillStorageLocation === "agents"
        ? { ...current, skillStorageLocation: "appData" as const }
        : current;
      if (
        next.skillStorageLocation !== parsed.skillStorageLocation ||
        JSON.stringify(next.enabledTargetIds) !== JSON.stringify(parsed.enabledTargetIds)
      ) {
        await migrateSkillStorage(paths, parsed, next);
        await writeAtomic(settingsPathFor(paths), `${JSON.stringify(next, null, 2)}\n`);
      }
      return next;
    } catch (error) {
      if (isMissingFileError(error)) {
        const defaults = normalizeEnabledTargets(DEFAULT_SETTINGS);
        if (options.supportedTargetIds) {
          await writeAtomic(settingsPathFor(paths), `${JSON.stringify(defaults, null, 2)}\n`);
        }
        return defaults;
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
    for (const path of Object.values(input.targetConfigRoots ?? {})) {
      if (!isAbsolute(path)) throw new Error("Agent configuration roots must use absolute paths");
    }
    const next = normalizeEnabledTargets(
      SettingsSchema.parse({ ...current, ...input, skillStorageLocation: "appData" })
    );
    await migrateSkillStorage(paths, current, next);
    const settingsPath = settingsPathFor(paths);
    await writeAtomic(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  };

  return { readSettings, updateSettings };
};
