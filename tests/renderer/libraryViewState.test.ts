import { describe, expect, it } from "vitest";
import {
  defaultMcpLibraryViewState,
  defaultSkillLibraryViewState,
  updateLibraryScroll,
  updateMcpLibraryControls,
  updateSkillLibraryControls
} from "../../src/renderer/libraryViewState";

describe("library view state", () => {
  it("defines independent defaults for Skills and MCP", () => {
    expect(defaultSkillLibraryViewState).toEqual({
      search: "",
      sourceFilter: "all",
      usageFilter: "all",
      targetFilter: "all",
      updateFilter: "all",
      scrollTop: 0
    });
    expect(defaultMcpLibraryViewState).toEqual({ search: "", scrollTop: 0 });
  });

  it("resets Skills scroll when a query or filter changes", () => {
    const current = { ...defaultSkillLibraryViewState, scrollTop: 240 };
    const next = updateSkillLibraryControls(current, {
      search: "review",
      usageFilter: "used"
    });

    expect(next).toEqual({
      ...current,
      search: "review",
      usageFilter: "used",
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
});
