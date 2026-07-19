import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentEnvPaths } from "./paths";
import { isMissingFileError, writeAtomic } from "./fileUtils";

export const APP_DATA_FORMAT_VERSION = 2 as const;
export const APP_DATA_MANIFEST_NAME = "agentenv-data.json";

const AppDataManifestSchema = z.object({
  formatVersion: z.literal(APP_DATA_FORMAT_VERSION)
});

export interface AppDataManifest {
  formatVersion: typeof APP_DATA_FORMAT_VERSION;
}

export const parseAppDataManifest = (value: unknown): AppDataManifest =>
  AppDataManifestSchema.parse(value);

export const readAppDataManifest = async (
  appDataRoot: string
): Promise<AppDataManifest | undefined> => {
  try {
    return parseAppDataManifest(
      JSON.parse(await readFile(join(appDataRoot, APP_DATA_MANIFEST_NAME), "utf8"))
    );
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw new Error(
      `AgentEnv data format is unsupported or invalid: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

export const ensureAppDataFormat = async (
  paths: Pick<AgentEnvPaths, "appDataRoot">
): Promise<AppDataManifest> => {
  const existing = await readAppDataManifest(paths.appDataRoot);
  if (existing) return existing;

  const existingEntries = await readdir(paths.appDataRoot).catch((error) => {
    if (isMissingFileError(error)) return [];
    throw error;
  });
  if (existingEntries.length > 0) {
    throw new Error("AgentEnv data format is missing; run startup migration first");
  }

  const manifest: AppDataManifest = { formatVersion: APP_DATA_FORMAT_VERSION };
  await writeAtomic(
    join(paths.appDataRoot, APP_DATA_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
};
