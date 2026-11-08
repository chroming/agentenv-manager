import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { SafeIdSchema } from "../../shared/schemas";
import type { AgentEnvPaths } from "../paths";
import type { SettingsStore } from "../settingsStore";
import { resolveSkillsLibraryDir } from "../settingsStore";
import type { ProfileStore } from "../profileStore";
import type { BackupStore } from "../backupStore";
import { isPathInside } from "../platformPaths";
import { isMissingFileError, pathEntryExists } from "../fileUtils";
import { recoveryPathKeys } from "../skillMutationRecoveryGate";

export const localMutationScope = async (channel: string, args: any[], services: {
  paths: AgentEnvPaths; settingsStore: Pick<SettingsStore, "readSettings">; profileStore: Pick<ProfileStore, "readProfile">;
}): Promise<string[] | undefined> => {
  const { paths } = services;
  if (channel === "settings:read") return [join(paths.appDataRoot, "settings.json")];
  if (channel === "settings:update") {
    const input = args[0];
    const current = await services.settingsStore.readSettings();
    if (input && typeof input === "object" && !["skillStorageLocation", "targetConfigRoots"].some((key) => Object.hasOwn(input, key) && !isDeepStrictEqual(input[key], current[key as keyof typeof current]))) return [join(paths.appDataRoot, "settings.json")];
  }
  if (["skills:set-icon", "skills:set-tags", "skills:set-availability", "skills:set-update-settings"].includes(channel)) {
    const input = args[0];
    const id = SafeIdSchema.parse(channel === "skills:set-update-settings" ? input?.policy?.id : input?.id);
    return [join(resolveSkillsLibraryDir(paths, await services.settingsStore.readSettings()), id, ".agentenv-skill.json"), paths.skillSourcesPath];
  }
  if (["profiles:save", "profiles:update-metadata", "profiles:update-skills"].includes(channel)) {
    const input = args[0], id = SafeIdSchema.parse(input?.manifest?.id ?? input?.profileId ?? input?.id);
    const current = await services.profileStore.readProfile(id).catch(() => undefined);
    if (channel !== "profiles:save" && !current) return undefined;
    const resources = input.resources ?? current?.resources;
    return [join(paths.profilesDir, id), join(paths.profileRecoveryDir, id),
      ...(input.instructions?.trim() || current?.instructions.trim() ? [paths.instructionsLibraryDir] : []),
      ...(resources?.instructions ?? []).map((item: { libraryId: string }) => join(paths.instructionsLibraryDir, SafeIdSchema.parse(item.libraryId)))];
  }
};

export const assertWorkspaceRecoveryScope = async (paths: AgentEnvPaths, backupStore: BackupStore, channel: string, affected?: readonly string[]) => {
  if (channel === "workspace-sync:recover" || !/^(skills|instructions|profiles|activation|targets|data|settings|workspace-sync):/.test(channel)) return;
  try {
    const journal = z.object({ formatVersion: z.union([z.literal(1), z.literal(2)]), backupId: SafeIdSchema }).parse(JSON.parse(await readFile(paths.workspaceSyncJournalPath, "utf8")));
    if (channel === "settings:read" || channel === "settings:update" && affected?.length === 1 && affected[0] === join(paths.appDataRoot, "settings.json")) return;
    if (affected?.length) {
      const backup = await (backupStore.readBackupManifest?.(journal.backupId) ?? backupStore.readBackup(journal.backupId));
      const protectedPaths = await recoveryPathKeys(backup.entries.map((entry) => entry.sourcePath)), requestedPaths = await recoveryPathKeys(affected);
      if (!protectedPaths.some((protectedPath) => requestedPaths.some((path) => isPathInside(path, protectedPath, { allowRoot: true }) || isPathInside(protectedPath, path, { allowRoot: true })))) return;
    }
  } catch (error) {
    if (isMissingFileError(error) && !await pathEntryExists(paths.workspaceSyncJournalPath)) return;
    if (channel === "settings:read" || channel === "settings:update" && affected?.length === 1 && affected[0] === join(paths.appDataRoot, "settings.json")) return;
  }
  throw new Error("Workspace recovery is required for these resources. Other unrelated resources can still be used; open Sync recovery before changing the affected data.");
};
