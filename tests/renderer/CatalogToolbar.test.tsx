// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogFilters, CatalogToolbar, FilterReset, IconButton, SearchField, SelectField, SortMenu } from "../../src/renderer/components/ui";

afterEach(cleanup);

describe("catalog control composition", () => {
  it.each(["wide", "pane"] as const)("owns stable search, controls and action slots for %s lists", (layout) => {
    const { container } = render(<CatalogToolbar layout={layout} aria-label="Library"
      search={<SearchField label="Search" defaultValue="review" />}
      controls={<SortMenu label="Sort" value="name" options={[{ value: "name", label: "Name" }]} onChange={vi.fn()} />}
      context={<span>12 items</span>} actions={<IconButton label="Refresh">R</IconButton>} />);
    expect(screen.getByRole("toolbar")).toHaveClass(`ui-catalog-toolbar--${layout}`);
    expect(container.querySelector(".ui-catalog-toolbar__search")).toContainElement(screen.getByRole("searchbox"));
    expect(container.querySelector(".ui-search-field__icon svg")).not.toBeNull();
    expect(container.querySelector(".ui-catalog-toolbar__controls")).toContainElement(screen.getByRole("button", { name: "Sort: Name" }));
    expect(container.querySelector(".ui-catalog-toolbar__actions")).toContainElement(screen.getByRole("button", { name: "Refresh" }));
    expect(container.querySelector(".ui-catalog-toolbar__context")).toHaveTextContent("12 items");
  });

  it("keeps active filter descriptions inside the popover with a shared clear action and keyboard return", () => {
    const reset = vi.fn();
    const { container } = render(<CatalogFilters count={1} summary="Enabled">
      <SelectField label="Status" defaultValue="enabled"><option value="enabled">Enabled</option></SelectField>
      <FilterReset disabled={false} onReset={reset} />
    </CatalogFilters>);
    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /1 active filters/ });
    expect(trigger).not.toHaveClass("ui-icon-button--active");
    expect(container.querySelector(".ui-filter-popover__indicator")).not.toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("combobox")).toHaveFocus();
    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(clear).toHaveClass("ui-button--default");
    fireEvent.keyDown(document, { key: "Tab" });
    expect(clear).toHaveFocus();
    fireEvent.click(clear);
    expect(reset).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
