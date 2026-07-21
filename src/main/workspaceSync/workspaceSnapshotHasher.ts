import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { PortableWorkspaceManifest } from "./portableSchemas";

export const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)])
  );
};

export const canonicalJson = (value: unknown): string =>
  `${JSON.stringify(sortValue(value), null, 2)}\n`;

export const hashJson = (value: unknown): string => sha256(canonicalJson(value));

export interface PortableTreeEntry {
  path: string;
  mode: number;
  size: number;
  hash: string;
}

export const inspectPortableTree = async (
  root: string,
  limits: { maxFiles?: number; maxBytes?: number } = {}
): Promise<PortableTreeEntry[]> => {
  const entries: PortableTreeEntry[] = [];
  let totalBytes = 0;
  const visit = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git" || entry.name === ".agentenv-owner.json" || entry.name === ".agentenv-skill.json") {
        throw new Error(`Portable Workspace contains reserved AgentEnv data: ${relative(root, join(directory, entry.name))}`);
      }
      const path = join(directory, entry.name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        throw new Error(`Portable Workspace cannot contain symbolic links: ${relative(root, path)}`);
      }
      if (stats.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(`Portable Workspace contains an unsupported file: ${relative(root, path)}`);
      }
      const content = await readFile(path);
      totalBytes += content.byteLength;
      entries.push({
        path: relative(root, path).split(sep).join("/"),
        mode: stats.mode & 0o111 ? 0o755 : 0o644,
        size: content.byteLength,
        hash: sha256(content)
      });
      if (entries.length > (limits.maxFiles ?? 1_000)) {
        throw new Error(`Portable Workspace exceeds the ${limits.maxFiles ?? 1_000} file limit`);
      }
      if (totalBytes > (limits.maxBytes ?? 20 * 1024 * 1024)) {
        throw new Error(`Portable Workspace exceeds the ${limits.maxBytes ?? 20 * 1024 * 1024} byte limit`);
      }
    }
  };
  await visit(root);
  return entries;
};

export const hashPortableTree = async (root: string): Promise<string> =>
  hashJson(await inspectPortableTree(root));

export const snapshotHashFor = (
  manifest: Omit<PortableWorkspaceManifest, "snapshotHash">
): string => hashJson(manifest);
