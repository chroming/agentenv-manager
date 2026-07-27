import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AgentConversationCapability } from "../types";
import {
  candidateForFile,
  listFilesRecursively,
  sourceIdFromFilename
} from "../../conversations/adapterUtils";
import { readRolloutConversation } from "./rolloutConversations";

const agent = { id: "trae-cli", name: "Trae CLI" };

export const createTraeCliConversationCapability = (): AgentConversationCapability => ({
  historyDetail: "full",
  discover: async ({ targetPaths }) => {
    const runtimeRoot = targetPaths.runtimeDir;
    if (!runtimeRoot) return { candidates: [], complete: false };
    const roots = [
      { path: join(runtimeRoot, "sessions"), archived: false },
      { path: join(runtimeRoot, "archived_sessions"), archived: true }
    ];
    const candidates = [];
    let primaryRootObserved = false;
    for (const root of roots) {
      try {
        await stat(root.path);
        if (!root.archived) primaryRootObserved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const files = await listFilesRecursively(
        root.path,
        (path) => /^rollout-.*\.jsonl$/i.test(basename(path)),
        {
          shouldEnterDirectory: (_path, name) =>
            !name.endsWith(".artifacts") && name !== "background-tasks"
        }
      );
      for (const path of files) {
        const sourceId = sourceIdFromFilename(path);
        candidates.push(await candidateForFile(path, {
          recordId: sourceId,
          providerSession: {
            kind: "native",
            id: sourceId,
            resumeLocator: sourceId
          },
          runtimeHome: runtimeRoot,
          detailState: "full",
          archived: root.archived
        }));
      }
    }
    return { candidates, complete: primaryRootObserved };
  },
  read: async (_context, candidate, previous) =>
    readRolloutConversation(agent, candidate, previous),
  openOriginal: ({ executablePath, targetPaths }, candidate) => executablePath
    ? {
        executablePath,
        args: [
          "resume",
          candidate.providerSession?.resumeLocator ??
            candidate.providerSession?.id ??
            candidate.recordId
        ],
        cwd: candidate.workspacePath,
        env: {
          TRAE_HOME: targetPaths.configDir,
          TRAECLI_HOME: candidate.source.runtimeHome ?? targetPaths.runtimeDir!
        }
      }
    : undefined
});
