// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDesktopShortcuts } from "../../src/renderer/hooks/useDesktopShortcuts";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const dispatchCommand = (key: string, options: { metaKey?: boolean; ctrlKey?: boolean } = {}) => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options
  });
  document.dispatchEvent(event);
  return event;
};

const createSearchRef = (value: string) => {
  const input = document.createElement("input");
  input.value = value;
  document.body.append(input);
  return { current: input };
};

describe("useDesktopShortcuts", () => {
  it("uses Meta on macOS and prevents duplicate save while busy", () => {
    const onSaveProfile = vi.fn();
    const { rerender } = renderHook(
      ({ isProfileSaving }) =>
        useDesktopShortcuts({
          activeWorkspace: "profiles",
          activeLibraryTab: "skills",
          isProfileSaving,
          onSaveProfile,
          onRefreshSkills: vi.fn(),
          profileSearchRef: createSearchRef("daily"),
          skillSearchRef: createSearchRef("skill"),
          mcpSearchRef: createSearchRef("mcp"),
          platform: "MacIntel"
        }),
      { initialProps: { isProfileSaving: false } }
    );

    const controlEvent = dispatchCommand("s", { ctrlKey: true });
    expect(controlEvent.defaultPrevented).toBe(false);
    expect(onSaveProfile).not.toHaveBeenCalled();

    const metaEvent = dispatchCommand("s", { metaKey: true });
    expect(metaEvent.defaultPrevented).toBe(true);
    expect(onSaveProfile).toHaveBeenCalledTimes(1);

    rerender({ isProfileSaving: true });
    const busyEvent = dispatchCommand("s", { metaKey: true });
    expect(busyEvent.defaultPrevented).toBe(true);
    expect(onSaveProfile).toHaveBeenCalledTimes(1);
  });

  it("uses Control outside macOS", () => {
    const onSaveProfile = vi.fn();
    renderHook(() =>
      useDesktopShortcuts({
        activeWorkspace: "profiles",
        activeLibraryTab: "skills",
        isProfileSaving: false,
        onSaveProfile,
        onRefreshSkills: vi.fn(),
        profileSearchRef: createSearchRef("daily"),
        skillSearchRef: createSearchRef("skill"),
        mcpSearchRef: createSearchRef("mcp"),
        platform: "Win32"
      })
    );

    expect(dispatchCommand("s", { metaKey: true }).defaultPrevented).toBe(false);
    expect(dispatchCommand("s", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(onSaveProfile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["profiles", "skills", "profile"],
    ["library", "skills", "skill"],
    ["library", "mcp", "mcp"]
  ] as const)("focuses and selects the %s/%s search", (activeWorkspace, activeLibraryTab, target) => {
    const refs = {
      profile: createSearchRef("daily coding"),
      skill: createSearchRef("review skill"),
      mcp: createSearchRef("github mcp")
    };
    renderHook(() =>
      useDesktopShortcuts({
        activeWorkspace,
        activeLibraryTab,
        isProfileSaving: false,
        onSaveProfile: vi.fn(),
        onRefreshSkills: vi.fn(),
        profileSearchRef: refs.profile,
        skillSearchRef: refs.skill,
        mcpSearchRef: refs.mcp,
        platform: "MacIntel"
      })
    );

    const event = dispatchCommand("f", { metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(refs[target].current);
    expect(refs[target].current.selectionStart).toBe(0);
    expect(refs[target].current.selectionEnd).toBe(refs[target].current.value.length);
  });

  it.each(["targets", "settings"] as const)("does not intercept Find in %s", (activeWorkspace) => {
    const profileSearchRef = createSearchRef("daily");
    renderHook(() =>
      useDesktopShortcuts({
        activeWorkspace,
        activeLibraryTab: "skills",
        isProfileSaving: false,
        onSaveProfile: vi.fn(),
        onRefreshSkills: vi.fn(),
        profileSearchRef,
        skillSearchRef: createSearchRef("skill"),
        mcpSearchRef: createSearchRef("mcp"),
        platform: "MacIntel"
      })
    );

    const event = dispatchCommand("f", { metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(profileSearchRef.current);
  });

  it("refreshes Skills in place with Command-R", () => {
    const onRefreshSkills = vi.fn();
    renderHook(() =>
      useDesktopShortcuts({
        activeWorkspace: "library",
        activeLibraryTab: "skills",
        isProfileSaving: false,
        onSaveProfile: vi.fn(),
        onRefreshSkills,
        profileSearchRef: createSearchRef("daily"),
        skillSearchRef: createSearchRef("skill"),
        mcpSearchRef: createSearchRef("mcp"),
        platform: "MacIntel"
      })
    );

    const event = dispatchCommand("r", { metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(onRefreshSkills).toHaveBeenCalledTimes(1);
  });

  it("blocks Save and Find behind a visible modal", () => {
    const onSaveProfile = vi.fn();
    const profileSearchRef = createSearchRef("daily");
    const modal = document.createElement("section");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    renderHook(() =>
      useDesktopShortcuts({
        activeWorkspace: "profiles",
        activeLibraryTab: "skills",
        isProfileSaving: false,
        onSaveProfile,
        onRefreshSkills: vi.fn(),
        profileSearchRef,
        skillSearchRef: createSearchRef("skill"),
        mcpSearchRef: createSearchRef("mcp"),
        platform: "MacIntel"
      })
    );

    const saveEvent = dispatchCommand("s", { metaKey: true });
    const findEvent = dispatchCommand("f", { metaKey: true });

    expect(saveEvent.defaultPrevented).toBe(true);
    expect(findEvent.defaultPrevented).toBe(true);
    expect(onSaveProfile).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(profileSearchRef.current);
  });
});
