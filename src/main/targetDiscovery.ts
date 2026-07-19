import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import type { AgentEnvPaths } from "./paths";
import { isMissingFileError, pathExists } from "./fileUtils";
import { findExecutable } from "./executableDiscovery";
import type { TargetRegistry } from "./targets/registry";
import type {
  TargetHealth,
  TargetHealthStatus,
  TargetInfo,
  TargetPathCheck,
  TargetPaths
} from "../shared/types";

export interface TargetDiscoveryOptions {
  paths: AgentEnvPaths;
  targetRegistry: TargetRegistry;
  pathEnv?: string;
  systemPathLookup?: boolean;
  shellPathLookup?: boolean;
}

export interface TargetDiscoveryService {
  listTargets(options?: { forceRefresh?: boolean }): Promise<TargetInfo[]>;
}

const canAccess = async (path: string, mode: number) => {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
};

const pathExistsByStat = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
};

const nearestExistingParent = async (path: string): Promise<string | undefined> => {
  let current = dirname(path);

  while (current && current !== dirname(current)) {
    if (await pathExistsByStat(current)) {
      return current;
    }
    current = dirname(current);
  }

  return (await pathExistsByStat(current)) ? current : undefined;
};

const canWriteTarget = async (path: string) => {
  if (await pathExistsByStat(path)) {
    return canAccess(path, constants.W_OK);
  }

  const parent = await nearestExistingParent(path);
  return parent ? canAccess(parent, constants.W_OK) : false;
};

const checkPath = async (
  id: TargetPathCheck["id"],
  label: string,
  path: string,
  required: boolean
): Promise<TargetPathCheck> => ({
  id,
  label,
  path,
  exists: await pathExists(path),
  writable: await canWriteTarget(path),
  required
});

const createChecks = async (paths: TargetPaths): Promise<TargetPathCheck[]> => {
  const checks = await Promise.all([
    checkPath("configDir", "Config directory", paths.configDir, true),
    checkPath("instructions", "Instructions", paths.instructionsPath, true),
    checkPath("config", "Config", paths.configPath, true),
    paths.mcpConfigPath
      ? checkPath("mcpConfig", "MCP config", paths.mcpConfigPath, true)
      : undefined,
    paths.agentsDir
      ? checkPath("agentsDir", "Agents directory", paths.agentsDir, false)
      : undefined,
    paths.skillsDir
      ? checkPath("skillsDir", "Skills directory", paths.skillsDir, false)
      : undefined
  ]);

  return checks.filter((check): check is TargetPathCheck => Boolean(check));
};

const summarizeHealth = (
  status: TargetHealthStatus,
  executableName: string | undefined,
  executableFound: boolean,
  missingRequiredPaths: number
) => {
  if (status === "ready") {
    if (missingRequiredPaths > 0) {
      return "Ready; setup files will be created";
    }
    return "Ready";
  }
  if (status === "guarded") {
    if (executableName && !executableFound) {
      return `${executableName} writes guarded; CLI not found`;
    }
    return "Detected, protected";
  }
  if (status === "needs-setup") {
    return "Needs setup";
  }
  return executableName ? `${executableName} CLI not found` : "Not detected";
};

export const createTargetDiscoveryService = (
  options: TargetDiscoveryOptions
): TargetDiscoveryService => {
  const {
    paths,
    targetRegistry,
    pathEnv = process.env.PATH ?? "",
    systemPathLookup = options.pathEnv === undefined,
    shellPathLookup = options.pathEnv === undefined
  } = options;
  const executableCache = new Map<
    string,
    { path?: string; checkedAt: number }
  >();
  const executableCacheTtlMs = 30_000;
  const discoverExecutable = async (name: string, forceRefresh: boolean) => {
    const cached = executableCache.get(name);
    if (!forceRefresh && cached && Date.now() - cached.checkedAt < executableCacheTtlMs) {
      if (!cached.path || await canAccess(cached.path, constants.X_OK)) {
        return cached.path;
      }
    }
    const path = await findExecutable(name, {
      pathEnv,
      homeDir: paths.homeDir,
      systemPathLookup,
      shellPathLookup
    });
    executableCache.set(name, { path, checkedAt: Date.now() });
    return path;
  };
  const listTargets = async (
    listOptions: { forceRefresh?: boolean } = {}
  ): Promise<TargetInfo[]> =>
    Promise.all(
      targetRegistry.listAdapters().map(async (adapter) => {
        const targetPaths = adapter.createTargetPaths({
          homeDir: paths.homeDir,
          fakeHomeRoot: paths.fakeHomeRoot
        });
        const executableName = adapter.descriptor.executableName;
        const executablePath = executableName
          ? await discoverExecutable(executableName, listOptions.forceRefresh === true)
          : undefined;
        const executableFound = executableName ? Boolean(executablePath) : true;
        const checks = await createChecks(targetPaths);
        const requiredChecks = checks.filter((check) => check.required);
        const missingRequiredPaths = requiredChecks.filter((check) => !check.exists).length;
        const requiredPathsWritable = requiredChecks.every((check) => check.writable);
        const canWrite =
          adapter.descriptor.realWritesEnabled &&
          executableFound &&
          requiredPathsWritable;
        const status: TargetHealthStatus = !adapter.descriptor.realWritesEnabled
          ? "guarded"
          : !executableFound
            ? "missing"
            : requiredPathsWritable
              ? "ready"
              : "needs-setup";
        const health: TargetHealth = {
          status,
          executableName,
          executablePath,
          executableFound,
          canWrite,
          summary: summarizeHealth(
            status,
            executableName,
            executableFound,
            missingRequiredPaths
          ),
          checks
        };

        return {
          ...adapter.descriptor,
          paths: targetPaths,
          health
        };
      })
    );

  return { listTargets };
};
