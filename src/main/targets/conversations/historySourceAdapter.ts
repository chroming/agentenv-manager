import { join } from "node:path";
import type { ConversationDetail } from "../../../shared/types";
import type { AgentConversationCandidate } from "../types";
import { createConversationDetail, visibleMessage } from "../../conversations/adapterUtils";
import { parseRolloutConversation } from "./rolloutConversations";
import { parseClaudeConversation } from "./claudeConversations";
import { parsePiConversation } from "./piConversations";
import { opencodeDataDirs, parseOpenCodeExportMessages } from "./opencodeConversations";
import { userRequestText } from "./antigravityConversations";
import { traeHistoryDirectories } from "./traeHistoryPaths";

const defaultRemoteRoots: Record<string, string> = {
  codex: "~/.codex", "claude-code": "~/.claude", "trae-cli": "~/.trae/cli",
  pi: "~/.pi/agent", opencode: "~/.local/share/opencode",
  antigravity: "~/.gemini/antigravity-cli", "antigravity-app": "~/.gemini/antigravity"
};

// The full transcript is parsed, not a head/tail excerpt. Tools remain opt-in at
// query time and are never sent to an AI provider.
export const parseHistoryText = (agentId: string, name: string, candidate: AgentConversationCandidate, content: string): ConversationDetail => {
  let detail: ConversationDetail;
  if (agentId === "codex" || agentId === "trae-cli") detail = parseRolloutConversation({ id: agentId, name }, candidate, content);
  else if (agentId === "claude-code") detail = parseClaudeConversation(candidate, content);
  else if (agentId === "pi") detail = parsePiConversation(candidate, content, true);
  else if (agentId === "opencode") detail = createConversationDetail({ id: agentId, name }, candidate, parseOpenCodeExportMessages(JSON.parse(content)));
  else {
    const messages = content.split(/\r?\n/).flatMap((line, i) => {
      if (!line.trim()) return [];
      try {
        const item = JSON.parse(line);
        const text = typeof item.content === "string" ? item.content : "";
        const message = visibleMessage(String(i), item.source === "USER_EXPLICIT" && item.type === "USER_INPUT" ? "user" : item.source === "MODEL" ? "assistant" : "unknown", item.source === "USER_EXPLICIT" ? userRequestText(text) : text, item.created_at);
        return message ? [message] : [];
      } catch { return []; }
    });
    detail = createConversationDetail({ id: agentId, name }, candidate, messages);
  }
  const toolText: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const payload = record.payload ?? record.message ?? record;
      if (/function_call|tool|command_execution/i.test(String(payload.type ?? payload.role ?? ""))) toolText.push(JSON.stringify(payload));
      for (const block of Array.isArray(payload.content) ? payload.content : []) {
        if (/tool/i.test(String(block.type))) toolText.push(JSON.stringify(block));
      }
      for (const message of record.messages ?? []) {
        for (const part of message.parts ?? []) if (part.type === "tool") toolText.push(JSON.stringify(part));
      }
    } catch { /* Parser diagnostics are recorded by the collector. */ }
  }
  return { ...detail, toolText: toolText.join("\n") };
};

export const historyReaderPolicy = (agentId: string) => ({
  warnOnPartial: agentId === "trae-cli",
  explicitRoots: agentId === "opencode" || agentId === "trae-cli" || agentId.startsWith("antigravity"),
  directoryJsonl: agentId !== "opencode" && !agentId.startsWith("antigravity"),
  allBranches: agentId === "pi"
});

export const historyScopeRoots = (agentId: string, root: string, kind: string): string[] =>
  agentId === "trae-cli" && kind === "default"
    ? traeHistoryDirectories(root).map((entry) => entry.path) : [root];

export const historyFilePath = (candidate: AgentConversationCandidate): string => {
  const locator = candidate.source.locator;
  if (locator.startsWith("opencode-sqlite:")) return locator.slice("opencode-sqlite:".length, locator.lastIndexOf("#"));
  return locator;
};

export const additionalHistoryDirectoriesFor = (agentId: string, paths: {configDir: string; runtimeDir?: string}): string[] =>
  agentId === "pi" && paths.runtimeDir && paths.runtimeDir !== join(paths.configDir, "sessions")
    ? [paths.runtimeDir]
    : [];

export const historyRootsFor = (agentId: string, homeDir: string, paths: {configDir: string; runtimeDir?: string}, local: boolean, environment: NodeJS.ProcessEnv = process.env): string[] => {
  if (!local) return defaultRemoteRoots[agentId] ? [defaultRemoteRoots[agentId]] : [];
  if (agentId === "opencode") return opencodeDataDirs(homeDir, process.platform, environment);
  if (agentId === "trae-cli") return [...new Set([paths.runtimeDir, join(paths.configDir,"cli")].filter((s):s is string=>Boolean(s)))];
  if (agentId.startsWith("antigravity")) return [join(paths.configDir,"..",agentId === "antigravity-app" ? "antigravity" : "antigravity-cli")];
  return [paths.configDir];
};
