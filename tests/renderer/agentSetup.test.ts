import { describe, expect, it } from "vitest";
import type { ProfileSummary, TargetManagementState } from "../../src/shared/types";
import { deriveAgentSetupAction } from "../../src/renderer/agentSetup";

const targetState = (
  overrides: Partial<TargetManagementState> = {}
): TargetManagementState => ({
  targetId: "opencode",
  status: "unmanaged",
  lifecycleStatus: "unmanaged",
  managedResourceCount: 0,
  warningCount: 0,
  errorCount: 0,
  ...overrides
});

const profile = (overrides: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id: "profile-1",
  name: "OpenCode setup",
  description: "",
  createdFromTargetId: "opencode",
  createdAt: "2026-08-01T10:00:00.000Z",
  ...overrides
});

describe("deriveAgentSetupAction", () => {
  it("reviews the current setup when the Agent has no reusable Profile", () => {
    expect(deriveAgentSetupAction("opencode", [], [])).toEqual({
      kind: "review-current"
    });
  });

  it("continues the newest reusable Profile captured from this Agent", () => {
    expect(deriveAgentSetupAction("opencode", [
      profile({ id: "older", name: "Older", createdAt: "2026-07-01T10:00:00.000Z" }),
      profile({ id: "newer", name: "Newer", createdAt: "2026-08-02T10:00:00.000Z" }),
      profile({ id: "broken", name: "Broken", loadError: "invalid" })
    ], [])).toEqual({
      kind: "continue-profile",
      profileId: "newer",
      profileName: "Newer"
    });
  });

  it("opens the active Profile before a captured alternative", () => {
    expect(deriveAgentSetupAction("opencode", [
      profile({ id: "captured", name: "Captured" }),
      profile({ id: "active", name: "Daily Coding", createdFromTargetId: undefined })
    ], [targetState({ activeProfileId: "active", activeProfileName: "Daily Coding" })]))
      .toEqual({
        kind: "open-profile",
        profileId: "active",
        profileName: "Daily Coding"
      });
  });

  it("surfaces a malformed active Profile instead of silently starting Capture", () => {
    expect(deriveAgentSetupAction("opencode", [
      profile({ id: "active", name: "Damaged", loadError: "invalid manifest" })
    ], [targetState({ activeProfileId: "active", activeProfileName: "Damaged" })]))
      .toEqual({
        kind: "repair-profile",
        profileId: "active",
        profileName: "Damaged"
      });
  });
});
