// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CheckCircle2 } from "lucide-react";
import { afterEach, expect, it } from "vitest";
import { StatusHint } from "../../src/renderer/components/ui/StatusHint";

afterEach(cleanup);

it("exposes quiet metadata on focus without inventing a button action", async () => {
  render(<StatusHint icon={<CheckCircle2 />} label="Up to date" detail="Applied to Codex" value={3} />);
  const hint = screen.getByLabelText("Up to date");
  expect(hint.tagName).not.toBe("BUTTON");
  expect(hint).toHaveAttribute("tabindex", "0");
  expect(hint.querySelector(".ui-visually-hidden")).toHaveTextContent("Up to date");
  fireEvent.focus(hint);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Applied to Codex");
  fireEvent.keyDown(hint, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
