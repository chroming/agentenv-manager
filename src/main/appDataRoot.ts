import { cp, mkdir, readdir, rename } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
import { pathExists } from "./fileUtils";

interface ResolveAppDataRootInput {
  env?: Partial<Pick<NodeJS.ProcessEnv, "AGENTENV_DATA_ROOT" | "XDG_CONFIG_HOME">>;
  homeDir: string;
  platform?: NodeJS.Platform;
  userDataDir: string;
}

interface MigrateLegacyAppDataRootInput {
  legacyRoot: string;
  nextRoot: string;
}

export const legacyElectronAppDataRoot = (userDataDir: string) => join(userDataDir, "data");

export const defaultConfigAppDataRoot = (homeDir: string) =>
  join(homeDir, ".config", "agentenv-manager");

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
  return defaultConfigAppDataRoot(homeDir);
};

export const migrateLegacyAppDataRoot = async ({
  legacyRoot,
  nextRoot
}: MigrateLegacyAppDataRootInput) => {
  if (legacyRoot === nextRoot || !(await pathExists(legacyRoot)) || (await pathExists(nextRoot))) {
    return;
  }

  await mkdir(dirname(nextRoot), { recursive: true });
  try {
    await rename(legacyRoot, nextRoot);
  } catch {
    await mkdir(nextRoot, { recursive: true });
    const entries = await readdir(legacyRoot, { withFileTypes: true });
    for (const entry of entries) {
      await cp(join(legacyRoot, entry.name), join(nextRoot, entry.name), {
        dereference: false,
        recursive: true
      });
    }
  }
};
