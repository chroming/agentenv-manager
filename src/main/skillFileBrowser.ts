import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { SafeIdSchema } from "../shared/schemas";
import type {
  SkillFileContent,
  SkillFileNode
} from "../shared/types";
import type { AgentEnvPaths } from "./paths";
import { resolveSkillsLibraryDir, type SettingsStore } from "./settingsStore";

const MAX_TREE_ENTRIES = 2_000;
const MAX_PREVIEW_BYTES = 1024 * 1024;
const HIDDEN_LIBRARY_FILES = new Set([".agentenv-skill.json", ".agentenv-owner.json"]);

const isContained = (root: string, path: string) => {
  const child = relative(root, path);
  return child.length > 0 && !child.startsWith("..") && !isAbsolute(child);
};

const skillRootFor = async (
  paths: AgentEnvPaths,
  settingsStore: SettingsStore,
  id: string
) => {
  const safeId = SafeIdSchema.parse(id);
  const settings = await settingsStore.readSettings();
  const libraryRoot = await realpath(resolveSkillsLibraryDir(paths, settings));
  const skillRoot = await realpath(join(libraryRoot, safeId));
  if (!isContained(libraryRoot, skillRoot)) {
    throw new Error("Skill path is outside the AgentEnv Library");
  }
  return skillRoot;
};

export const createSkillFileBrowser = (
  paths: AgentEnvPaths,
  settingsStore: SettingsStore
) => {
  const list = async (id: string): Promise<SkillFileNode[]> => {
    const skillRoot = await skillRootFor(paths, settingsStore, id);
    let entryCount = 0;
    const walk = async (directory: string, prefix = ""): Promise<SkillFileNode[]> => {
      const entries = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => !HIDDEN_LIBRARY_FILES.has(entry.name))
        .sort((left, right) => {
          if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
          return left.name.localeCompare(right.name);
        });
      const nodes: SkillFileNode[] = [];
      for (const entry of entries) {
        entryCount += 1;
        if (entryCount > MAX_TREE_ENTRIES) {
          throw new Error(`Skill contains more than ${MAX_TREE_ENTRIES} files and folders`);
        }
        const absolutePath = join(directory, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const entryStats = await lstat(absolutePath);
        if (entryStats.isSymbolicLink()) continue;
        if (entryStats.isDirectory()) {
          nodes.push({
            kind: "directory",
            name: entry.name,
            path: relativePath,
            children: await walk(absolutePath, relativePath)
          });
        } else if (entryStats.isFile()) {
          nodes.push({
            kind: "file",
            name: entry.name,
            path: relativePath,
            sizeBytes: entryStats.size
          });
        }
      }
      return nodes;
    };
    return walk(skillRoot);
  };

  const read = async (id: string, requestedPath: string): Promise<SkillFileContent> => {
    if (!requestedPath || isAbsolute(requestedPath) || requestedPath.includes("\0")) {
      throw new Error("Invalid Skill file path");
    }
    const skillRoot = await skillRootFor(paths, settingsStore, id);
    const requested = resolve(skillRoot, requestedPath);
    if (!isContained(skillRoot, requested)) {
      throw new Error("Skill file path escapes the Library Skill");
    }
    const filePath = await realpath(requested);
    if (!isContained(skillRoot, filePath)) {
      throw new Error("Skill file resolves outside the Library Skill");
    }
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error("Selected Skill entry is not a file");
    if (fileStats.size > MAX_PREVIEW_BYTES) {
      return { path: requestedPath, kind: "too-large", sizeBytes: fileStats.size };
    }
    const content = await readFile(filePath);
    if (content.subarray(0, 8_192).includes(0)) {
      return { path: requestedPath, kind: "binary", sizeBytes: fileStats.size };
    }
    return {
      path: requestedPath,
      kind: "text",
      sizeBytes: fileStats.size,
      content: content.toString("utf8")
    };
  };

  return { list, read };
};
