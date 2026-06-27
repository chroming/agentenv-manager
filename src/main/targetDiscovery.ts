import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import type { AgentEnvPaths } from "./paths";
import { isMissingFileError, pathExists } from "./fileUtils";
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
}

export interface TargetDiscoveryService {
  listTargets(): Promise<TargetInfo[]>;
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

const findExecutable = async (name: string, pathEnv: string) => {
  const candidates = isAbsolute(name)
    ? [name]
    : pathEnv
        .split(delimiter)
        .filter(Boolean)
        .map((dir) => join(dir, name));

  for (const candidate of candidates) {
    if (await canAccess(candidate, constants.X_OK)) {
      return candidate;
    }
  }

  return undefined;
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
  executableFound: boolean
) => {
  if (status === "ready") {
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

export const createTargetDiscoveryService = ({
  paths,
  targetRegistry,
  pathEnv = process.env.PATH ?? ""
}: TargetDiscoveryOptions): TargetDiscoveryService => {
  const listTargets = async (): Promise<TargetInfo[]> =>
    Promise.all(
      targetRegistry.listAdapters().map(async (adapter) => {
        const targetPaths = adapter.createTargetPaths({
          homeDir: paths.homeDir,
          fakeHomeRoot: paths.fakeHomeRoot
        });
        const executableName = adapter.descriptor.executableName;
        const executablePath = executableName
          ? await findExecutable(executableName, pathEnv)
          : undefined;
        const executableFound = executableName ? Boolean(executablePath) : true;
        const checks = await createChecks(targetPaths);
        const requiredChecks = checks.filter((check) => check.required);
        const requiredPathsExist = requiredChecks.every((check) => check.exists);
        const requiredPathsWritable = requiredChecks.every((check) => check.writable);
        const canWrite =
          adapter.descriptor.realWritesEnabled &&
          executableFound &&
          requiredPathsWritable;
        const status: TargetHealthStatus = !adapter.descriptor.realWritesEnabled
          ? "guarded"
          : !executableFound
            ? "missing"
            : requiredPathsExist && requiredPathsWritable
              ? "ready"
              : "needs-setup";
        const health: TargetHealth = {
          status,
          executableName,
          executablePath,
          executableFound,
          canWrite,
          summary: summarizeHealth(status, executableName, executableFound),
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
