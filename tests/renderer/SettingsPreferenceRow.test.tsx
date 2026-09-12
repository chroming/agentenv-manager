// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPreferenceRow } from "../../src/renderer/components/SettingsPreferenceRow";

afterEach(cleanup);

it("keeps optional explanation accessible without a second copy row", () => {
  const change = vi.fn();
  const { container } = render(<SettingsPreferenceRow
    label="Language"
    help="Uses your system language until you choose another language."
    control={<button onClick={change}>System default</button>}
  />);
  expect(container.querySelector("small")).toBeNull();
  const help = screen.getByLabelText("Uses your system language until you choose another language.");
  fireEvent.focus(help);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Uses your system language");
  fireEvent.click(screen.getByRole("button", { name: "System default" }));
  expect(change).toHaveBeenCalledOnce();
});

it("keeps consequential descriptions visible when requested", () => {
  render(<SettingsPreferenceRow label="Sync" description="Changes affect linked Agents." control={<button>Review</button>} />);
  expect(screen.getByText("Changes affect linked Agents.")).toBeVisible();
});
