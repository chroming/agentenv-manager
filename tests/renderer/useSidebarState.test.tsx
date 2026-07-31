// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  sidebarCollapsedPreferenceKey,
  useSidebarState
} from "../../src/renderer/hooks/useSidebarState";

const localStorageValues = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return localStorageValues.size;
  },
  clear: () => localStorageValues.clear(),
  getItem: (key) => localStorageValues.get(key) ?? null,
  key: (index) => Array.from(localStorageValues.keys())[index] ?? null,
  removeItem: (key) => {
    localStorageValues.delete(key);
  },
  setItem: (key, value) => {
    localStorageValues.set(key, String(value));
  }
};

describe("useSidebarState", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock
    });
    window.localStorage.clear();
  });

  it("defaults to the expanded rail and persists an explicit collapse", async () => {
    const { result } = renderHook(() => useSidebarState());

    expect(result.current.sidebarCollapsed).toBe(false);
    act(() => result.current.toggleSidebar());

    expect(result.current.sidebarCollapsed).toBe(true);
    await waitFor(() =>
      expect(window.localStorage.getItem(sidebarCollapsedPreferenceKey)).toBe("true")
    );
  });

  it("restores the collapsed preference before the first render", () => {
    window.localStorage.setItem(sidebarCollapsedPreferenceKey, "true");

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it("treats invalid stored values as expanded", () => {
    window.localStorage.setItem(sidebarCollapsedPreferenceKey, "collapsed");

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.sidebarCollapsed).toBe(false);
  });
});
