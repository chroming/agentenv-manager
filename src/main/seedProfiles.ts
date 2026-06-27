import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEnvPaths } from "./paths";
import {
  createTargetRegistry,
  type TargetRegistry
} from "./targets/registry";

const isMissingFileError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );

const hasAnyProfiles = async (profilesDir: string): Promise<boolean> => {
  try {
    return (await readdir(profilesDir)).length > 0;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

export const seedDefaultProfiles = async (
  paths: AgentEnvPaths,
  targetRegistry: TargetRegistry = createTargetRegistry()
) => {
  if (await hasAnyProfiles(paths.profilesDir)) {
    return;
  }

  const adapter = targetRegistry.get("opencode");
  const profile = adapter.createDefaultProfile("opencode-daily-coding");
  const profileDir = join(paths.profilesDir, profile.id);
  await mkdir(profileDir, { recursive: true });
  await writeFile(
    join(profileDir, "profile.json"),
    `${JSON.stringify(profile.manifest, null, 2)}\n`,
    "utf8"
  );
  await adapter.writeProfileFiles(profileDir, { ...profile, profileDir });
};
