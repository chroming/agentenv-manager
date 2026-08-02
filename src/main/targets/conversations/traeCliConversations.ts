import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
  AgentConversationCandidate,
  AgentConversationCapability
} from "../types";
import {
  candidateForFile,
  listFilesRecursively,
  sourceIdFromFilename
} from "../../conversations/adapterUtils";
import { readRolloutConversation } from "./rolloutConversations";

const agent = { id: "trae-cli", name: "Trae CLI" };

export const createTraeCliConversationCapability = (): AgentConversationCapability => ({
  historyDetail: "full",
  discover: async ({ homeDir, targetPaths }) => {
    const runtimeRoots = [...new Set([
      targetPaths.runtimeDir,
      join(targetPaths.configDir, "cli"),
      join(homeDir, ".trae", "cli")
    ].filter((path): path is string => Boolean(path)).map((path) => resolve(path)))];
    const candidates: AgentConversationCandidate[] = [];
    const failures: string[] = [];
    let selectedRuntimeRoot: string | undefined;
    let selectedRoots: Array<{ path: string; archived: boolean }> = [];
    for (const runtimeRoot of runtimeRoots) {
      const roots = [
        { path: join(runtimeRoot, "sessions"), archived: false },
        { path: join(runtimeRoot, "archived_sessions"), archived: true }
      ];
      for (const root of roots) {
        try {
          const info = await stat(root.path);
          if (!info.isDirectory()) {
            failures.push(`History path is not a directory: ${root.path}`);
            continue;
          }
          selectedRoots.push(root);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          failures.push(
            `Could not inspect ${root.path}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      if (selectedRoots.length > 0) {
        selectedRuntimeRoot = runtimeRoot;
        break;
      }
    }
    if (!selectedRuntimeRoot) {
      return {
        candidates,
        complete: false,
        ...(failures.length > 0 ? { failures } : {})
      };
    }
    for (const root of selectedRoots) {
      let files: string[];
      try {
        files = await listFilesRecursively(
          root.path,
          (path) => /^rollout-.*\.jsonl$/i.test(basename(path)),
          {
            shouldEnterDirectory: (_path, name) =>
              !name.endsWith(".artifacts") && name !== "background-tasks"
          }
        );
      } catch (error) {
        failures.push(
          `Could not scan ${root.path}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        continue;
      }
      for (const path of files) {
        const sourceId = sourceIdFromFilename(path);
        try {
          candidates.push(await candidateForFile(path, {
            recordId: sourceId,
            providerSession: {
              kind: "native",
              id: sourceId,
              resumeLocator: sourceId
            },
            runtimeHome: selectedRuntimeRoot,
            detailState: "full",
            archived: root.archived
          }));
        } catch (error) {
          failures.push(
            `Could not read ${path}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
    return {
      candidates,
      complete: selectedRoots.some((root) => !root.archived) && failures.length === 0,
      ...(failures.length > 0 ? { failures } : {})
    };
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
