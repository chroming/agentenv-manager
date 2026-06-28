import { cp, mkdir, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathExists } from "./fileUtils";

interface ResolveAppDataRootInput {
  env?: Partial<Pick<NodeJS.ProcessEnv, "AGENTENV_DATA_ROOT">>;
  homeDir: string;
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
  userDataDir
}: ResolveAppDataRootInput) =>
  env.AGENTENV_DATA_ROOT?.trim() || defaultConfigAppDataRoot(homeDir);

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
