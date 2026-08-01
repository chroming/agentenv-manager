// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceNavigation } from "../../src/renderer/hooks/useWorkspaceNavigation";

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

  it("always starts in Agents even when the previous session ended elsewhere", () => {
    window.localStorage.setItem("agentenv:last-workspace", "conversations");

    const { result } = renderHook(() => useWorkspaceNavigation());

    expect(result.current.activeWorkspace).toBe("targets");
  });

  it("keeps explicit navigation stable for the current session", async () => {
    const { result } = renderHook(() => useWorkspaceNavigation());

    expect(result.current.activeWorkspace).toBe("targets");
    act(() => result.current.openWorkspaceNow("library"));
    await waitFor(() => expect(result.current.activeWorkspace).toBe("library"));
  });
});
