import { structuredPatch } from "diff";

// Priority is a budget heuristic, never a security verdict. Unknown files still participate.
export const evidencePriority = (path: string) => /(^|\/)SKILL\.md$/i.test(path) ? 0
  : /\.(sh|bash|zsh|ps1|py|js|ts|mjs|cjs|exe)$|(^|\/)(package\.json|.*lock.*|requirements.*|Dockerfile)$/i.test(path) ? 1 : 2;
const riskSignal = /credential|password|token|secret|curl|wget|https?:|sudo|rm\s+-|delete|remove|permission|allow|deny|sandbox|exec|eval|upload|validate|verify|confirm|auth/i;

export const selectDiffEvidence = (path: string, before: string, after: string, budget: number) => {
  const patch = structuredPatch(path, path, before, after, "before", "after", { context: 3 });
  const header = `--- ${path}\tbefore\n+++ ${path}\tafter\n`;
  let bytes = Buffer.byteLength(JSON.stringify({ path, diff: header }));
  const selected: Array<{ index: number; text: string }> = [];
  let partial = false;
  const fragments = patch.hunks.flatMap((hunk) => {
    let oldStart = hunk.oldStart;
    let newStart = hunk.newStart;
    const result: typeof patch.hunks = [];
    for (let offset = 0; offset < hunk.lines.length; offset += 60) {
      const lines = hunk.lines.slice(offset, offset + 60);
      const oldLines = lines.filter((line) => line.startsWith("-") || line.startsWith(" ")).length;
      const newLines = lines.filter((line) => line.startsWith("+") || line.startsWith(" ")).length;
      result.push({ oldStart, newStart, oldLines, newLines, lines });
      oldStart += oldLines; newStart += newLines;
    }
    return result;
  });
  const hunks = fragments.map((hunk, index) => ({ hunk, index,
    priority: hunk.lines.some((line) => /^[+-]/.test(line) && riskSignal.test(line)) ? 0 : 1
  })).sort((a, b) => a.priority - b.priority || a.index - b.index);
  for (const { hunk, index } of hunks) {
    const text = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}\n`;
    const size = Buffer.byteLength(JSON.stringify(text));
    if (bytes + size <= budget) { selected.push({ index, text }); bytes += size; }
    else partial = true;
  }
  return { diff: selected.length ? header + selected.sort((a, b) => a.index - b.index).map((item) => item.text).join("") : undefined, partial };
};
