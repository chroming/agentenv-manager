import { createClaudeCodeTargetAdapter } from "../claudeCodeTarget";
import { createCodexTargetAdapter } from "../codexTarget";
import { createOpenCodeTargetAdapter } from "../opencodeTarget";
import type { AgentTargetAdapter } from "../types";

/** The explicit built-in integration manifest used by Electron packaging. */
export const createBuiltInTargetAdapters = (): AgentTargetAdapter[] => [
  createOpenCodeTargetAdapter(),
  createClaudeCodeTargetAdapter(),
  createCodexTargetAdapter()
];
