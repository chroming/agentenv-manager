// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useSearchDisclosure } from "../../src/renderer/hooks/useSearchDisclosure";

it("expands matches without changing saved disclosure state and resets each search", () => {
  const normalToggle = vi.fn();
  const { result, rerender } = renderHook(({ query }) => useSearchDisclosure(query), { initialProps: { query: "" } });
  expect(result.current.expanded("repo", false)).toBe(false);
  rerender({ query: "match" });
  expect(result.current.expanded("repo", false)).toBe(true);
  act(() => result.current.toggle("repo", normalToggle));
  expect(result.current.expanded("repo", false)).toBe(false);
  expect(normalToggle).not.toHaveBeenCalled();
  rerender({ query: "" });
  expect(result.current.expanded("repo", true)).toBe(true);
  rerender({ query: "match" });
  expect(result.current.expanded("repo", false)).toBe(true);
  rerender({ query: "" });
  act(() => result.current.toggle("repo", normalToggle));
  expect(normalToggle).toHaveBeenCalledOnce();
});
