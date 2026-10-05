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
  const target = entry.integration?.head;
  if (target && entry.head) {
    documents.push({ id: "baseline", label: "Integration target", content: JSON.stringify({ ref: entry.integration?.ref, head: target, merged: entry.integration?.merged }) });
    await collect("commits", "Local commits not reachable from the integration target (up to 20)",
      ["log", "--no-show-signature", "--no-decorate", "--format=%h %s", "-20", `${target}..${entry.head}`, "--"]);
    try {
      const count = Number((await read(["rev-list", "--count", `${target}..${entry.head}`, "--"])).trim());
      if (!Number.isSafeInteger(count) || count > 20) {
        partial = true;
        warnings.push("The commit list is incomplete; older commits must be reviewed separately.");
      }
      const ancestor = (await read(["merge-base", target, entry.head])).trim();
      if (!/^[a-f0-9]{40,64}$/.test(ancestor)) throw new Error("Invalid merge base");
      await collect("committed-diff", "Worktree branch changes since the common ancestor", [...diff, ancestor, entry.head, "--"]);
      await collect("target-diff", "Integration target changes since the common ancestor", [...diff, ancestor, target, "--"]);
      await collect("remaining-diff", "Remaining content differences (not necessarily unique Worktree changes)", [...diff, target, entry.head, "--"]);
    } catch { partial = true; warnings.push("The common ancestor or commit coverage is unavailable; integration cannot be inferred."); }
  } else {
    partial = true;
    warnings.push("No integration target is available. Choose a target branch in Worktree review before comparing committed work.");
  }
  await collect("local-diff", "Tracked changes, including staged and unstaged edits", [...diff, "HEAD", "--"]);
  if (entry.changes.some((path) => path.startsWith("?? ")) || entry.ignored.length || entry.submodules) {
    partial = true;
    warnings.push("Untracked, ignored and submodule file contents are not sent. Their value cannot be determined from paths alone.");
  }
  warnings.push("Binary file bodies and older commits are not included. Missing evidence is not proof that removal is safe.");
  return { documents, warnings, partial };
};
