import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathEntryExists } from "../../fileUtils";
import { assertConversationPath } from "../../conversations/conversationDeletion";
import type { AgentConversationCandidate, AgentConversationContext } from "../types";

export const collectConversationDeletionFiles = async (
  agentId: string, context: AgentConversationContext, candidate: AgentConversationCandidate,
  relatedCandidates: AgentConversationCandidate[]
): Promise<{ files: string[]; roots: string[]; warnings: string[] }> => {
  const home = context.targetPaths.configDir;
  const sessionId = candidate.providerSession?.id ?? candidate.recordId;
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("This session identifier cannot be safely deleted");
  let roots: string[];
  const selected = new Set<string>();
  const warnings: string[] = [];
  if (agentId === "claude-code") {
    roots = [join(home, "projects"), join(home, "file-history"), join(home, "session-env"), join(home, "todos")];
  } else if (agentId === "codex") {
    roots = [join(home, "sessions"), join(home, "archived_sessions")];
  } else if (agentId === "pi") {
    roots = [...new Set([context.targetPaths.runtimeDir, join(home, "sessions")].filter((root): root is string => Boolean(root)))];
  } else {
    throw new Error("Deleting original history is not supported for this Agent yet. Its files and search index have not been changed.");
  }
  const add = async (path: string) => {
    if (!(await pathEntryExists(path))) return;
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Conversation contains a symbolic link: ${path}`);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await add(join(path, name));
    } else {
      await assertConversationPath(path, roots);
      selected.add(resolve(path));
    }
  };
  const candidates = relatedCandidates.filter((item) => (item.providerSession?.id ?? item.recordId) === sessionId);
  if (!candidates.some((item) => item.source.locator === candidate.source.locator)) candidates.push(candidate);
  if (agentId === "codex" || agentId === "pi") {
    const stem = basename(candidate.source.locator).replace(/\.jsonl(?:\.(?:gz|zst|zstd))?$/, "");
    const parents = new Set(candidates.map((item) => dirname(item.source.locator)));
    if (agentId === "codex") parents.add(join(home, "archived_sessions"));
    for (const parent of parents) {
      for (const name of await readdir(parent).catch((error) => {
        if (error.code !== "ENOENT") warnings.push("Some additional history files could not be checked. Only the listed files will be deleted.");
        return [];
      })) {
        if (name.replace(/\.jsonl(?:\.(?:gz|zst|zstd))?$/, "") !== stem || !/\.jsonl(?:\.(?:gz|zst|zstd))?$/.test(name)) continue;
        const locator = join(parent, name);
        if (!candidates.some((item) => item.source.locator === locator)) candidates.push({ ...candidate, source: { ...candidate.source, locator } });
      }
    }
  }
  for (const item of candidates) {
    await add(item.source.locator);
    if (agentId === "claude-code") await add(join(dirname(item.source.locator), sessionId));
    if (agentId === "codex") await add(item.source.locator.replace(/\.jsonl(?:\.(?:gz|zst|zstd))?$/, ".artifacts"));
  }
  if (agentId === "claude-code") {
    await add(join(home, "file-history", sessionId));
    await add(join(home, "session-env", sessionId));
    const todos = join(home, "todos");
    if (await pathEntryExists(todos)) {
      for (const name of await readdir(todos)) if (name.startsWith(`${sessionId}-`) && name.endsWith(".json")) await add(join(todos, name));
    }
  }
  if (!selected.size) throw new Error("The original conversation files are no longer available");
  return { files: [...selected].sort(), roots, warnings: [...new Set(warnings)] };
};

