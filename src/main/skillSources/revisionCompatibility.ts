import { createHash } from "node:crypto";

export interface RevisionTreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

const normalizeDirectory = (value: string) => value.replace(/^\/+|\/+$/g, "");

export const githubContentsRevision = (
  directory: string,
  entries: readonly RevisionTreeEntry[]
) => {
  // Match readGitHubTree's Contents API traversal so Git and API scans share identity.
  const root = normalizeDirectory(directory);
  const prefix = root ? `${root}/` : "";
  const manifest = entries
    .filter((entry) => entry.path !== root && (!prefix || entry.path.startsWith(prefix)))
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `${entry.type === "tree" ? "dir" : "file"}:${entry.path}:${entry.sha}\n`)
    .join("");
  return createHash("sha1").update(manifest).digest("hex");
};
