import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { PlannedFileChange } from "../shared/types";
import { createUnifiedDiff } from "./diff";

const readSkillFiles = async (root: string) => {
  const files = new Map<string, Buffer>();

  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".agentenv-skill.json" || entry.name === ".agentenv-owner.json") {
        continue;
      }
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        files.set(relative(root, child), await readFile(child));
      }
    }
  };

  await walk(root);
  return files;
};

const displayFileContent = (content: Buffer | undefined) => {
  if (!content) return "";
  if (content.length === 0) return "[empty file]\n";
  const binarySummary = () => {
    const digest = createHash("sha256").update(content).digest("hex");
    return `[binary file: ${content.length} bytes, sha256 ${digest}]\n`;
  };
  if (content.includes(0)) return binarySummary();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return binarySummary();
  }
};

export const createSkillChanges = async (
  currentDir: string,
  nextDir: string
): Promise<PlannedFileChange[]> => {
  const currentFiles = await readSkillFiles(currentDir);
  const nextFiles = await readSkillFiles(nextDir);
  const filePaths = [...new Set([...currentFiles.keys(), ...nextFiles.keys()])].sort((a, b) => {
    if (a === "SKILL.md") return -1;
    if (b === "SKILL.md") return 1;
    return a.localeCompare(b);
  });

  return filePaths
    .map((path) => {
      const current = currentFiles.get(path);
      const next = nextFiles.get(path);
      if (current && next && current.equals(next)) return undefined;
      const before = displayFileContent(current);
      const after = displayFileContent(next);
      return { path, before, after, diff: createUnifiedDiff(path, before, after) };
    })
    .filter((change): change is PlannedFileChange => Boolean(change));
};
