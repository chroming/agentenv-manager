import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentEnvPaths } from "./paths";
import { isMissingFileError, writeAtomic } from "./fileUtils";

export const APP_DATA_FORMAT_VERSION = 2 as const;
export const APP_DATA_MANIFEST_NAME = "agentenv-data.json";

const AppDataManifestSchema = z.object({ formatVersion: z.number().int().positive() });

export class AppDataFormatError extends Error {
  constructor(
    public readonly kind: "newer" | "older" | "invalid" | "missing",
    message: string
  ) {
    super(message);
    this.name = "AppDataFormatError";
  }
}

export interface AppDataManifest {
  formatVersion: typeof APP_DATA_FORMAT_VERSION;
}

export const parseAppDataManifest = (value: unknown): AppDataManifest =>
  {
    const parsed = AppDataManifestSchema.safeParse(value);
    if (!parsed.success) {
      throw new AppDataFormatError("invalid", `Invalid AgentEnv data manifest: ${parsed.error.message}`);
    }
    if (parsed.data.formatVersion > APP_DATA_FORMAT_VERSION) {
      throw new AppDataFormatError(
        "newer",
        `AgentEnv data format ${parsed.data.formatVersion} is newer than supported format ${APP_DATA_FORMAT_VERSION}`
      );
    }
    if (parsed.data.formatVersion < APP_DATA_FORMAT_VERSION) {
      throw new AppDataFormatError(
        "older",
        `AgentEnv data format ${parsed.data.formatVersion} requires migration to ${APP_DATA_FORMAT_VERSION}`
      );
    }
    return { formatVersion: APP_DATA_FORMAT_VERSION };
  };

export const readAppDataManifest = async (
  appDataRoot: string
): Promise<AppDataManifest | undefined> => {
  try {
    return parseAppDataManifest(
      JSON.parse(await readFile(join(appDataRoot, APP_DATA_MANIFEST_NAME), "utf8"))
    );
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    if (error instanceof AppDataFormatError) throw error;
    throw new AppDataFormatError(
      "invalid",
      `AgentEnv data manifest cannot be read: ${error instanceof Error ? error.message : String(error)}`
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
    throw new AppDataFormatError("missing", "AgentEnv data format is missing; run startup migration first");
  }

  const manifest: AppDataManifest = { formatVersion: APP_DATA_FORMAT_VERSION };
  await writeAtomic(
    join(paths.appDataRoot, APP_DATA_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
};
