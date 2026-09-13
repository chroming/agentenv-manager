// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PageHeader } from "../../src/renderer/components/ui/PageHeader";
import { InspectorHeader } from "../../src/renderer/components/ui/WorkspacePatterns";

afterEach(cleanup);

it("does not reserve a row for a page name without controls", () => {
  const { container } = render(<PageHeader title="Settings" />);
  expect(container).toBeEmptyDOMElement();
});

it("retains navigation, help and actions without a visible page title", () => {
  render(<PageHeader title="Skills" navigation={<button>By source</button>}
    help={<button>Help</button>} actions={<button>Import</button>} />);
  expect(screen.getByRole("heading", { name: "Skills" })).toHaveClass("ui-visually-hidden");
  for (const name of ["By source", "Help", "Import"]) expect(screen.getByRole("button", { name })).toBeEnabled();
});

it("preserves object identity while keeping page context nonvisual", () => {
  render(<InspectorHeader context="Profiles" title="Daily Coding" actions={<button>Apply</button>} />);
  expect(screen.getByRole("heading", { name: "Profiles" })).toHaveClass("ui-visually-hidden");
  expect(screen.getByRole("heading", { name: "Daily Coding" })).not.toHaveClass("ui-visually-hidden");
  expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
});
