import { describe, expect, it } from "vitest";
import { projectBackups, projectInstructions, sortLibrarySkills, sortSourceGroups } from "../../src/renderer/catalogSort";
import type { InstructionBlock, ManagedBackupItem, SkillLibraryEntry, SkillSourceGroupView } from "../../src/shared/types";

const skill = (id: string, upstreamDate?: string): SkillLibraryEntry => ({
  id, name: id, description: "", path: `/library/${id}`, sourceType: "local",
  contentHash: id, updatePolicy: "untracked", updatedAt: "2099-01-01T00:00:00Z",
  upstream: upstreamDate ? { kind: "local", locator: `/source/${id}`, updatedAt: upstreamDate } : undefined
});
const block = (id: string, updatedAt: string, usedByProfiles: string[] = []): InstructionBlock => ({
  id, name: id, description: "", content: "", contentHash: id, path: `/blocks/${id}`,
  createdAt: updatedAt, updatedAt, usedByProfiles
});
const backup = (id: string, sizeBytes: number, createdAt: string, protectedCopy = false): ManagedBackupItem => ({
  id, kind: "target-recovery", targetId: "codex", fileCount: 1, sizeBytes, createdAt,
  cleanupStatus: protectedCopy ? "required" : "eligible", deletable: !protectedCopy
});

describe("catalog projections", () => {
  it("uses natural names and stable IDs without modifying the loaded catalog", () => {
    const input = Object.freeze([skill("Skill10"), skill("Skill2"), { ...skill("other"), name: "Skill2" }]);
    const before = JSON.stringify(input);
    expect(sortLibrarySkills(input, "name", {}).map((item) => item.id)).toEqual(["other", "Skill2", "Skill10"]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("sorts only source dates, never substitutes local/import timestamps, and puts unknowns last", () => {
    const input = [skill("A"), skill("B", "invalid"), skill("C", "2025-01-01"), skill("D", "2026-01-01")];
    expect(sortLibrarySkills(input, "source-updated", {}).map((item) => item.id)).toEqual(["D", "C", "A", "B"]);
  });
  it("counts distinct Profile references, not deployment installs", () => {
    const input = [skill("A"), skill("B"), skill("C")];
    expect(sortLibrarySkills(input, "references", { A: ["one", "one"], B: ["one", "two"] })
      .map((item) => item.id)).toEqual(["B", "A", "C"]);
  });
  it("ranks source changes without changing candidates or their selection identity", () => {
    const sources = [{ sourceId: "a", canonicalLink: "/a", counts: { updates: 1, new: 0, removed: 0 } },
      { sourceId: "b", canonicalLink: "/b", counts: { updates: 0, new: 1, removed: 1 } }] as SkillSourceGroupView[];
    expect(sortSourceGroups(sources, "changes").map((item) => item.sourceId)).toEqual(["b", "a"]);
    expect(sources[0].sourceId).toBe("a");
  });
  it("composes Instruction reference filters with modification sorting", () => {
    const input = [block("A", "invalid", ["Daily"]), block("B", "2026-01-01", ["Daily"]), block("C", "2026-02-01")];
    expect(projectInstructions(input, { sort: "modified", usageFilter: "referenced" }).map((item) => item.id)).toEqual(["B", "A"]);
    expect(projectInstructions(input, { sort: "name", usageFilter: "unreferenced" }).map((item) => item.id)).toEqual(["C"]);
  });
  it("filters backup display without changing eligible inventory or recovery protection", () => {
    const input = [backup("A", 30, "2026-01-01"), backup("B", 10, "2026-02-01", true),
      { ...backup("C", 50, "2026-03-01"), kind: "skill-cleanup" as const, targetId: undefined }];
    const defaults = { sort: "newest" as const, kindFilter: "all" as const, targetFilter: "all", statusFilter: "all" as const };
    expect(projectBackups(input, defaults).map((item) => item.id)).toEqual(["C", "B", "A"]);
    expect(projectBackups(input, { ...defaults, sort: "oldest" }).map((item) => item.id)).toEqual(["A", "B", "C"]);
    expect(projectBackups(input, { ...defaults, sort: "size" }).map((item) => item.id)).toEqual(["C", "A", "B"]);
    expect(projectBackups(input, { ...defaults, statusFilter: "protected" }).map((item) => item.id)).toEqual(["B"]);
    expect(projectBackups(input, { ...defaults, statusFilter: "eligible", targetFilter: "codex" }).map((item) => item.id)).toEqual(["A"]);
    expect(projectBackups(input, { ...defaults, kindFilter: "skill-cleanup" }).map((item) => item.id)).toEqual(["C"]);
    expect(input.filter((item) => item.cleanupStatus === "eligible")).toHaveLength(2);
  });
  it("handles 500 records and empty views entirely in memory", () => {
    const input = Array.from({ length: 500 }, (_, index) => skill(`Skill${499 - index}`));
    expect(sortLibrarySkills(input, "name", {})[0].name).toBe("Skill0");
    expect(sortLibrarySkills([], "references", {})).toEqual([]);
    expect(projectInstructions([], { sort: "name", usageFilter: "all" })).toEqual([]);
  });
});
