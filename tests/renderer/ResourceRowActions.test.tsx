// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChoiceInput, IconButton, ResourceRow } from "../../src/renderer/components/ui";
afterEach(cleanup);

it("keeps selection separate from secondary utilities without adding a second control grammar", () => {
  const { rerender } = render(<ResourceRow icon={null} title="Tree"
    actions={<ChoiceInput type="checkbox" aria-label="Select tree" />}
    secondaryActions={<IconButton label="Remove tree">x</IconButton>} />);
  expect(screen.getByRole("checkbox", { name: "Select tree" }).closest(".ui-resource-row__secondary-actions")).toBeNull();
  expect(screen.getByRole("button", { name: "Remove tree" }).closest(".ui-resource-row__secondary-actions")).not.toBeNull();
  rerender(<ResourceRow icon={null} title="Other tree" actions={<ChoiceInput type="checkbox" aria-label="Select tree" />} />);
  expect(screen.queryByRole("button", { name: "Remove tree" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Select tree" })).toBeEnabled();
});
