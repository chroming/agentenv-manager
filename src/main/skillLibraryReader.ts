import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SkillLibraryEntry, SkillRuntimeIssue } from "../shared/types";

const messageFor = (path: string, error: unknown) =>
  `Could not read Skill at ${path}. Refresh after checking this path. ${error instanceof Error ? error.message : String(error)}`;

export const createSkillLibraryReader = (
  rootFor: () => Promise<string>,
  readEntry: (id: string, path: string) => Promise<SkillLibraryEntry>
) => {
  // Display cache only. Strict callers never receive these snapshots on failure.
  const lastGood = new Map<string, SkillLibraryEntry>();
  let lastRoot: string | undefined;
  return async (onIssues?: (issues: SkillRuntimeIssue[]) => void): Promise<SkillLibraryEntry[]> => {
    const root = await rootFor();
    if (lastRoot !== root) lastGood.clear();
    lastRoot = root;
    const issues: SkillRuntimeIssue[] = [];
    let directories: string[];
    try {
      directories = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()))
        .map((entry) => entry.name).sort();
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
      if (missing && lastGood.size === 0) { onIssues?.([]); return []; }
      const message = messageFor(root, error);
      if (!onIssues) throw new Error(message);
      onIssues([{ code: "unreadable-skill-location", severity: "warning", message }]);
      return [...lastGood.values()].map((entry) => ({ ...entry, readIssue: message }));
    }
    const result: SkillLibraryEntry[] = [];
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, directories.length) }, async () => {
      while (index < directories.length) {
        const id = directories[index++];
        const path = join(root, id);
        try {
          if ((await lstat(path)).isSymbolicLink()) throw new Error("Library entry is a link. Import an independent copy before managing it.");
          const entry = await readEntry(id, path);
          lastGood.set(id, entry);
          result.push(entry);
        } catch (error) {
          const message = messageFor(path, error);
          issues.push({ code: "unreadable-skill", severity: "warning", message });
          result.push({
            ...(lastGood.get(id) ?? {
              id, path, name: id, description: "", sourceType: "local", updatePolicy: "untracked",
              contentHash: "", updatedAt: ""
            }),
            readIssue: message
          });
        }
      }
    }));
    for (const id of lastGood.keys()) if (!directories.includes(id)) lastGood.delete(id);
    if (!onIssues && issues.length) throw new Error(issues.map((issue) => issue.message).join("\n"));
    onIssues?.(issues);
    return result.sort((a, b) => a.name.localeCompare(b.name));
  };
};
