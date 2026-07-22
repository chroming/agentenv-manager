import { describe, expect, it, vi } from "vitest";
import { createSkillSourceGroupStore, normalizeRepositorySkillScan } from "../../src/main/skillSourceLibrary";
import type { RepositorySkillScanResult, SkillLibraryEntry } from "../../src/shared/types";

const scanResult = (): RepositorySkillScanResult => ({
  repository: "https://git.example.com/acme/skills.git",
  ref: "main",
  directory: "skills",
  transport: "system-git",
  accessTransport: "https",
  sourceScope: {
    formatVersion: 1,
    canonicalLink: "https://git.example.com/acme/skills/tree/main/skills",
    repository: "https://git.example.com/acme/skills.git",
    ref: "main",
    directory: "skills"
  },
  truncated: false,
  candidates: ["frontend/review", "backend/review"].map((subpath, index) => ({
    id: "review",
    name: `Review ${index + 1}`,
    description: "Review code",
    directory: `skills/${subpath}`,
    source: {
      kind: "git" as const,
      locator: "https://git.example.com/acme/skills.git",
      ref: "main",
      subpath: `skills/${subpath}`
    },
    contentRevision: `revision-${index + 1}`,
    resolvedCommit: "commit",
    status: "ready" as const
  }))
});

describe("skill source library", () => {
  it("checks only source groups that opt into background checks", async () => {
    const groups = [true, false].map((automaticChecks, index) => ({
      formatVersion: 1 as const,
      sourceId: `source-${index}`,
      sourceKind: index === 0 ? "repository" as const : "local" as const,
      automaticChecks,
      canonicalLink: index === 0 ? "https://example.com/skills" : "file:///tmp/skills",
      repository: index === 0 ? "https://example.com/skills.git" : "/tmp/skills",
      ref: index === 0 ? "main" : "",
      directory: "",
      observationState: "unchecked" as const,
      counts: { total: 0, updates: 0, new: 0, removed: 0 },
      candidates: []
    }));
    const checkGroup = vi.fn(async (sourceId: string) => groups.find((group) => group.sourceId === sourceId)!);
    const service = {
      listGroups: vi.fn().mockResolvedValue(groups),
      checkGroup,
      checkAll: vi.fn()
    };
    const registry = {
      list: vi.fn().mockResolvedValue(groups.map((group) => ({
        ...group,
        id: group.sourceId,
        kind: group.sourceKind,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z"
      }))),
      setDisplayName: vi.fn(),
      setAutomaticChecks: vi.fn()
    };
    const store = createSkillSourceGroupStore(
      service as never,
      async () => [],
      registry as never
    );

    const result = await store.checkAutomaticSourceGroups();

    expect(checkGroup).toHaveBeenCalledTimes(1);
    expect(checkGroup).toHaveBeenCalledWith("source-0", []);
    expect(result.checked).toBe(1);
  });

  it("keeps scanned Library IDs unchanged when names collide", () => {
    const existing: SkillLibraryEntry = {
      id: "review",
      name: "Existing Review",
      description: "Existing content",
      path: "/library/review",
      sourceType: "local",
      source: "/source/review",
      globallyEnabled: true,
      updatePolicy: "untracked",
      contentHash: "existing-hash",
      updatedAt: "2026-07-21T00:00:00.000Z"
    };

    const normalized = normalizeRepositorySkillScan(scanResult(), [existing]);

    expect(normalized.candidates.map((candidate) => candidate.id)).toEqual([
      "review",
      "review"
    ]);
    expect(normalized.candidates.map((candidate) => candidate.status)).toEqual([
      "ready",
      "ready"
    ]);
  });
});
