import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export type TraeLayoutVersion = "v2" | "legacy";

export interface TraeLayout {
  version: TraeLayoutVersion;
  configRoot: string;
  runtimeRoot?: string;
  configPath: string;
  legacyConfigPath: string;
  obsoleteConfigPath: string;
  instructionsPath: string;
  legacyInstructionsPath: string;
  skillsDir: string;
  rulesDir: string;
}

export interface ResolveTraeLayoutInput {
  homeDir: string;
  rootDirOverride?: string;
  environment?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
  readDirectory?: (path: string) => string[];
}

const absoluteEnvironmentPath = (
  value: string | undefined,
  homeDir: string
): string | undefined => {
  if (!value?.trim()) return undefined;
  const expanded = value.trim().replace(/^~(?=$|\/)/, homeDir);
  return isAbsolute(expanded) ? resolve(expanded) : undefined;
};

const hasRuntimeState = (
  runtimeRoot: string,
  pathExists: (path: string) => boolean,
  readDirectory: (path: string) => string[]
) => {
  if (
    pathExists(join(runtimeRoot, "sessions")) ||
    pathExists(join(runtimeRoot, "archived_sessions"))
  ) {
    return true;
  }
  return readDirectory(runtimeRoot).some((name) =>
    /^(?:goals|logs|state)_.*\.sqlite(?:-(?:shm|wal))?$/.test(name)
  );
};

export const resolveTraeLayout = (
  input: ResolveTraeLayoutInput
): TraeLayout => {
  const environment = input.environment ?? process.env;
  const canUseProcessEnvironment =
    input.environment !== undefined || input.homeDir === process.env.HOME;
  const environmentConfigRoot = canUseProcessEnvironment
    ? absoluteEnvironmentPath(environment.TRAE_HOME, input.homeDir)
    : undefined;
  const configRoot = resolve(
    input.rootDirOverride ??
    environmentConfigRoot ??
    join(input.homeDir, ".trae")
  );
  const environmentRuntimeRoot = canUseProcessEnvironment
    ? absoluteEnvironmentPath(environment.TRAECLI_HOME, input.homeDir)
    : undefined;
  const runtimeRoot = environmentRuntimeRoot ?? join(configRoot, "cli");
  const pathExists = input.pathExists ?? existsSync;
  const readDirectory = input.readDirectory ?? ((path: string) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  });

  const v2ConfigPath = join(configRoot, "traecli.toml");
  const legacyConfigPath = join(configRoot, "traecli.yaml");
  const hasV2Evidence =
    Boolean(environmentRuntimeRoot || environmentConfigRoot) ||
    pathExists(v2ConfigPath) ||
    hasRuntimeState(runtimeRoot, pathExists, readDirectory);
  const version: TraeLayoutVersion = hasV2Evidence
    ? "v2"
    : pathExists(legacyConfigPath)
      ? "legacy"
      : "v2";
  const rulesDir = join(configRoot, "rules");

  return {
    version,
    configRoot,
    runtimeRoot: version === "v2" ? runtimeRoot : undefined,
    configPath: version === "v2" ? v2ConfigPath : legacyConfigPath,
    legacyConfigPath,
    obsoleteConfigPath: join(configRoot, "trae_cli.yaml"),
    instructionsPath: join(rulesDir, "agentenv-manager.md"),
    legacyInstructionsPath: join(configRoot, "AGENTS.md"),
    skillsDir: join(configRoot, "skills"),
    rulesDir
  };
};
