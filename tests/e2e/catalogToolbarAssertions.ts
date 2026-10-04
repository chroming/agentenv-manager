import { expect } from "vitest";
import type { Locator } from "playwright-core";

export async function expectCatalogToolbar(toolbar: Locator, layout: "wide" | "pane") {
  const geometry = await toolbar.evaluate((element) => {
    const box = (selector: string) => {
      const rect = element.querySelector(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    const root = element.getBoundingClientRect();
    return { search: box(".ui-search-field"), sort: box(".ui-sort-trigger"), filter: box(".ui-filter-popover__trigger"),
      root: { x: root.x, right: root.right },
      overflow: element.scrollWidth > element.clientWidth + 1,
      controlHeight: Number.parseFloat(getComputedStyle(element).getPropertyValue("--control-height-default")) };
  });
  expect(geometry.overflow).toBe(false);
  for (const control of [geometry.search, geometry.sort, geometry.filter]) {
    expect(Math.abs(control.height - geometry.controlHeight)).toBeLessThanOrEqual(1);
    expect(control.x).toBeGreaterThanOrEqual(geometry.root.x);
    expect(control.right).toBeLessThanOrEqual(geometry.root.right + 1);
  }
  expect(Math.abs(geometry.sort.y - geometry.filter.y)).toBeLessThanOrEqual(1);
  expect(geometry.filter.x - geometry.sort.right).toBeGreaterThanOrEqual(0);
  expect(geometry.filter.x - geometry.sort.right).toBeLessThanOrEqual(8);
  if (layout === "wide") {
    expect(Math.abs(geometry.search.y - geometry.sort.y)).toBeLessThanOrEqual(1);
    expect(geometry.sort.x - geometry.search.right).toBeGreaterThanOrEqual(0);
    expect(geometry.sort.x - geometry.search.right).toBeLessThanOrEqual(12);
    expect(geometry.search.width).toBeLessThanOrEqual(360);
  } else {
    expect(geometry.sort.y).toBeGreaterThanOrEqual(geometry.search.bottom);
    expect(geometry.search.width).toBeGreaterThan(210);
  }
  return geometry;
}
