import { createHash } from "node:crypto";
import type {
  PlannedFileChange,
  TargetActivationPreview,
  TargetState
} from "../../../../shared/types";
import { profileManagesResource } from "../../../../shared/profileResources";
import { createApplyIssue } from "../../../applyIssues";
import { createUnifiedDiff } from "../../../diff";
import { readTextIfExists } from "../../../fileUtils";
import { findSecretWarnings } from "../../../secretWarnings";
import { createPiConversationCapability } from "../../conversations/piConversations";
import { createPiEvaluationCapability } from "../../evaluations/piEvaluation";
import type { AgentTargetIntegration } from "../../contract";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import { createCommandInstallationDriver } from "../../installationDiscovery";
import { createDirectoryAssetDriver } from "../../shared/assetDeployment";
import { createFilesystemSkillDriver } from "../../shared/skillRuntime";
import { resolvePiLayout } from "./layout";

const DEFAULT_STATE: TargetState = {
  formatVersion: 3,
  managedMcpNames: []
};

const hashText = (content: string) =>
  createHash("sha256").update(content).digest("hex");

const addChange = (
  changes: PlannedFileChange[],
  path: string,
  before: string,
  after: string
) => {
  if (before === after) return;
  changes.push({
    path,
    before,
    after,
    diff: createUnifiedDiff(path, before, after)
  });
};

const assets = createDirectoryAssetDriver({ targetName: "Pi" });
const skills = createFilesystemSkillDriver({ targetId: "pi" });

export const piIntegration: AgentTargetIntegration = {
  descriptor: {
    id: "pi",
    name: "Pi",
    description: "Manage Pi instructions and Skills.",
    iconKey: "pi",
    displayOrder: 5,
    instructionsLabel: "AGENTS.md",
    configLabel: "settings.json",
    configLanguage: "json",
    realWritesEnabled: true,
    executableName: "pi",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: [],
      disabledSkillPaths: false,
      mcpActivation: false,
      evaluation: true
    }
  },
  discovery: createCommandInstallationDriver("pi"),
  paths: {
    createTargetPaths: ({ homeDir, rootDirOverride, environment }) => {
      const layout = resolvePiLayout({ homeDir, rootDirOverride, environment });
      return {
        targetId: "pi",
        configDir: layout.agentRoot,
        runtimeDir: layout.sessionsRoot,
        instructionsPath: layout.instructionsPath,
        configPath: layout.settingsPath,
        skillsDir: layout.skillsDir,
        skillLocations: [{
          path: layout.skillsDir,
          role: "preferred-runtime",
          shared: false,
          scope: "user",
          scanDepth: "recursive",
          management: "managed"
        }],
        skillScanDirs: [layout.skillsDir],
        sharedSkillLocationIds: ["agents-skills"]
      };
    }
  },
  skills,
  conversations: createPiConversationCapability(),
  evaluations: createPiEvaluationCapability(),
  profile: {
    createDefaultProfile: (id) => ({
      id,
      manifest: {
        id,
        name: "Pi Daily Coding",
        description: "Default coding environment",
        iconKey: "pi",
        preferredTargetId: "pi",
        version: 2
      },
      instructions:
        "# Agent Guidance\n\n- Keep changes scoped and reversible.\n- Preview environment changes before applying them.\n",
      resources: { skills: [], mcpByTarget: {} }
    }),
    captureProfile: async (targetPaths) => {
      const [instructions, settings] = await Promise.all([
        readTextIfExists(targetPaths.instructionsPath),
        readTextIfExists(targetPaths.configPath)
      ]);
      return {
        instructions,
        mcpConnections: [],
        warnings: settings.trim()
          ? ["Pi settings, authentication, packages, and extensions remain Agent-owned"]
          : [],
        excluded: settings.trim() ? [targetPaths.configPath] : []
      };
    }
  },
  preview: {
    createPreview: async ({
      profile,
      targetPaths,
      state = DEFAULT_STATE
    }): Promise<TargetActivationPreview> => {
      const managesInstructions = profileManagesResource(
        profile.resources,
        targetPaths.targetId,
        "instructions"
      );
      const issues = (managesInstructions ? findSecretWarnings(profile.instructions) : []).map(
        (message) =>
          createApplyIssue({
            code: "secret-warning",
            resourceKind: "instructions",
            message
          })
      );
      const changes: PlannedFileChange[] = [];
      const liveInstructions = managesInstructions
        ? await readTextIfExists(targetPaths.instructionsPath)
        : "";
      if (managesInstructions) {
        addChange(
          changes,
          targetPaths.instructionsPath,
          liveInstructions,
          profile.instructions
        );
        if (liveInstructions !== profile.instructions) {
          issues.push(createApplyIssue({
            code: "runtime-reload-required",
            resourceKind: "instructions",
            path: targetPaths.instructionsPath,
            message: "Instruction changes load in new Pi sessions."
          }));
        }
      }
      if (profile.resources.mcpByTarget.pi?.mode === "manage") {
        issues.push(createApplyIssue({
          code: "unsupported-mcp-management",
          resourceKind: "mcp",
          message: "Pi has no built-in MCP configuration. Set this Profile to Ignore MCPs for Pi."
        }));
      }
      return {
        issues,
        changes,
        liveFingerprints: {
          ...(managesInstructions
            ? { [targetPaths.instructionsPath]: hashText(liveInstructions) }
            : {})
        },
        targetState: {
          ...state,
          formatVersion: 3,
          managedMcpNames: []
        }
      };
    }
  },
  assets
};

export const createPiTargetAdapter = () =>
  defineTargetIntegration(piIntegration);
