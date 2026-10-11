import type { AgentConversationCandidate } from "../targets/types";

// Only sibling representations of the same file are candidates for collapsing.
// A matching session ID or timestamp alone does not establish duplicate content.
export const collapseCompressedHistoryCopies = async (
  candidates: AgentConversationCandidate[],
  read: (candidate: AgentConversationCandidate) => Promise<string>,
  onIssue: (message: string) => void,
  verifiedCopies = new Map<string, string | undefined>(),
  sourceKey = ""
) => {
  const byPath = new Map(candidates.map((candidate) => [candidate.source.locator, candidate]));
  const redundant = new Set<AgentConversationCandidate>();
  const prefix = (shorter: string, longer: string) =>
    shorter.endsWith("\n") && longer.startsWith(shorter);
  for (const compressed of candidates) {
    if (!compressed.source.locator.endsWith(".jsonl.zst")) continue;
    const plain = byPath.get(compressed.source.locator.slice(0, -4));
    if (!plain) continue;
    const key = JSON.stringify([sourceKey, plain.source, compressed.source]);
    if (verifiedCopies.has(key)) {
      const path = verifiedCopies.get(key);
      if (path === plain.source.locator) redundant.add(plain);
      if (path === compressed.source.locator) redundant.add(compressed);
      continue;
    }
    try {
      const plainText = await read(plain);
      const compressedText = await read(compressed);
      if (plainText === compressedText || prefix(compressedText, plainText)) redundant.add(compressed);
      else if (prefix(plainText, compressedText)) redundant.add(plain);
      verifiedCopies.set(key, redundant.has(compressed) ? compressed.source.locator : redundant.has(plain) ? plain.source.locator : undefined);
      if (verifiedCopies.size > 64) verifiedCopies.delete(verifiedCopies.keys().next().value!);
    } catch (error) {
      // Retain both candidates and old indexed entries if compression is still in progress.
      onIssue(`${compressed.source.locator}: Could not compare compressed history; cached conversations are kept. ${String(error)}`);
    }
  }
  return candidates.filter((candidate) => !redundant.has(candidate));
};
