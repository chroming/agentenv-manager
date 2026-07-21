import { describe, expect, it } from "vitest";
import { normalizeRepositorySkillScan } from "../../src/main/skillSourceLibrary";
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
