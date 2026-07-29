// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  useWorkspaceNavigation,
  workspacePreferenceKey
} from "../../src/renderer/hooks/useWorkspaceNavigation";

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

describe("useWorkspaceNavigation", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageMock
    });
    window.localStorage.clear();
  });

  it("restores and persists a valid stable workspace", async () => {
    window.localStorage.setItem(workspacePreferenceKey, "settings");

    const { result } = renderHook(() => useWorkspaceNavigation());

    expect(result.current.activeWorkspace).toBe("settings");
    act(() => result.current.openWorkspaceNow("library"));
    await waitFor(() =>
      expect(window.localStorage.getItem(workspacePreferenceKey)).toBe("library")
    );
  });

  it("does not persist the default until startup resolves the initial route", async () => {
    const { result } = renderHook(() => useWorkspaceNavigation());

    expect(result.current.activeWorkspace).toBe("targets");
    expect(window.localStorage.getItem(workspacePreferenceKey)).toBeNull();

    act(() => result.current.markWorkspacePreferenceReady());
    await waitFor(() =>
      expect(window.localStorage.getItem(workspacePreferenceKey)).toBe("targets")
    );
  });

  it("ignores an unsupported stored destination", () => {
    window.localStorage.setItem(workspacePreferenceKey, "unknown");

    const { result } = renderHook(() => useWorkspaceNavigation());

    expect(result.current.activeWorkspace).toBe("targets");
    expect(result.current.initialWorkspacePreference).toBeUndefined();
  });
});
