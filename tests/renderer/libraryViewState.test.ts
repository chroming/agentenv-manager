import { describe, expect, it } from "vitest";
import {
  defaultSkillLibraryViewState,
  matchesSkillStatusFilter,
  matchesSkillUsageFilter,
  updateLibraryScroll,
  updateSkillLibraryControls
} from "../../src/renderer/libraryViewState";

describe("library view state", () => {
  it("defines the Skills Library defaults", () => {
    expect(defaultSkillLibraryViewState).toEqual({
      search: "",
      sourceFilter: "all",
      statusFilter: "enabled",
      tagFilter: "all",
      targetFilter: "all",
      usageFilter: "all",
      scrollTop: 0
    });
  });

  it("resets Skills scroll when a query or filter changes", () => {
    const current = { ...defaultSkillLibraryViewState, scrollTop: 240 };
    const next = updateSkillLibraryControls(current, {
      search: "review",
      usageFilter: "referenced"
    });

    expect(next).toEqual({
      ...current,
      search: "review",
      usageFilter: "referenced",
      scrollTop: 0
    });
    expect(current.scrollTop).toBe(240);
  });

  it("normalizes stored scroll without mutating other fields", () => {
    const state = { ...defaultSkillLibraryViewState, search: "docs" };

    expect(updateLibraryScroll(state, 38.5)).toEqual({ ...state, scrollTop: 38.5 });
    expect(updateLibraryScroll(state, -12)).toEqual({ ...state, scrollTop: 0 });
  });

  it("keeps Library availability, references, and update eligibility distinct", () => {
    const enabledSkill = {
      id: "reviewer",
      name: "Reviewer",
      description: "Review code",
      path: "/tmp/reviewer",
      sourceType: "github" as const,
      source: "https://github.com/acme/skills/tree/main/reviewer",
      updatePolicy: "tracked" as const,
      contentHash: "current",
      updatedAt: "2026-07-15T00:00:00.000Z",
      globallyEnabled: true
    };
    const availableUpdate = {
      id: "reviewer",
      name: "Reviewer",
      sourceType: "github" as const,
      updateAvailable: true,
      currentRevision: "current",
      latestRevision: "latest"
    };

    expect(matchesSkillStatusFilter("updates", enabledSkill, availableUpdate)).toBe(true);
    expect(matchesSkillStatusFilter("enabled", enabledSkill, availableUpdate)).toBe(true);
    expect(matchesSkillStatusFilter("disabled", enabledSkill, availableUpdate)).toBe(false);
    expect(matchesSkillUsageFilter("referenced", true)).toBe(true);
    expect(matchesSkillUsageFilter("referenced", false)).toBe(false);
    expect(matchesSkillUsageFilter("unreferenced", false)).toBe(true);
    expect(matchesSkillUsageFilter("referenced", true, false)).toBe(false);

    const disabledSkill = { ...enabledSkill, globallyEnabled: false };
    expect(matchesSkillStatusFilter("enabled", disabledSkill, availableUpdate)).toBe(false);
    expect(matchesSkillStatusFilter("updates", disabledSkill, availableUpdate)).toBe(false);
    expect(matchesSkillStatusFilter("disabled", disabledSkill, availableUpdate)).toBe(true);

    const removedUpstream = {
      ...availableUpdate,
      updateAvailable: false,
      sourceStatus: "removed" as const
    };
    expect(matchesSkillStatusFilter("enabled", enabledSkill, removedUpstream)).toBe(true);
    expect(matchesSkillStatusFilter("updates", enabledSkill, removedUpstream)).toBe(false);
  });
});
