import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import type { AgentEnvPaths } from "./paths";
import { isMissingFileError, pathExists } from "./fileUtils";
import { createExecutableResolver } from "./executableDiscovery";
import type { TargetRegistry } from "./targets/registry";
import { createTargetScope, type TargetScope } from "./targets/targetScope";
import { createSettingsStore, type SettingsStore } from "./settingsStore";
import { targetPathInputFor } from "./targets/pathInput";
import type {
  TargetHealth,
  TargetHealthStatus,
  TargetConversationCapabilities,
  TargetInfo,
  TargetPathCheck,
  TargetPaths
} from "../shared/types";

export interface TargetDiscoveryOptions {
  paths: AgentEnvPaths;
  targetRegistry: TargetRegistry;
  targetScope?: TargetScope;
  pathEnv?: string;
  systemPathLookup?: boolean;
  shellPathLookup?: boolean;
  platform?: NodeJS.Platform;
  allowSystemApplicationLookup?: boolean;
  settingsStore?: SettingsStore;
}

export interface TargetDiscoveryService {
  listTargets(options?: { forceRefresh?: boolean }): Promise<TargetInfo[]>;
  probeSupportedTargets(options?: { forceRefresh?: boolean }): Promise<TargetInfo[]>;
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
    paths.runtimeDir
      ? checkPath("runtimeDir", "Runtime directory", paths.runtimeDir, false)
      : undefined,
    checkPath("instructions", "Instructions", paths.instructionsPath, true),
    checkPath("config", "Config", paths.configPath, true),
    paths.mcpConfigPath
      ? checkPath("mcpConfig", "MCP config", paths.mcpConfigPath, false)
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
  targetName: string,
  installationFound: boolean,
  missingRequiredPaths: number
) => {
  if (status === "ready") {
    if (missingRequiredPaths > 0) {
      return "Ready; setup files will be created";
    }
    return "Ready";
  }
  if (status === "guarded") {
    if (!installationFound) {
      return `${targetName} writes guarded; installation not detected`;
    }
    return "Detected, protected";
  }
  if (status === "needs-setup") {
    return "Needs setup";
  }
  if (status === "unknown") {
    return `${targetName} detection could not complete`;
  }
  return `${targetName} not detected`;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const conversationCapabilitiesFor = (
  adapter: ReturnType<TargetRegistry["listAdapters"]>[number],
  health: TargetHealth
): TargetConversationCapabilities => {
  const conversations = adapter.conversations;
  const executableEvidence = health.executablePath
    ? [`Command: ${health.executablePath}`]
    : ["No compatible command was detected"];
  const installationEvidence = health.installationEvidence.map(
    (evidence) => `${evidence.label}: ${evidence.path}`
  );
  return {
    history: conversations
      ? {
          state: conversations.historyDetail === "full" ? "available" : "degraded",
          evidence: [
            conversations.historyDetail === "full"
              ? "Full local transcript reader"
              : "Local history exposes summaries only"
          ]
        }
      : {
          state: "unsupported",
          evidence: ["No local history reader is registered"]
        },
    openOriginal: conversations?.openOriginal
      ? {
          state: health.executablePath ? "available" : "unavailable",
          evidence: executableEvidence
        }
      : {
          state: "unsupported",
          evidence: ["This Agent has no verified native resume command"]
        },
    continue: health.executablePath && conversations?.continueWithContext
      ? {
          state: "available",
          evidence: executableEvidence,
          delivery: "context-file"
        }
      : health.installationFound
        ? {
            state: "degraded",
            evidence: [
              ...installationEvidence,
              "Continuation uses reviewed clipboard context"
            ],
            delivery: "clipboard"
          }
        : {
            state: conversations?.continueWithContext ? "unavailable" : "unsupported",
            evidence: conversations?.continueWithContext
              ? executableEvidence
              : ["No continuation path is available"]
          }
  };
};

export const createTargetDiscoveryService = (
  options: TargetDiscoveryOptions
): TargetDiscoveryService => {
  const platform = options.platform ?? process.platform;
  const settingsStore =
    options.settingsStore ?? createSettingsStore(options.paths, { platform });
  const targetScope =
    options.targetScope ?? createTargetScope(options.targetRegistry, settingsStore);
  const {
    paths,
    targetRegistry,
    pathEnv = process.env.PATH ?? "",
    systemPathLookup = options.pathEnv === undefined,
    shellPathLookup = options.pathEnv === undefined,
    allowSystemApplicationLookup = options.pathEnv === undefined
  } = options;
  const executableCache = new Map<
    string,
    { path?: string; checkedAt: number }
  >();
  const executableCacheTtlMs = 30_000;
  const executableResolver = createExecutableResolver({
    pathEnv,
    homeDir: paths.homeDir,
    platform,
    environment: process.env,
    systemPathLookup,
    shellPathLookup
  });
  const discoverExecutable = async (name: string, forceRefresh: boolean) => {
    const cached = executableCache.get(name);
    if (!forceRefresh && cached && Date.now() - cached.checkedAt < executableCacheTtlMs) {
      if (
        !cached.path ||
        await canAccess(
          cached.path,
          platform === "win32" ? constants.F_OK : constants.X_OK
        )
      ) {
        return cached.path;
      }
    }
    const path = await executableResolver.find(name);
    executableCache.set(name, { path, checkedAt: Date.now() });
    return path;
  };
  const discoverAdapters = async (
    adapters: ReturnType<TargetRegistry["listAdapters"]>,
    listOptions: { forceRefresh?: boolean } = {}
  ): Promise<TargetInfo[]> => {
    if (listOptions.forceRefresh) {
      executableResolver.invalidateShellPath();
    }
    const settings = await settingsStore.readSettings();
    return Promise.all(
      adapters.map(async (adapter) => {
        const targetPaths = adapter.createTargetPaths(
          targetPathInputFor(paths, settings, adapter.descriptor.id)
        );
        const executableName = adapter.descriptor.executableName;
        const executableCandidates = adapter.descriptor.executableCandidates;
        const executableOverride = settings.targetCommandOverrides?.[adapter.descriptor.id];
        const probeCandidates = [
          ...(executableOverride ? [executableOverride] : []),
          ...executableCandidates.filter((candidate) => candidate !== executableOverride)
        ];
        let executableCandidate: string | undefined;
        let executablePath: string | undefined;
        let executableProbeError: string | undefined;
        for (const candidate of probeCandidates) {
          try {
            const resolved = await discoverExecutable(
              candidate,
              listOptions.forceRefresh === true
            );
            if (resolved) {
              executableCandidate = candidate;
              executablePath = resolved;
              break;
            }
          } catch (error) {
            executableProbeError ??= errorMessage(error);
          }
        }

        let installation: Awaited<ReturnType<typeof adapter.detectInstallation>>;
        let installationError: string | undefined;
        try {
          installation = await adapter.detectInstallation({
            platform,
            homeDir: paths.homeDir,
            allowSystemApplicationLookup,
            findExecutable: async (name) => {
              if (
                executablePath &&
                executableCandidate === executableOverride &&
                executableCandidates.includes(name)
              ) {
                return executablePath;
              }
              if (executablePath && executableCandidate === name) return executablePath;
              if (probeCandidates.includes(name)) return undefined;
              return discoverExecutable(name, listOptions.forceRefresh === true);
            },
            pathExists: pathExistsByStat
          });
        } catch (error) {
          installationError = errorMessage(error);
          installation = { found: false, evidence: [] };
        }
        if (
          executablePath &&
          !installation.evidence.some((evidence) => evidence.kind === "command")
        ) {
          installation.evidence.unshift({
            kind: "command",
            label: `${executableCandidate ?? executableName ?? "Agent"} command`,
            path: executablePath
          });
          installation.found = true;
        }
        const commandEvidence = installation.evidence.find(
          (evidence) => evidence.kind === "command"
        );
        executablePath ??= commandEvidence?.path;
        executableCandidate ??= commandEvidence
          ? probeCandidates.find((candidate) => candidate === executableName) ?? executableName
          : undefined;
        const executableFound = Boolean(commandEvidence);
        const installationFound = installation.found;
        const executableError = executableProbeError ?? installationError;
        const executableStatus = executablePath
          ? "found" as const
          : executableError
            ? "unknown" as const
            : "missing" as const;
        const checks = await createChecks(targetPaths);
        const requiredChecks = checks.filter((check) => check.required);
        const missingRequiredPaths = requiredChecks.filter((check) => !check.exists).length;
        const requiredPathsWritable = requiredChecks.every((check) => check.writable);
        const canWrite =
          adapter.descriptor.realWritesEnabled &&
          installationFound &&
          requiredPathsWritable;
        const status: TargetHealthStatus = !adapter.descriptor.realWritesEnabled
          ? "guarded"
          : !installationFound && executableStatus === "unknown"
            ? "unknown"
          : !installationFound
            ? "missing"
            : requiredPathsWritable
              ? "ready"
              : "needs-setup";
        const health: TargetHealth = {
          status,
          installationFound,
          installationEvidence: installation.evidence,
          executableName,
          executableCandidates,
          executableStatus,
          executableCandidate,
          executableOverride,
          executableError,
          executablePath,
          executableFound,
          canWrite,
          summary: summarizeHealth(
            status,
            adapter.descriptor.name,
            installationFound,
            missingRequiredPaths
          ),
          checks
        };

        return {
          ...adapter.descriptor,
          paths: targetPaths,
          health,
          conversationCapabilities: conversationCapabilitiesFor(adapter, health)
        };
      })
    );
  };

  const listTargets = async (
    listOptions: { forceRefresh?: boolean } = {}
  ): Promise<TargetInfo[]> => discoverAdapters(
    await targetScope.listEnabledAdapters(),
    listOptions
  );

  const probeSupportedTargets = async (
    listOptions: { forceRefresh?: boolean } = {}
  ): Promise<TargetInfo[]> => discoverAdapters(targetRegistry.listAdapters(), listOptions);

  return { listTargets, probeSupportedTargets };
};
