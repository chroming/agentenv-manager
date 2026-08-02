import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
import { pathEntryExists, pathExists, syncParentDirectory } from "./fileUtils";
import {
  copyPathVerified,
  hashRequiredPathEntry,
  syncPathTree
} from "./filesystemIntegrity";

interface ResolveAppDataRootInput {
  env?: Partial<Pick<NodeJS.ProcessEnv, "AGENTENV_DATA_ROOT" | "XDG_CONFIG_HOME">>;
  homeDir: string;
  platform?: NodeJS.Platform;
  userDataDir: string;
}

interface MigrateLegacyAppDataRootInput {
  legacyRoot: string;
  nextRoot: string;
  copyPath?: typeof copyPathVerified;
  renamePath?: typeof rename;
}

export const legacyElectronAppDataRoot = (userDataDir: string) => join(userDataDir, "data");

export const defaultConfigAppDataRoot = (
  homeDir: string,
  platform: NodeJS.Platform = process.platform
) => (platform === "win32" ? win32 : posix).join(
  homeDir,
  ".config",
  "agentenv-manager"
);

export const resolveAppDataRoot = ({
  env = process.env,
  homeDir,
  platform = process.platform,
  userDataDir
}: ResolveAppDataRootInput) => {
  const pathApi = platform === "win32" ? win32 : posix;
  const override = env.AGENTENV_DATA_ROOT?.trim();
  if (override) return override;
  if (platform === "win32") return pathApi.join(userDataDir, "data");
  if (platform === "linux") {
    return pathApi.join(
      env.XDG_CONFIG_HOME?.trim() || pathApi.join(homeDir, ".config"),
      "agentenv-manager"
    );
  }
  // Keep the established macOS location stable for existing installations.
  return defaultConfigAppDataRoot(homeDir, platform);
};

export const migrateLegacyAppDataRoot = async ({
  legacyRoot,
  nextRoot,
  copyPath = copyPathVerified,
  renamePath = rename
}: MigrateLegacyAppDataRootInput) => {
  if (
    legacyRoot === nextRoot ||
    !(await pathExists(legacyRoot)) ||
    await pathEntryExists(nextRoot)
  ) {
    return;
  }

  await mkdir(dirname(nextRoot), { recursive: true });
  try {
    await renamePath(legacyRoot, nextRoot);
    await syncParentDirectory(dirname(nextRoot));
  } catch {
    const stagingRoot = `${nextRoot}.agentenv-migration-${randomUUID()}`;
    try {
      await mkdir(stagingRoot, { recursive: false, mode: 0o700 });
      const sourceHash = await hashRequiredPathEntry(legacyRoot);
      const entries = await readdir(legacyRoot, { withFileTypes: true });
      for (const entry of entries) {
        await copyPath(
          join(legacyRoot, entry.name),
          join(stagingRoot, entry.name),
          { dereference: false, recursive: entry.isDirectory() }
        );
      }
      if (await hashRequiredPathEntry(legacyRoot) !== sourceHash) {
        throw new Error("Legacy AgentEnv data changed during migration; retry");
      }
      await syncPathTree(stagingRoot);
      if (await pathEntryExists(nextRoot)) {
        throw new Error("AgentEnv destination appeared during migration; original data was preserved");
      }
      await renamePath(stagingRoot, nextRoot);
      await syncParentDirectory(dirname(nextRoot));
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
};
