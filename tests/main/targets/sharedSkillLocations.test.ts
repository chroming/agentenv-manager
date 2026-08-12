import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSharedSkillCleanupAuthority,
  isManagedSharedSkillLocation,
  materializeSharedSkillLocations,
  resolveSharedSkillLocation
} from "../../../src/main/targets/sharedSkillLocations";
import { createCodexTargetAdapter } from "../../../src/main/targets/codexTarget";
import { createOpenCodeTargetAdapter } from "../../../src/main/targets/opencodeTarget";
import { createPiTargetAdapter } from "../../../src/main/targets/integrations/pi";
import type { TargetPaths } from "../../../src/shared/types";

const basePaths = (homeDir: string): TargetPaths => {
  const skillsDir = join(homeDir, ".tool", "skills");
  return {
    targetId: "test",
    configDir: join(homeDir, ".tool"),
    instructionsPath: join(homeDir, ".tool", "AGENTS.md"),
    configPath: join(homeDir, ".tool", "config.json"),
    skillsDir,
    skillLocations: [{
      path: skillsDir,
      role: "preferred-runtime",
      shared: false,
      scope: "user",
      scanDepth: "direct",
      management: "managed"
    }],
    skillScanDirs: [skillsDir],
    sharedSkillLocationIds: ["agents-skills"]
  };
};

describe("shared Skill location registry", () => {
  it("materializes a managed shared runtime declaration", () => {
    const homeDir = "/tmp/agentenv-home";
    const materialized = materializeSharedSkillLocations(basePaths(homeDir), { homeDir });
    const shared = materialized.skillLocations?.find(
      (location) => location.sharedLocationId === "agents-skills"
    );

    expect(shared).toEqual({
      path: join(homeDir, ".agents", "skills"),
      role: "compatibility-runtime",
      shared: true,
      sharedLocationId: "agents-skills",
      scope: "shared",
      scanDepth: "recursive",
      management: "shared-runtime"
    });
    expect(isManagedSharedSkillLocation(shared)).toBe(true);
    expect(materialized.skillScanDirs).toEqual([
      join(homeDir, ".tool", "skills"),
      join(homeDir, ".agents", "skills")
    ]);
  });

  it("is idempotent and replaces conflicting per-Target declarations for the same path", () => {
    const homeDir = "/tmp/agentenv-home";
    const sharedPath = join(homeDir, ".agents", "skills");
    const paths = basePaths(homeDir);
    paths.skillLocations?.push({
      path: sharedPath,
      role: "compatibility-runtime",
      shared: true,
      scope: "shared",
      scanDepth: "direct",
      management: "observed"
    });
    paths.skillScanDirs?.push(sharedPath);

    const first = materializeSharedSkillLocations(paths, { homeDir });
    const second = materializeSharedSkillLocations(first, { homeDir });

    expect(second).toEqual(first);
    expect(
      second.skillLocations?.filter((location) => location.path === sharedPath)
    ).toEqual([
      expect.objectContaining({
        sharedLocationId: "agents-skills",
        scanDepth: "recursive",
        management: "shared-runtime"
      })
    ]);
  });

  it("rejects a shared location as the Target-managed destination", () => {
    const homeDir = "/tmp/agentenv-home";
    const paths = basePaths(homeDir);
    paths.skillsDir = join(homeDir, ".agents", "skills");

    expect(() =>
      materializeSharedSkillLocations(paths, { homeDir })
    ).toThrow("cannot use a shared Skill location as its managed Skills directory");
  });

  it("gives all shared-Skill consumers the same registered location semantics", () => {
    const homeDir = "/tmp/agentenv-home";
    const paths = [
      createCodexTargetAdapter().createTargetPaths({ homeDir }),
      createOpenCodeTargetAdapter().createTargetPaths({ homeDir }),
      createPiTargetAdapter().createTargetPaths({ homeDir })
    ];

    for (const target of paths) {
      expect(target.sharedSkillLocationIds).toEqual(["agents-skills"]);
      expect(
        target.skillLocations?.find(
          (location) => location.sharedLocationId === "agents-skills"
        )
      ).toEqual(resolveSharedSkillLocation("agents-skills", { homeDir }));
    }
  });

  it("blocks generic writes while allowing reviewed migration and broken-link cleanup", () => {
    const input = {
      path: "/tmp/agentenv-home/.agents/skills/reviewer",
      sharedLocation: true,
      unavailableLinkCleanup: false
    };

    expect(() =>
      assertSharedSkillCleanupAuthority({ ...input, mode: "target-copies" })
    ).toThrow("require a reviewed shared-location operation");
    expect(() =>
      assertSharedSkillCleanupAuthority({ ...input, mode: "shared-compatibility" })
    ).not.toThrow();
    expect(() =>
      assertSharedSkillCleanupAuthority({
        ...input,
        mode: undefined,
        unavailableLinkCleanup: true
      })
    ).not.toThrow();
  });
});
