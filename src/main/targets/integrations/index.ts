import { createClaudeCodeTargetAdapter } from "../claudeCodeTarget";
import { createCodexTargetAdapter } from "../codexTarget";
import { createOpenCodeTargetAdapter } from "../opencodeTarget";
import type { AgentTargetAdapter } from "../types";
import { defineTargetIntegration } from "../defineTargetIntegration";
import { createCommandInstallationDriver } from "../installationDiscovery";
import { createAntigravityTargetAdapter } from "./antigravity";

const composeBuiltInIntegration = (
  adapter: AgentTargetAdapter
): AgentTargetAdapter => defineTargetIntegration({
  descriptor: adapter.descriptor,
  discovery: createCommandInstallationDriver(
    adapter.descriptor.executableName ?? adapter.descriptor.id
  ),
  paths: {
    createTargetPaths: adapter.createTargetPaths
  },
  profile: {
    createDefaultProfile: adapter.createDefaultProfile,
    captureProfile: adapter.captureProfile,
    readProfileFiles: adapter.readProfileFiles,
    writeProfileFiles: adapter.writeProfileFiles
  },
  config: {
    createPreview: adapter.createPreview
  },
  mcp: {
    materializeMcpRefs: adapter.materializeMcpRefs
  },
  skills: adapter.skills,
  assets: {
    validateAssets: adapter.validateAssets,
    getAssetBackupPaths: adapter.getAssetBackupPaths,
    applyAssets: adapter.applyAssets
  }
});

/** The explicit built-in integration manifest used by Electron packaging. */
export const createBuiltInTargetAdapters = (): AgentTargetAdapter[] => [
  composeBuiltInIntegration(createOpenCodeTargetAdapter()),
  composeBuiltInIntegration(createClaudeCodeTargetAdapter()),
  composeBuiltInIntegration(createCodexTargetAdapter()),
  createAntigravityTargetAdapter()
];
