import { createClaudeCodeTargetAdapter } from "../claudeCodeTarget";
import { createCodexTargetAdapter } from "../codexTarget";
import { createOpenCodeTargetAdapter } from "../opencodeTarget";
import type { AgentTargetAdapter } from "../types";
import { defineTargetIntegration } from "../defineTargetIntegration";
import { createAntigravityTargetAdapter } from "./antigravity";
import { createTraeCliTargetAdapter } from "./trae-cli";

const composeBuiltInIntegration = (
  adapter: AgentTargetAdapter
): AgentTargetAdapter => defineTargetIntegration({
  descriptor: adapter.descriptor,
  discovery: { detectInstallation: adapter.detectInstallation },
  paths: {
    createTargetPaths: adapter.createTargetPaths
  },
  profile: {
    createDefaultProfile: adapter.createDefaultProfile,
    captureProfile: adapter.captureProfile
  },
  preview: {
    createPreview: adapter.createPreview
  },
  skills: adapter.skills,
  conversations: adapter.conversations,
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
  createAntigravityTargetAdapter(),
  createTraeCliTargetAdapter()
];
