import { cp, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { isAbsolute, join, resolve, win32 } from "node:path";
import { z } from "zod";
import type { AgentEnvSettings } from "../shared/types";
import type { AgentEnvPaths } from "./paths";
import { hashComparableResource } from "./resourceHash";
import { pathEntryExists, replacePathAtomically, writeAtomic } from "./fileUtils";

export const SettingsSchema = z.object({
  locale: z.enum(["system", "en", "zh_CN", "zh_TW"]).default("system"),
  conversationTerminal: z.enum(["default", "ghostty"]).default("default"),
  skillSyncMethod: z.enum(["symlink", "copy", "auto"]).default("auto"),
  skillStorageLocation: z.enum(["appData", "agents"]).default("appData"),
  skillAutoCheckEnabled: z.boolean().default(true),
  skillAutoCheckIntervalMinutes: z.number().int().min(5).max(1440).default(60),
  appUpdateAutoCheckEnabled: z.boolean().default(true),
  appUpdateAutoDownloadEnabled: z.boolean().default(true),
  appUpdateInstallOnQuit: z.boolean().default(true),
  telemetryEnabled: z.boolean().default(true),
  backupRetentionDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]).default(null),
  enabledTargetIds: z.array(z.string().min(1)).optional(),
  agentDiscoveryReviewedIds: z.array(z.string().min(1)).optional(),
  suppressedAgentSuggestionIds: z.array(z.string().min(1)).optional(),
  targetConfigRoots: z.record(z.string().min(1), z.string().min(1)).optional(),
  targetCommandOverrides: z.record(z.string().min(1), z.string().min(1)).optional()
});

export const parseSettingsData = (value: unknown): AgentEnvSettings =>
  SettingsSchema.parse(value);

const DEFAULT_SETTINGS: AgentEnvSettings = {
  locale: "system",
  conversationTerminal: "default",
  skillSyncMethod: "auto",
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60,
  appUpdateAutoCheckEnabled: true,
  appUpdateAutoDownloadEnabled: true,
  appUpdateInstallOnQuit: true,
  telemetryEnabled: true,
  backupRetentionDays: null
};

export interface SettingsStoreOptions {
  supportedTargetIds?: string[];
  platform?: NodeJS.Platform;
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

  const copiedIds: string[] = [];
  const preservedConflicts: Array<{ id: string; preservedAs: string }> = [];
  await replacePathAtomically(newDir, async (stagingDir) => {
    if (await pathEntryExists(newDir)) {
      await cp(newDir, stagingDir, {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true
      });
    } else {
      await mkdir(stagingDir, { recursive: true });
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const source = join(oldDir, entry.name);
      const target = join(stagingDir, entry.name);
      if (await pathEntryExists(target)) {
        if (await hashComparableResource(source) === await hashComparableResource(target)) {
          continue;
        }
        let preservedAs = `${entry.name}-pre-shared-migration`;
        for (
          let index = 2;
          await pathEntryExists(join(stagingDir, preservedAs));
          index += 1
        ) {
          preservedAs = `${entry.name}-pre-shared-migration-${index}`;
        }
        await rename(target, join(stagingDir, preservedAs));
        preservedConflicts.push({ id: entry.name, preservedAs });
      }
      await cp(source, target, { recursive: true, dereference: true });
      copiedIds.push(entry.name);
    }
  });
  const reportPath = join(paths.appDataRoot, "legacy-skill-storage-migration.json");
  if (copiedIds.length > 0 || preservedConflicts.length > 0 || !(await pathEntryExists(reportPath))) {
    await writeAtomic(
      reportPath,
      `${JSON.stringify({
        formatVersion: 1,
        migratedAt: new Date().toISOString(),
        source: oldDir,
        destination: newDir,
        sourcePreserved: true,
        copiedIds,
        preservedConflicts
      }, null, 2)}\n`
    );
  }
};

