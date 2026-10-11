import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { ConversationMessage } from "../../../shared/types";
import type { AgentConversationCandidate, AgentConversationCapability } from "../types";
import { candidateForFile, createConversationDetail, isoDate, listFilesRecursively, sourceIdFromFilename, trimConversationText, visibleMessage } from "../../conversations/adapterUtils";
import { readHistoryText } from "../../conversations/historyFileReader";

const agent = { id: "workbuddy", name: "WorkBuddy" };

export const parseWorkBuddyConversation = (candidate: AgentConversationCandidate, content: string) => {
  const messages: ConversationMessage[] = [];
  let title = candidate.title;
  let rank = 0;
  let workspacePath = candidate.workspacePath;
  let createdAt = candidate.createdAt;
  let updatedAt = candidate.updatedAt;
  let partial = false;
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { partial = true; continue; }
    if (!record || typeof record !== "object") { partial = true; continue; }
    workspacePath ||= trimConversationText(record.cwd) || undefined;
    const at = record.timestamp == null ? undefined : isoDate(record.timestamp, new Date(candidate.updatedAt));
    if (at) { createdAt ??= at; updatedAt = at; }
    const priority = record.type === "custom-title" ? 2 : record.type === "ai-title" ? 1 : 0;
    const value = trimConversationText(priority === 2 ? record.customTitle : record.aiTitle);
    if (priority && value && priority >= rank) { title = value; rank = priority; }
    if (record.type !== "message") continue;
    const text = typeof record.content === "string" ? record.content : Array.isArray(record.content)
      ? record.content.filter((block: any) => ["input_text", "output_text", "text"].includes(block?.type))
        .map((block: any) => trimConversationText(block.text)).filter(Boolean).join("\n\n") : "";
    const message = visibleMessage(String(record.id ?? `${candidate.recordId}:${index}`), record.role, text, at);
    if (message) messages.push(message);
  }
  return createConversationDetail(agent, {
    ...candidate, updatedAt,
    detailState: partial || messages.length === 0 ? "summary-only" : "full"
  }, messages, { title, workspacePath, createdAt });
};

export const createWorkBuddyConversationCapability = (): AgentConversationCapability => ({
  historyDetail: "full",
  discover: async ({ targetPaths }) => {
    const root = join(targetPaths.configDir, "projects");
    const failures: string[] = [];
    const candidates: AgentConversationCandidate[] = [];
    let present = false;
    try { present = (await stat(root)).isDirectory(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (present) {
      for (const path of await listFilesRecursively(root, (file) => file.endsWith(".jsonl"), { onIssue: (message) => failures.push(message) })) {
        try {
          let workspacePath: string | undefined;
          const metaPath = path.replace(/\.jsonl$/, ".meta.json");
          try {
            const location = relative(await realpath(root), await realpath(metaPath));
            if (isAbsolute(location) || location === ".." || location.startsWith("../") || location.startsWith("..\\")) throw new Error("WorkBuddy metadata link leaves the approved history source");
            workspacePath = trimConversationText(JSON.parse(await readFile(metaPath, "utf8")).cwd) || undefined;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(`${metaPath}: ${String(error)}`);
          }
          const candidate = await candidateForFile(path, { recordId: sourceIdFromFilename(path), workspacePath, detailState: "full", runtimeHome: targetPaths.configDir });
          candidate.source.version += `:${createHash("sha256").update(workspacePath ?? "").digest("hex")}`;
          candidates.push(candidate);
        } catch (error) { failures.push(`${path}: ${String(error)}`); }
      }
    }
    // Database-only WorkBuddy versions do not expose verified message storage yet.
    // Do not mistake their lack of JSONL exports for a complete empty inventory.
    try {
      await stat(join(targetPaths.configDir, "workbuddy.db"));
      failures.push("WorkBuddy database histories are not yet supported. Only exported JSONL histories can be searched; open WorkBuddy to read other conversations.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(String(error)); }
    return { candidates, complete: present && failures.length === 0, failures };
  },
  read: async (_context, candidate) => parseWorkBuddyConversation(candidate, await readHistoryText(candidate.source.locator))
});
