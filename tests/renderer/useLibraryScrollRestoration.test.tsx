// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampLibraryScrollTop,
  useLibraryScrollRestoration
} from "../../src/renderer/hooks/useLibraryScrollRestoration";

describe("useLibraryScrollRestoration", () => {
  const frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("clamps a stored position to the rendered scroll range", () => {
    expect(clampLibraryScrollTop(240, 600, 300)).toBe(240);
    expect(clampLibraryScrollTop(440, 600, 300)).toBe(300);
    expect(clampLibraryScrollTop(-20, 600, 300)).toBe(0);
  });

  it("restores after layout and cancels a stale scheduled restore", () => {
    const onScrollTopChange = vi.fn();
    const element = document.createElement("section");
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, value: 700 },
      clientHeight: { configurable: true, value: 300 }
    });
    const { result, rerender } = renderHook(
      ({ scrollTop }) =>
        useLibraryScrollRestoration({
          activeView: "skills",
          scrollTop,
          restoreKey: "skills:8",
          onScrollTopChange
        }),
      { initialProps: { scrollTop: 360 } }
    );

    act(() => result.current.setScrollOwner(element));
    expect(frames).toHaveLength(1);

    rerender({ scrollTop: 40 });
    expect(frames).toHaveLength(2);

    act(() => frames[0](0));
    expect(element.scrollTop).toBe(0);
    act(() => frames[1](0));
    expect(element.scrollTop).toBe(40);
  });

  it("writes user scroll and clamps again after resize", () => {
    const onScrollTopChange = vi.fn();
    const element = document.createElement("section");
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, value: 700, writable: true },
      clientHeight: { configurable: true, value: 300, writable: true }
    });
    const { result } = renderHook(() =>
      useLibraryScrollRestoration({
        activeView: "mcp",
        scrollTop: 40,
        restoreKey: "mcp:20",
        onScrollTopChange
      })
    );

    act(() => result.current.setScrollOwner(element));
    act(() => frames.shift()?.(0));
    element.scrollTop = 125;
    act(() => element.dispatchEvent(new Event("scroll")));
    expect(onScrollTopChange).not.toHaveBeenCalled();

    Object.defineProperty(element, "scrollHeight", { configurable: true, value: 420 });
    act(() => window.dispatchEvent(new Event("resize")));
    act(() => frames.at(-1)?.(0));
    expect(element.scrollTop).toBe(120);
  });

  it("captures the live DOM position before navigation without waiting for scroll", () => {
    const onScrollTopChange = vi.fn();
    const element = document.createElement("section");
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, value: 700 },
      clientHeight: { configurable: true, value: 300 }
    });
    const { result } = renderHook(() =>
      useLibraryScrollRestoration({
        activeView: "skills",
        scrollTop: 0,
        restoreKey: "skills:30",
        onScrollTopChange
      })
    );
    act(() => result.current.setScrollOwner(element));
    act(() => frames.at(-1)?.(0));
    element.scrollTop = 275;

    act(() => result.current.captureScroll());

    expect(onScrollTopChange).toHaveBeenLastCalledWith(275);
  });

  it("resets the live DOM position synchronously", () => {
    const onScrollTopChange = vi.fn();
    const element = document.createElement("section");
    const { result } = renderHook(() =>
      useLibraryScrollRestoration({
        activeView: "skills",
        scrollTop: 200,
        restoreKey: "skills:30",
        onScrollTopChange
      })
    );
    act(() => result.current.setScrollOwner(element));
    element.scrollTop = 200;

    act(() => result.current.resetScrollNow());

    expect(element.scrollTop).toBe(0);
    expect(onScrollTopChange).toHaveBeenLastCalledWith(0);
  });

  it("ignores delayed scroll from the previous view while restoring the destination", () => {
    const skillChange = vi.fn();
    const mcpChange = vi.fn();
    const element = document.createElement("section");
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, value: 700 },
      clientHeight: { configurable: true, value: 300 }
    });
    const { result, rerender } = renderHook(
      ({ activeView, scrollTop, onScrollTopChange }) =>
        useLibraryScrollRestoration({
          activeView,
          scrollTop,
          restoreKey: activeView,
          onScrollTopChange
        }),
      {
        initialProps: {
          activeView: "skills" as "skills" | "mcp",
          scrollTop: 200,
          onScrollTopChange: skillChange
        }
      }
    );
    act(() => result.current.setScrollOwner(element));
    act(() => frames.at(-1)?.(0));
    element.scrollTop = 260;
    act(() => element.dispatchEvent(new Event("scroll")));

    rerender({ activeView: "mcp", scrollTop: 40, onScrollTopChange: mcpChange });
    act(() => element.dispatchEvent(new Event("scroll")));
    act(() => result.current.captureScroll());

    expect(mcpChange).toHaveBeenLastCalledWith(40);
    act(() => frames.at(-1)?.(0));
    expect(element.scrollTop).toBe(40);
  });
});
