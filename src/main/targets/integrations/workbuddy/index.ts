import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  TargetActivationPreview,
  TargetState
} from "../../../../shared/types";
import type { AgentTargetIntegration } from "../../contract";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import { createInstallationDriver } from "../../installationDiscovery";
import { createDirectoryAssetDriver } from "../../shared/assetDeployment";
import {
  createFilesystemSkillDriver,
  discoverSkillDirectories
} from "../../shared/skillRuntime";
import { pathExists } from "../../../fileUtils";

const DEFAULT_STATE: TargetState = {
  formatVersion: 3,
  managedMcpNames: []
};

const skills = createFilesystemSkillDriver({ targetId: "workbuddy" });
const assets = createDirectoryAssetDriver({ targetName: "WorkBuddy" });

const readSkillTree = async (root: string) => {
  if (!(await pathExists(root))) return [];
  const directManifest = await pathExists(join(root, "SKILL.md"));
  const issues: string[] = [];
  const nested = await discoverSkillDirectories(root, "recursive", (issue) => issues.push(issue.message));
  if (issues.length) throw new Error(issues.join("; "));
  return [ ...(directManifest ? [root] : []), ...nested.filter((entry) => !entry.brokenLink).map((entry) => entry.path)]
    .map((path) => ({ name: basename(path), path }));
};

const enabledConnectorIds = async (configDir: string, warnings: string[]) => {
  const connectorsDir = join(configDir, "connectors");
  const ids = new Set<string>();
  if (!(await pathExists(connectorsDir))) return [];
  const entries = await readdir(connectorsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statePath = join(connectorsDir, entry.name, "connector-states.v3.json");
    try {
      if (!(await pathExists(statePath))) continue;
      const text = await readFile(statePath, "utf8");
      const enabled = (JSON.parse(text) as { enabled?: unknown }).enabled;
      if (!Array.isArray(enabled)) throw new Error("Invalid Connector state");
      for (const id of enabled) {
        if (
          typeof id === "string" &&
          id === id.trim() &&
          id === basename(id) &&
          !id.includes("\\") &&
          id !== "." &&
          id !== ".."
        ) {
          ids.add(id);
        }
      }
    } catch {
      warnings.push(`Connector state could not be read: ${statePath}. Check the file and refresh review.`);
    }
  }
  return [...ids];
};

const inspectAgentControlledSkills = async (configDir: string, applicationPaths: string[], warnings: string[]) => {
  let bundled: Array<{ name: string; path: string }> = [];
  for (const applicationPath of applicationPaths) {
    const root = join(
      applicationPath,
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "resources",
      "plugins",
      "workbuddy-builtin"
    );
    if (!(await pathExists(join(root, ".codebuddy-plugin", "marketplace.json")))) continue;
    bundled = await readSkillTree(root);
    if (bundled.length > 0) break;
  }

  const connectors: Array<{ name: string; path: string }> = [];
  for (const id of await enabledConnectorIds(configDir, warnings)) {
    const connectorRoot = join(configDir, "connectors-marketplace", "connectors", id);
    connectors.push(...await readSkillTree(join(connectorRoot, "skills")));
    connectors.push(...await readSkillTree(join(connectorRoot, "skill")));
  }

  return [
    ...(bundled.length > 0
      ? [{ kind: "skill" as const, provider: "WorkBuddy", count: bundled.length, skills: bundled.map((skill) => ({ ...skill, availability: "bundled" as const })) }]
      : []),
    ...(connectors.length > 0
      ? [{ kind: "skill" as const, provider: "WorkBuddy Connectors", count: connectors.length, skills: connectors.map((skill) => ({ ...skill, availability: "unknown" as const })) }]
      : [])
  ];
};

export const workBuddyIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "workbuddy",
    name: "WorkBuddy",
    description: "Manage WorkBuddy user Skills without changing WorkBuddy settings or data.",
    displayOrder: 6,
    instructionsLabel: "Agent controlled",
    configLabel: "Agent controlled",
    configLanguage: "json",
    realWritesEnabled: true,
    executableCandidates: [],
    capabilities: {
      instructions: false,
      skills: true,
      mcpTransports: [],
      disabledSkillPaths: false,
      nativeConfig: false,
      mcpActivation: false,
      evaluation: false,
      evaluationUnavailableReason:
        "WorkBuddy does not expose a verified isolated one-shot runtime for Profile comparison."
    }
  },
  discovery: createInstallationDriver({
    commands: [],
    macApplications: [{
      bundleName: "WorkBuddy.app",
      bundleIdentifier: "com.tencent.workbuddy.mac",
      label: "WorkBuddy.app"
    }]
  }),
  paths: {
    createTargetPaths: ({ homeDir, rootDirOverride }) => {
      const configDir = rootDirOverride ?? join(homeDir, ".workbuddy");
      const skillsDir = join(configDir, "skills");
      return {
        targetId: "workbuddy",
        configDir,
        // WorkBuddy has no documented static Instructions file or AgentEnv-owned
        // native config. Capability-aware callers do not inspect these placeholders.
        instructionsPath: configDir,
        configPath: join(configDir, "settings.json"),
        skillsDir,
        skillLocations: [{
          path: skillsDir,
          role: "preferred-runtime",
          shared: false,
          scope: "user",
          scanDepth: "direct",
          management: "managed"
        }],
        skillScanDirs: [skillsDir]
      };
    }
  },
  skills,
  profile: {
    createDefaultProfile: (id) => ({
      id,
      manifest: {
        id,
        name: "WorkBuddy Profile",
        description: "Reusable WorkBuddy Skills",
        iconKey: "workbuddy",
        preferredTargetId: "workbuddy",
        version: 2
      },
      instructions: "",
      resources: {
        skills: [],
        managementByTarget: {
          workbuddy: { instructions: "ignore", skills: "manage" }
        },
        mcpByTarget: {
          workbuddy: { mode: "ignore", selections: [] }
        }
      }
    }),
    captureProfile: async (targetPaths, context) => {
      const warnings: string[] = [];
      const applicationPaths = (context?.installationEvidence ?? [])
        .filter((item) => item.kind === "desktop-app").map((item) => item.path);
      const agentControlledResources = await inspectAgentControlledSkills(targetPaths.configDir, applicationPaths, warnings)
        .catch((error: unknown) => {
          warnings.push(`WorkBuddy provided Skills could not be fully read. Refresh review after checking the source: ${error instanceof Error ? error.message : String(error)}`);
          return [];
        });
      return { instructions: "", mcpConnections: [], agentControlledResources, warnings, excluded: [] };
    }
  },
  preview: {
    createPreview: async ({ state = DEFAULT_STATE }): Promise<TargetActivationPreview> => ({
      issues: [],
      changes: [],
      liveFingerprints: {},
      targetState: {
        ...state,
        formatVersion: 3,
        managedMcpNames: []
      }
    })
  },
  assets
};

export const createWorkBuddyTargetAdapter = () =>
  defineTargetIntegration(workBuddyIntegration);
