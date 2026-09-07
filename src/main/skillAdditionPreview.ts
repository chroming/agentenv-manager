import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillImportSnapshot, SkillUpdatePlan } from "../shared/types";
import type { SkillSummaryInput } from "../shared/skillSummaries";
import { hashSkillContent } from "./skillContentHash";
import { createSkillChanges } from "./skillFileChanges";
import { readSummarySnapshot } from "./skillSummaries/summaryInput";

// Source checkouts are temporary. Retain bounded immutable evidence, never their paths.
export const createSkillAdditionPreviews = () => {
  const entries = new Map<string, { at: number; snapshot: SkillSummaryInput }>();
  const lifetime = 30 * 60_000;
  return {
    async prepare(incoming: SkillImportSnapshot, sourceDir: string): Promise<SkillUpdatePlan> {
      const emptyDir = await mkdtemp(join(tmpdir(), "agentenv-addition-base-"));
      try {
        const changes = await createSkillChanges(emptyDir, sourceDir);
        const previewId = randomUUID();
        const beforeHash = await hashSkillContent(emptyDir);
        const snapshot = await readSummarySnapshot({
          previewId, id: incoming.id, candidateDir: sourceDir,
          candidateContentHash: incoming.contentHash,
          changePaths: changes.map((change) => change.path),
          expectedLibraryContentHash: beforeHash, expectedMetadataHash: "",
          createdAt: Date.now(), nextMetadata: {}
        }, emptyDir);
        for (const [key, entry] of entries) {
          if (Date.now() - entry.at > lifetime) entries.delete(key);
        }
        while (entries.size >= 20) entries.delete(entries.keys().next().value!);
        entries.set(previewId, { at: Date.now(), snapshot: { ...snapshot, kind: "addition" } });
        return {
          id: incoming.id, name: incoming.name, previewId, beforeContentHash: beforeHash,
          afterContentHash: incoming.contentHash, sourceType: incoming.sourceType,
          source: incoming.source, changes, errors: [], updateAvailable: true,
          impact: { profileNames: [], linkedInstallCount: 0, linkedTargetIds: [], copiedInstallCount: 0, copiedTargetIds: [] }
        };
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    },
    read(previewId: string): SkillSummaryInput | undefined {
      const entry = entries.get(previewId);
      if (!entry) return undefined;
      if (Date.now() - entry.at > lifetime) {
        entries.delete(previewId);
        throw new Error("Skill addition preview expired. Reopen the preview.");
      }
      return structuredClone(entry.snapshot);
    }
  };
};
