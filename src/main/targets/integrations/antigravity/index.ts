import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  McpLibraryEntry,
  PlannedFileChange,
  ProfileDetail,
  TargetActivationPreview,
  TargetState
} from "../../../../shared/types";
import { createUnifiedDiff } from "../../../diff";
import { readTextIfExists } from "../../../fileUtils";
import { findSecretWarnings } from "../../../secretWarnings";
import type { AgentTargetIntegration } from "../../contract";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import { createAntigravityInstallationDriver } from "../../installationDiscovery";
import { createDirectoryAssetDriver } from "../../shared/assetDeployment";
import { createProfileFileDriver } from "../../shared/profileFiles";
import { sameJsonValue } from "../../capture";

const DEFAULT_STATE: TargetState = {
  managedConfigKeys: [],
  managedMcpNames: []
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const hashText = (content: string) =>
  createHash("sha256").update(content).digest("hex");

const parseJsonObject = (
  content: string,
  label: string
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } => {
  try {
    const parsed = JSON.parse(content.trim() || "{}");
    return isRecord(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, message: `${label}: expected a JSON object` };
  } catch (error) {
    return {
      ok: false,
      message: `${label}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
};

const addChange = (
  changes: PlannedFileChange[],
  path: string,
  before: string,
  after: string
) => {
  if (before === after) return;
  changes.push({ path, before, after, diff: createUnifiedDiff(path, before, after) });
};

const profileFiles = createProfileFileDriver({
  instructionsFile: "GEMINI.md",
  configFile: "mcp_config.json"
});

const assets = createDirectoryAssetDriver({ targetName: "Antigravity" });

const serializeMcpServer = (server: McpLibraryEntry) =>
  server.transport === "stdio"
    ? {
        command: server.command,
        ...(server.args?.length ? { args: server.args } : {})
      }
    : { serverUrl: server.url };

const materializeMcpRefs = (
  profile: ProfileDetail,
  mcpLibrary: McpLibraryEntry[]
): ProfileDetail => {
  const parsed = parseJsonObject(profile.configText, "Invalid Antigravity MCP config");
  if (!parsed.ok) throw new Error(parsed.message);
  if ("mcpServers" in parsed.value && !isRecord(parsed.value.mcpServers)) {
    throw new Error("Invalid Antigravity MCP config: mcpServers must be an object");
  }
  const byId = new Map(mcpLibrary.map((server) => [server.id, server]));
  const mcpServers = isRecord(parsed.value.mcpServers)
    ? cloneJson(parsed.value.mcpServers)
    : {};

  for (const reference of profile.assetPolicy.mcpRefs ?? []) {
    const server = byId.get(reference.libraryId);
    if (!server) {
      throw new Error(`MCP library server does not exist: ${reference.libraryId}`);
    }
    mcpServers[reference.targetName] = serializeMcpServer(server);
  }

  return {
    ...profile,
    configText: `${JSON.stringify({ ...parsed.value, mcpServers }, null, 2)}\n`
  };
};

const captureMcpServers = (value: unknown) => {
  const servers: McpLibraryEntry[] = [];
  const excluded: string[] = [];
  if (!isRecord(value)) return { servers, excluded };

  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      excluded.push(name);
      continue;
    }
    const id = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mcp-server";
    const serverUrl = typeof raw.serverUrl === "string"
      ? raw.serverUrl
      : typeof raw.url === "string"
        ? raw.url
        : undefined;
    if (
      serverUrl &&
      Object.keys(raw).every((key) => key === "serverUrl" || key === "url")
    ) {
      servers.push({ id, name, transport: "http", url: serverUrl, args: [], env: {} });
      continue;
    }
    const command = typeof raw.command === "string" ? raw.command : undefined;
    const validArgs = raw.args === undefined ||
      (Array.isArray(raw.args) && raw.args.every((arg) => typeof arg === "string"));
    const args = Array.isArray(raw.args) && validArgs
      ? raw.args
      : [];
    if (
      command &&
      validArgs &&
      Object.keys(raw).every((key) => key === "command" || key === "args")
    ) {
      servers.push({ id, name, transport: "stdio", command, args, env: {} });
      continue;
    }
    excluded.push(name);
  }

  return { servers, excluded };
};

const applyMcpOverlay = (
  liveConfig: Record<string, unknown>,
  profileServers: Record<string, unknown>,
  state: TargetState
) => {
  const nextConfig = cloneJson(liveConfig);
  const nextServers = isRecord(nextConfig.mcpServers)
    ? cloneJson(nextConfig.mcpServers)
    : {};
  for (const name of state.managedMcpNames) delete nextServers[name];
  for (const [name, server] of Object.entries(profileServers)) nextServers[name] = server;
  if (Object.keys(nextServers).length > 0) nextConfig.mcpServers = nextServers;
  else delete nextConfig.mcpServers;
  return `${JSON.stringify(nextConfig, null, 2)}\n`;
};

export const antigravityIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "antigravity",
    name: "Antigravity",
    description: "Manage global Antigravity rules, MCPs, and skills.",
    iconKey: "antigravity",
    displayOrder: 3,
    instructionsLabel: "GEMINI.md",
    configLabel: "mcp_config.json",
    configLanguage: "json",
    mcpConfigKey: "mcpServers",
    realWritesEnabled: true,
    executableName: "agy",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio", "http", "sse"],
      disabledSkillPaths: false,
      nativeConfig: false,
      mcpEnvironmentReferences: false
    }
  },
  discovery: createAntigravityInstallationDriver(),
  paths: {
    createTargetPaths: ({ homeDir }) => {
      const geminiDir = join(homeDir, ".gemini");
      const configDir = join(geminiDir, "config");
      const skillsDir = join(configDir, "skills");
      const cliSkillsDir = join(geminiDir, "antigravity-cli", "skills");
      return {
        targetId: "antigravity",
        configDir,
        instructionsPath: join(geminiDir, "GEMINI.md"),
        configPath: join(configDir, "mcp_config.json"),
        skillsDir,
        skillLocations: [
          { path: skillsDir, role: "preferred-runtime", shared: false },
          { path: cliSkillsDir, role: "discovery-only", shared: false }
        ],
        skillScanDirs: [skillsDir, cliSkillsDir]
      };
    }
  },
  profile: {
    createDefaultProfile: (id) => ({
      id,
      manifest: {
        id,
        targetId: "antigravity",
        name: "Antigravity Profile",
        description: "Antigravity rules, MCPs, and skills",
        version: 1,
        managed: { instructions: true, config: true, assets: true }
      },
      instructions: "# Antigravity Guidance\n\n- Keep changes scoped and reversible.\n",
      configText: "{\n  \"mcpServers\": {}\n}\n",
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [],
        mcpRefs: [],
        disabledSkillPaths: []
      }
    }),
    captureProfile: async (targetPaths) => {
      const [instructions, configText] = await Promise.all([
        readTextIfExists(targetPaths.instructionsPath),
        readTextIfExists(targetPaths.configPath)
      ]);
      const parsed = parseJsonObject(configText, "Invalid live Antigravity MCP config");
      if (!parsed.ok) throw new Error(parsed.message);
      const captured = captureMcpServers(parsed.value.mcpServers);
      const rootKeys = Object.keys(parsed.value).filter((key) => key !== "mcpServers");
      return {
        instructions,
        configText: "{\n  \"mcpServers\": {}\n}\n",
        mcpServers: captured.servers,
        disabledSkillPaths: [],
        warnings: captured.excluded.map(
          (name) => `MCP server ${name} was excluded because it contains unsupported or secret-bearing fields`
        ),
        excluded: rootKeys.map((key) => `mcp_config.json.${key}`).concat(
          captured.excluded.map((name) => `mcp_config.json.mcpServers.${name}`)
        )
      };
    },
    ...profileFiles
  },
  config: {
    createPreview: async ({
      profile,
      targetPaths,
      state = DEFAULT_STATE,
      allowMatchingUnmanagedConfig
    }): Promise<TargetActivationPreview> => {
      const warnings = findSecretWarnings(profile.instructions).concat(
        findSecretWarnings(profile.configText)
      );
      const errors: string[] = [];
      const changes: PlannedFileChange[] = [];
      const [liveInstructions, liveConfigText] = await Promise.all([
        readTextIfExists(targetPaths.instructionsPath),
        readTextIfExists(targetPaths.configPath)
      ]);
      if (profile.manifest.managed.instructions && [...profile.instructions].length > 12_000) {
        errors.push("Antigravity GEMINI.md exceeds the 12,000 character limit");
      }
      if (profile.manifest.managed.instructions) {
        addChange(changes, targetPaths.instructionsPath, liveInstructions, profile.instructions);
      }

      const profileConfig = profile.manifest.managed.config
        ? parseJsonObject(profile.configText, "Invalid profile Antigravity MCP config")
        : { ok: true as const, value: {} };
      if (!profileConfig.ok) errors.push(profileConfig.message);
      if (
        profileConfig.ok &&
        "mcpServers" in profileConfig.value &&
        !isRecord(profileConfig.value.mcpServers)
      ) {
        errors.push("Invalid profile Antigravity MCP config: mcpServers must be an object");
      }
      const profileServers = profileConfig.ok && isRecord(profileConfig.value.mcpServers)
        ? profileConfig.value.mcpServers
        : {};
      const shouldManageMcp = profile.manifest.managed.config &&
        (Object.keys(profileServers).length > 0 || state.managedMcpNames.length > 0);
      const liveConfig = shouldManageMcp
        ? parseJsonObject(liveConfigText, "Invalid live Antigravity MCP config")
        : { ok: true as const, value: {} };
      if (!liveConfig.ok) errors.push(liveConfig.message);

      if (profileConfig.ok && liveConfig.ok) {
        const liveServers = isRecord(liveConfig.value.mcpServers)
          ? liveConfig.value.mcpServers
          : {};
        const managedNames = new Set(state.managedMcpNames);
        for (const [name, server] of Object.entries(profileServers)) {
          if (
            name in liveServers &&
            !managedNames.has(name) &&
            !(allowMatchingUnmanagedConfig && sameJsonValue(liveServers[name], server))
          ) {
            errors.push(`MCP server ${name} already exists outside AgentEnv management`);
          }
        }
        if (errors.length === 0 && shouldManageMcp) {
          addChange(
            changes,
            targetPaths.configPath,
            liveConfigText,
            applyMcpOverlay(liveConfig.value, profileServers, state)
          );
        }
      }

      return {
        warnings,
        errors,
        changes,
        liveFingerprints: {
          ...(profile.manifest.managed.instructions
            ? { [targetPaths.instructionsPath]: hashText(liveInstructions) }
            : {}),
          ...(shouldManageMcp ? { [targetPaths.configPath]: hashText(liveConfigText) } : {})
        },
        targetState: {
          managedConfigKeys: [],
          managedMcpNames: errors.length === 0 ? Object.keys(profileServers).sort() : state.managedMcpNames
        }
      };
    }
  },
  mcp: { materializeMcpRefs },
  assets
};

export const createAntigravityTargetAdapter = () =>
  defineTargetIntegration(antigravityIntegration);
