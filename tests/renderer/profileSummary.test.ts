import { describe, expect, it } from "vitest";
import {
  compareProfilesByCreationTime,
  listProfileApplications,
  preferredTargetForProfile,
  summarizeProfile
} from "../../src/renderer/profileSummary";
import type { ProfileDetail, TargetInfo, TargetManagementState } from "../../src/shared/types";

const profile: ProfileDetail = {
  id: "daily",
  manifest: {
    id: "daily",
    name: "Daily",
    description: "",
    preferredTargetId: "opencode",
    version: 2
  },
  instructions: "# Guidance\n",
  resources: {
    skills: [
      { libraryId: "review", targetName: "review", enabled: true },
      { libraryId: "paused", targetName: "paused", enabled: false },
      { libraryId: "hidden", targetName: "hidden", enabled: true }
    ],
    mcpByTarget: {
      opencode: {
        mode: "manage",
        selections: [
          { name: "docs", enabled: true },
          { name: "optional", enabled: false }
        ]
      },
      codex: { mode: "ignore", selections: [] }
    }
  }
};

const targets = [
  { id: "opencode", name: "OpenCode", health: { status: "ready" } },
  { id: "codex", name: "Codex", health: { status: "ready" } }
] as TargetInfo[];

describe("Profile summaries", () => {
  it("counts enabled resources for the selected Agent", () => {
    expect(summarizeProfile(profile, { id: "opencode" }, [
      { id: "review", globallyEnabled: true },
      { id: "paused", globallyEnabled: true },
      { id: "hidden", globallyEnabled: false }
    ] as never[])).toEqual({
      instructions: { count: 1 },
      skills: { count: 1, names: ["review"] },
      mcp: { count: 1, names: ["docs"] }
    });

    expect(summarizeProfile(profile, { id: "codex" }).mcp).toEqual({ count: 0, names: [] });
  });

  it("chooses remembered, active, preferred, then installed Agents", () => {
    const activeState = [{ targetId: "codex", activeProfileId: "daily" }] as TargetManagementState[];
    expect(preferredTargetForProfile("daily", "opencode", activeState, targets, "opencode"))
      .toBe("opencode");
    expect(preferredTargetForProfile("daily", "opencode", activeState, targets)).toBe("codex");
    expect(preferredTargetForProfile("other", "opencode", [], targets)).toBe("opencode");
  });

  it("lists Profile applications newest first", () => {
    const states = [
      { targetId: "opencode", activeProfileId: "daily", lastAppliedAt: "2026-07-18T10:00:00Z" },
      { targetId: "codex", activeProfileId: "daily", lastAppliedAt: "2026-07-19T10:00:00Z" }
    ] as TargetManagementState[];
    expect(listProfileApplications("daily", states, targets).map(({ state }) => state.targetId))
      .toEqual(["codex", "opencode"]);
  });

  it("keeps Profile ordering stable by creation time", () => {
    expect([
      { id: "older", name: "Older", createdAt: "2026-07-18T00:00:00Z" },
      { id: "newer", name: "Newer", createdAt: "2026-07-19T00:00:00Z" }
    ].sort(compareProfilesByCreationTime).map(({ id }) => id)).toEqual(["newer", "older"]);
  });
});
