import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
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

interface SkillChangeSetOptions {
  deferLargeContent?: boolean;
  deferAfterBytes?: number;
  deferAfterFiles?: number;
}

const changeFor = (
  path: string,
  current: Buffer | undefined,
  next: Buffer | undefined,
  deferred: boolean
): PlannedFileChange => {
  const before = deferred ? "" : displayFileContent(current);
  const after = deferred ? "" : displayFileContent(next);
  return {
    path,
    before,
    after,
    diff: deferred ? "" : createUnifiedDiff(path, before, after),
    beforeBytes: current?.byteLength ?? 0,
    afterBytes: next?.byteLength ?? 0,
    contentDeferred: deferred || undefined,
    action: next ? "write" : "remove"
  };
};

export const createSkillChangeSet = async (
  currentDir: string,
  nextDir: string,
  options: SkillChangeSetOptions = {}
): Promise<{ changes: PlannedFileChange[]; filePaths: string[] }> => {
  const currentFiles = await readSkillFiles(currentDir);
  const nextFiles = await readSkillFiles(nextDir);
  const filePaths = [...new Set([...currentFiles.keys(), ...nextFiles.keys()])].sort((a, b) => {
    if (a === "SKILL.md") return -1;
    if (b === "SKILL.md") return 1;
    return a.localeCompare(b);
  });

  const changedFiles = filePaths
    .map((path) => {
      const current = currentFiles.get(path);
      const next = nextFiles.get(path);
      if (current && next && current.equals(next)) return undefined;
      return { path, current, next };
    })
    .filter((change): change is {
      path: string;
      current: Buffer | undefined;
      next: Buffer | undefined;
    } => Boolean(change));
  const changedBytes = changedFiles.reduce(
    (total, file) => total + (file.current?.byteLength ?? 0) + (file.next?.byteLength ?? 0),
    0
  );
  const deferContent = options.deferLargeContent === true && (
    changedFiles.length > (options.deferAfterFiles ?? 20) ||
    changedBytes > (options.deferAfterBytes ?? 512 * 1024)
  );
  const changes = changedFiles.map(({ path, current, next }) =>
    changeFor(path, current, next, deferContent)
  );

  return { changes, filePaths };
};

const safeChangePath = (root: string, requestedPath: string) => {
  if (!requestedPath || isAbsolute(requestedPath) || requestedPath.includes("\0")) {
    throw new Error("Invalid Skill update file path");
  }
  const normalized = requestedPath.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Invalid Skill update file path");
  }
  const selected = resolve(root, normalized);
  const relativePath = relative(resolve(root), selected);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Skill update file path escapes the preview");
  }
  return selected;
};

const readOptionalFile = async (path: string): Promise<Buffer | undefined> => {
  try {
    return await readFile(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

export const readSkillFileChange = async (
  currentDir: string,
  nextDir: string,
  requestedPath: string
): Promise<PlannedFileChange> => {
  const [current, next] = await Promise.all([
    readOptionalFile(safeChangePath(currentDir, requestedPath)),
    readOptionalFile(safeChangePath(nextDir, requestedPath))
  ]);
  if (!current && !next) throw new Error("Skill update file is no longer available");
  return changeFor(requestedPath, current, next, false);
};

export const createSkillChanges = async (
  currentDir: string,
  nextDir: string
): Promise<PlannedFileChange[]> =>
  (await createSkillChangeSet(currentDir, nextDir)).changes;
