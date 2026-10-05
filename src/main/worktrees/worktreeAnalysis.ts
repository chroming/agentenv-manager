import type { AIAnalysisDocument } from "../../shared/aiAssistance";
import type { WorktreeEntry } from "../../shared/worktrees";
import type { GitCommandRunner } from "../skillSources/gitCommandRunner";

export const readWorktreeAnalysis = async (entry: WorktreeEntry, runner: GitCommandRunner) => {
  const documents: AIAnalysisDocument[] = [{ id: "state", label: "Worktree state", content: JSON.stringify({
    branch: entry.branch, head: entry.head, detached: entry.detached,
    kept: Boolean(entry.keptReason), locked: Boolean(entry.locked),
    reasons: entry.reasons, changes: entry.changes, ignored: entry.ignored, submodules: entry.submodules
  }) }];
  const warnings = ["Only local Git evidence is analyzed. MR status, squash integration and the task's purpose are not verified."];
  let partial = false;
  const read = async (args: string[], cwd = entry.path) => (await runner.run(
    ["-c", "core.fsmonitor=false", ...args],
    { cwd, env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: 8_000, maxOutputBytes: 64_000 }
  )).stdout;
  const collect = async (id: string, label: string, args: string[]) => {
    try { documents.push({ id, label, content: await read(args) }); }
    catch { partial = true; warnings.push(`${label} could not be read within the local evidence limits.`); }
  };
  // Disable Git's user-defined diff commands and text conversion: analysis is read-only.
  const diff = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--submodule=short"];
  let mainHead: string | undefined;
  try {
    const value = (await read(["rev-parse", "--verify", "HEAD"], entry.repositoryPath)).trim();
    if (!/^[a-f0-9]{40,64}$/.test(value)) throw new Error("Invalid main HEAD");
    mainHead = value;
    documents.push({ id: "baseline", label: "Local main tree baseline", content: JSON.stringify({ head: value }) });
  } catch { partial = true; warnings.push("The local main tree baseline is unavailable; integration cannot be compared."); }
  if (mainHead && entry.head) {
    await collect("commits", "Local commits not reachable from the main tree (up to 20)",
      ["log", "--no-show-signature", "--no-decorate", "--format=%h %s", "-20", `${mainHead}..${entry.head}`, "--"]);
    await collect("committed-diff", "Committed content compared with the local main tree",
      [...diff, mainHead, entry.head, "--"]);
  }
  await collect("local-diff", "Tracked changes, including staged and unstaged edits", [...diff, "HEAD", "--"]);
  if (entry.changes.some((path) => path.startsWith("?? ")) || entry.ignored.length || entry.submodules) {
    partial = true;
    warnings.push("Untracked, ignored and submodule file contents are not sent. Their value cannot be determined from paths alone.");
  }
  warnings.push("Binary file bodies and older commits are not included. Missing evidence is not proof that removal is safe.");
  return { documents, warnings, partial };
};
