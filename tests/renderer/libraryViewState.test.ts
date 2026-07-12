import { describe, expect, it } from "vitest";
import {
  defaultMcpLibraryViewState,
  defaultSkillLibraryViewState,
  matchesSkillStatusFilter,
  updateLibraryScroll,
  updateMcpLibraryControls,
  updateSkillLibraryControls
} from "../../src/renderer/libraryViewState";

describe("library view state", () => {
  it("defines independent defaults for Skills and MCP", () => {
    expect(defaultSkillLibraryViewState).toEqual({
      search: "",
      sourceFilter: "all",
      statusFilter: "all",
      targetFilter: "all",
      scrollTop: 0
    });
    expect(defaultMcpLibraryViewState).toEqual({ search: "", scrollTop: 0 });
  });

  it("resets Skills scroll when a query or filter changes", () => {
    const current = { ...defaultSkillLibraryViewState, scrollTop: 240 };
    const next = updateSkillLibraryControls(current, {
      search: "review",
      statusFilter: "referenced"
    });

    expect(next).toEqual({
      ...current,
      search: "review",
      statusFilter: "referenced",
      scrollTop: 0
    });
    expect(current.scrollTop).toBe(240);
  });

  it("resets MCP scroll when search changes", () => {
    expect(
      updateMcpLibraryControls(
        { ...defaultMcpLibraryViewState, scrollTop: 180 },
        { search: "github" }
      )
    ).toEqual({ search: "github", scrollTop: 0 });
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

    expect(matchesSkillStatusFilter("updates", enabledSkill, false, availableUpdate)).toBe(true);
    expect(matchesSkillStatusFilter("referenced", enabledSkill, true, availableUpdate)).toBe(true);
    expect(matchesSkillStatusFilter("unreferenced", enabledSkill, false, availableUpdate)).toBe(true);
    expect(matchesSkillStatusFilter("disabled", enabledSkill, true, availableUpdate)).toBe(false);

    const disabledSkill = { ...enabledSkill, globallyEnabled: false };
    expect(matchesSkillStatusFilter("updates", disabledSkill, true, availableUpdate)).toBe(false);
    expect(matchesSkillStatusFilter("disabled", disabledSkill, true, availableUpdate)).toBe(true);
    expect(matchesSkillStatusFilter("referenced", disabledSkill, true, availableUpdate)).toBe(false);
    expect(matchesSkillStatusFilter("unreferenced", disabledSkill, false, availableUpdate)).toBe(false);
  });
});
