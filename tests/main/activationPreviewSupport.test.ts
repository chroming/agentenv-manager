import { describe, expect, it } from "vitest";
import {
  fingerprintTargetPaths,
  sharedSkillPreparationsEqual,
  toPublicActivationPreview,
  type InternalActivationPreview
} from "../../src/main/activationPreviewSupport";

describe("activation preview support", () => {
  it("removes internal planning data and redacts public preview content", () => {
    const preview = {
      id: "preview-1",
      profileId: "profile-1",
      profileContentHash: "profile-hash",
      targetId: "opencode",
      createdAt: "2026-08-08T00:00:00.000Z",
      issues: [{
        id: "issue-1",
        code: "operation-notice",
        disposition: "notice",
        resolution: "preserve",
        resourceKind: "configuration",
        message: "token=secret-value"
      }],
      changes: [{
        path: "/tmp/config",
        before: "token=secret-value",
        after: "token=next-secret",
        diff: ""
      }],
      resourceChanges: [],
      liveFingerprints: {},
      resourceFingerprints: {},
      sourceFingerprints: {},
      libraryVersions: { skills: {} },
      targetState: { managedMcpNames: [] },
      targetStateFingerprint: "state",
      targetPathFingerprint: "paths",
      assetBackupPaths: [],
      missingAssetDirectories: [],
      resourceManagement: { instructions: true, skills: true, pausedSkillPaths: [] },
      skillDeployment: {} as InternalActivationPreview["skillDeployment"]
    } satisfies InternalActivationPreview;

    const result = toPublicActivationPreview(preview);

    expect(result).not.toHaveProperty("targetStateFingerprint");
    expect(result.issues[0]?.message).not.toContain("secret-value");
    expect(result.changes[0]?.before).not.toContain("secret-value");
    expect(result.changes[0]?.diff).toContain("--- /tmp/config");
  });

  it("fingerprints normalized Target paths and compares shared preparations independent of order", () => {
    const paths = {
      targetId: "opencode",
      configDir: "/tmp/config",
      instructionsPath: "/tmp/config/AGENTS.md",
      configPath: "/tmp/config/opencode.json",
      skillLocations: [
        { path: "/tmp/b", role: "primary", shared: false },
        { path: "/tmp/a", role: "compatibility-runtime", shared: true }
      ]
    } as Parameters<typeof fingerprintTargetPaths>[0];

    expect(fingerprintTargetPaths(paths)).toBe(fingerprintTargetPaths({
      ...paths,
      skillLocations: [...(paths.skillLocations ?? [])].reverse()
    }));
    expect(sharedSkillPreparationsEqual([
      { skillKey: "a", libraryId: "a", targetName: "One", disposition: "install", profileId: "p", profileHash: "h", sharedPaths: ["/tmp/b", "/tmp/a"] }
    ], [
      { skillKey: "a", libraryId: "a", targetName: "One", disposition: "install", profileId: "p", profileHash: "h", sharedPaths: ["/tmp/a", "/tmp/b"] }
    ])).toBe(true);
  });
});
