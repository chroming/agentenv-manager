import { describe, expect, it } from "vitest";
import { parseDesktopContextMenuItems } from "../../src/shared/desktopContextMenu";

describe("desktop context menu input", () => {
  it("normalizes a bounded menu while preserving disabled actions and separators", () => {
    expect(parseDesktopContextMenuItems([
      { id: "duplicate", label: "  Duplicate profile  " },
      { type: "separator" },
      { id: "delete", label: "Delete profile", enabled: false }
    ])).toEqual([
      { id: "duplicate", label: "Duplicate profile", enabled: true },
      { type: "separator" },
      { id: "delete", label: "Delete profile", enabled: false }
    ]);
  });

  it("rejects empty, duplicate, oversized, or malformed command input", () => {
    expect(() => parseDesktopContextMenuItems([])).toThrow("Invalid desktop context menu");
    expect(() => parseDesktopContextMenuItems([
      { id: "same", label: "First" },
      { id: "same", label: "Second" }
    ])).toThrow("Invalid desktop context menu action");
    expect(() => parseDesktopContextMenuItems([
      { id: "delete", label: "x".repeat(121) }
    ])).toThrow("Invalid desktop context menu label");
    expect(() => parseDesktopContextMenuItems([
      { id: "delete profile", label: "Delete" }
    ])).toThrow("Invalid desktop context menu action");
  });
});
