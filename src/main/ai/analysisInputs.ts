import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AIAnalysisSubject, AIAnalysisDocument } from "../../shared/aiAssistance";
import type { ProfileStore } from "../profileStore";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { EvaluationService } from "../evaluations/evaluationService";
import type { InstructionLibraryStore } from "../instructionLibraryStore";
import { SafeIdSchema } from "../../shared/schemas";
import { profileResourceMode, materializeTargetResourcePolicy } from "../../shared/profileResources";
import { createTargetRegistry } from "../targets/registry";

const documentSchema = z.object({ id: z.string().min(1).max(256), label: z.string().max(300), content: z.string().max(2_000_000) });
export const AnalysisSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile"), profileId: SafeIdSchema, targetId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("comparison"), runId: z.string().uuid() }),
  z.object({ kind: z.literal("duplicates"), objectId: z.string().max(1000).optional(), documents: z.array(documentSchema).min(2).max(10000) })
]);
export interface AnalysisDependencies {
  profileStore: Pick<ProfileStore, "readProfile">;
  library: Pick<SkillLibraryStore, "listSkills">;
  evaluationService: Pick<EvaluationService, "read">;
  instructions: Pick<InstructionLibraryStore, "read">;
}
export const createAnalysisInputs = (deps: AnalysisDependencies) => async (raw: AIAnalysisSubject) => {
  const subject = AnalysisSubjectSchema.parse(raw);
  const documents: AIAnalysisDocument[] = [];
  const warnings: string[] = [];
  if (subject.kind === "duplicates") {
    documents.push(...subject.documents);
    warnings.push("Only the selected version preview is analyzed; no version is selected automatically.");
  } else if (subject.kind === "comparison") {
    const result = (await deps.evaluationService.read({ runId: subject.runId }))?.result;
    if (!result) throw new Error("The comparison has no saved results to analyze.");
    documents.push({ id: "task", label: "Task", content: result.prompt });
    for (const side of [result.current, result.proposed]) {
      documents.push({ id: side.environment, label: side.environment === "current" ? "Agent now" : "With Profile", content: JSON.stringify({
        response: side.finalResponse, diff: side.diff, durationMs: side.durationMs, usage: side.usage ?? "Unavailable",
        exitCode: side.exitCode ?? "Unavailable", fidelity: side.fidelity, error: side.error,
        model: side.model, cliVersion: side.cliVersion
      }) });
    }
    if (result.fidelity === "partial" || result.current.error || result.proposed.error) warnings.push("This comparison is incomplete or excludes some resources.");
    warnings.push("A single comparison cannot establish consistent superiority. Missing metrics are unavailable, not zero.");
  } else {
    const targetId = subject.targetId.startsWith("ssh:") ? subject.targetId.split(":").at(-1)! : subject.targetId;
    const descriptor = createTargetRegistry().get(targetId).descriptor;
    const original = await deps.profileStore.readProfile(subject.profileId);
    const profile = materializeTargetResourcePolicy(original, targetId);
    const modes = Object.fromEntries((["instructions", "skills", "mcp"] as const).map((kind) => [kind, profileResourceMode(original.resources, targetId, kind)]));
    documents.push({ id: "scope", label: "Profile scope", content: JSON.stringify({ agent: descriptor.name, modes,
      mcp: modes.mcp === "manage" ? original.resources.mcpByTarget[targetId]?.selections.map(({ name, enabled }) => ({ name, enabled })) : [] }) });
    if (Object.values(modes).includes("ignore")) warnings.push("Agent-controlled resources are not read. Analysis covers only this Profile's managed intent.");
    if (modes.instructions === "manage") {
      documents.push({ id: "instructions", label: "AGENTS.md (combined)", content: profile.instructions });
      for (const ref of original.resources.instructions ?? []) if (ref.enabled) {
        try {
          const block = await deps.instructions.read(ref.libraryId);
          documents.push({ id: `instruction:${ref.libraryId}`, label: block.name, content: block.content });
        } catch { warnings.push(`Instruction ${ref.libraryId} is unavailable.`); }
      }
    }
    if (modes.skills === "manage") {
      const library = await deps.library.listSkills();
      const ids = new Set(profile.resources.skills.filter((ref) => ref.enabled).map((ref) => ref.libraryId));
      for (const id of ids) {
        const entry = library.find((entry) => entry.id === id);
        if (!entry) { warnings.push(`Skill ${id} is missing from Library.`); continue; }
        if (entry.globallyEnabled === false) continue;
        try {
          const path = join(entry.path, "SKILL.md");
          if (!(await lstat(path)).isFile()) throw new Error("Not a regular file");
          const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          try {
            const stat = await file.stat();
            if (stat.size > 1_000_000) throw new Error("Too large");
            const buffer = Buffer.alloc(1_000_001);
            const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
            if (bytesRead !== stat.size || buffer.subarray(0, bytesRead).includes(0)) throw new Error("Invalid text");
            documents.push({ id: `skill:${id}`, label: entry.name, content: new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)) });
          } finally { await file.close(); }
        } catch { warnings.push(`Skill ${id} could not be read safely; it is excluded.`); }
      }
    }
  }
  return { documents, warnings };
};
