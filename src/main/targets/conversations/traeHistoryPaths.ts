import { basename, dirname, join } from "node:path";

// Only the known sibling history folders belong to the compatibility scope.
// Never broaden a selected runtime into its entire parent configuration folder.
export const traeHistoryDirectories = (runtimeRoot: string) => {
  const roots = [runtimeRoot, ...(basename(runtimeRoot) === "cli" ? [dirname(runtimeRoot)] : [])];
  return roots.flatMap((root) => [
    { path: join(root, "sessions"), archived: false },
    { path: join(root, "archived_sessions"), archived: true }
  ]);
};
