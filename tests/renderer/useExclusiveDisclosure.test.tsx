// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useExclusiveDisclosure } from "../../src/renderer/components/ui/useExclusiveDisclosure";

describe("useExclusiveDisclosure", () => {
  it("opens only the latest disclosure and lets it collapse", () => {
    const { result } = renderHook(() => useExclusiveDisclosure<"instructions" | "skills">());

    act(() => result.current.toggleExpandedId("instructions"));
    expect(result.current.isExpanded("instructions")).toBe(true);

    act(() => result.current.toggleExpandedId("skills"));
    expect(result.current.isExpanded("instructions")).toBe(false);
    expect(result.current.isExpanded("skills")).toBe(true);

    act(() => result.current.toggleExpandedId("skills"));
    expect(result.current.isExpanded("skills")).toBe(false);
  });

  it("normalizes replacement state to the first disclosure", () => {
    const { result } = renderHook(() => useExclusiveDisclosure<"instructions" | "skills">());

    act(() => result.current.replaceExpandedIds(["skills", "instructions"]));
    expect(result.current.isExpanded("skills")).toBe(true);
    expect(result.current.isExpanded("instructions")).toBe(false);

    act(() => result.current.clearExpandedIds());
    expect(result.current.isExpanded("skills")).toBe(false);
  });
});
