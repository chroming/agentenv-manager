// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SkillCleanupDetailsFooter } from "../../src/renderer/components/SkillCleanupDetailsFooter";

afterEach(cleanup);

it("keeps copying quiet with visible success while preserving the cleanup command", () => {
  const props = { busy: false, copied: false, working: false, removable: true,
    initialFocusRef: createRef<HTMLButtonElement>(), onClose: vi.fn(), onCopy: vi.fn(), onRemove: vi.fn() };
  const { rerender } = render(<SkillCleanupDetailsFooter {...props} />);
  const copy = screen.getByRole("button", { name: "Copy details" });
  expect(copy).toHaveClass("ui-icon-button--ghost");
  expect(copy.textContent).toBe("");
  fireEvent.click(copy);
  expect(props.onCopy).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Remove unavailable links" })).toHaveTextContent("Remove unavailable links");
  rerender(<SkillCleanupDetailsFooter {...props} copied />);
  expect(screen.getByRole("button", { name: "Copied" })).toBe(copy);
  expect(copy.querySelector(".lucide-check")).not.toBeNull();
  rerender(<SkillCleanupDetailsFooter {...props} working />);
  expect(copy).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
});