export const createSettingsStore = (
  paths: AgentEnvPaths,
  options: SettingsStoreOptions = {}
): SettingsStore => {
  const platform = options.platform ?? process.platform;
  const pathIsAbsolute = (path: string) =>
    platform === "win32" ? win32.isAbsolute(path) : isAbsolute(path);
  const normalizeAbsolutePath = (path: string) =>
    platform === "win32" ? win32.normalize(path) : resolve(path);
  const joinPath = (...segments: string[]) =>
    platform === "win32" ? win32.join(...segments) : join(...segments);
  const normalizeCommandOverride = (value: string): string | undefined => {
    const command = value.trim();
    if (!command) return undefined;
    const expanded = command === "~"
      ? paths.homeDir
      : command.startsWith("~/") || (platform === "win32" && command.startsWith("~\\"))
        ? joinPath(paths.homeDir, command.slice(2))
        : command;
    if (pathIsAbsolute(expanded)) return normalizeAbsolutePath(expanded);
    return /^[A-Za-z0-9._+-]+$/.test(expanded) ? expanded : undefined;
  };
  const normalizeEnabledTargets = (settings: AgentEnvSettings): AgentEnvSettings => {
    const enabledTargetIds =
      settings.enabledTargetIds ??
      (options.supportedTargetIds ? [...new Set(options.supportedTargetIds)] : undefined);
    const suppressedAgentSuggestionIds = settings.suppressedAgentSuggestionIds
      ? [...new Set(settings.suppressedAgentSuggestionIds)].filter((targetId) =>
          !options.supportedTargetIds || options.supportedTargetIds.includes(targetId)
        )
      : undefined;
    const agentDiscoveryReviewedIds = settings.agentDiscoveryReviewedIds
      ? [...new Set(settings.agentDiscoveryReviewedIds)].filter((targetId) =>
          !options.supportedTargetIds || options.supportedTargetIds.includes(targetId)
        )
      : undefined;
    const targetConfigRoots = Object.fromEntries(
      Object.entries(settings.targetConfigRoots ?? {})
        .filter(([targetId, path]) =>
          (!options.supportedTargetIds || options.supportedTargetIds.includes(targetId)) &&
          pathIsAbsolute(path)
        )
        .map(([targetId, path]) => [targetId, normalizeAbsolutePath(path)])
    );
    const targetCommandOverrides = Object.fromEntries(
      Object.entries(settings.targetCommandOverrides ?? {})
        .filter(([targetId]) =>
          !options.supportedTargetIds || options.supportedTargetIds.includes(targetId)
        )
        .map(([targetId, command]) => [targetId, normalizeCommandOverride(command)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    );
    const normalized: AgentEnvSettings = {
      ...settings,
      ...(platform === "win32" && settings.conversationTerminal === "ghostty"
        ? { conversationTerminal: "default" as const }
        : {}),
      ...(enabledTargetIds ? { enabledTargetIds } : {}),
      ...(agentDiscoveryReviewedIds ? { agentDiscoveryReviewedIds } : {}),
      ...(suppressedAgentSuggestionIds ? { suppressedAgentSuggestionIds } : {})
    };
    if (Object.keys(targetConfigRoots).length > 0) normalized.targetConfigRoots = targetConfigRoots;
    else delete normalized.targetConfigRoots;
    if (Object.keys(targetCommandOverrides).length > 0) {
      normalized.targetCommandOverrides = targetCommandOverrides;
    } else {
      delete normalized.targetCommandOverrides;
    }
    return normalized;
  };

  const readSettings = async (): Promise<AgentEnvSettings> => {
    try {
      const stored = JSON.parse(await readFile(settingsPathFor(paths), "utf8"));
      const parsed = SettingsSchema.parse(stored);
      const current = normalizeEnabledTargets(parsed);
      const next = current.skillStorageLocation === "agents"
        ? { ...current, skillStorageLocation: "appData" as const }
        : current;
      if (
        next.skillStorageLocation !== parsed.skillStorageLocation ||
        JSON.stringify(next) !== JSON.stringify(stored)
      ) {
        await migrateSkillStorage(paths, parsed, next);
        await writeAtomic(settingsPathFor(paths), `${JSON.stringify(next, null, 2)}\n`);
      }
      return next;
    } catch (error) {
      if (isMissingFileError(error)) {
        const defaults = normalizeEnabledTargets({
          ...DEFAULT_SETTINGS,
          ...(options.supportedTargetIds ? { enabledTargetIds: [] } : {})
        });
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
    if (platform === "win32" && input.conversationTerminal === "ghostty") {
      throw new Error("Ghostty is not available as a Windows conversation terminal");
    }
    for (const path of Object.values(input.targetConfigRoots ?? {})) {
      if (!pathIsAbsolute(path)) throw new Error("Agent configuration roots must use absolute paths");
    }
    for (const command of Object.values(input.targetCommandOverrides ?? {})) {
      if (!normalizeCommandOverride(command)) {
        throw new Error("Agent command overrides must be an executable name or absolute path");
      }
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
