// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogSortMetric } from "../../src/renderer/components/ui";
import { I18nProvider, translate } from "../../src/renderer/i18n";

afterEach(cleanup);

describe("Visible catalog sort metrics", () => {
  it.each(["en", "zh_CN", "zh_TW"] as const)("keeps the year visible in calendar dates without changing timestamp defaults in %s", (locale) => {
    const value = "2025-10-04T10:20:30Z";
    render(<I18nProvider preference={locale}>
      <CatalogSortMetric dateOnly kind="date" label="Calendar" value={value} />
      <CatalogSortMetric kind="date" label="Timestamp" value={value} />
    </I18nProvider>);
    expect(screen.getByLabelText(/^Calendar:/).textContent).toContain("2025");
    expect(screen.getByLabelText(/^Timestamp:/).textContent).not.toContain("2025");
    expect(screen.getByLabelText(/^Calendar:/).getAttribute("aria-label")?.replace("Calendar:", ""))
      .toBe(screen.getByLabelText(/^Timestamp:/).getAttribute("aria-label")?.replace("Timestamp:", ""));
  });
  it.each(["en", "zh_CN", "zh_TW"] as const)("renders a compact date and an exact accessible value in %s", (locale) => {
    const { container } = render(<I18nProvider preference={locale}><CatalogSortMetric kind="date" label="Modified" value="2026-10-04T10:20:30Z" /></I18nProvider>);
    const metric = container.querySelector(".ui-catalog-sort-metric")!;
    expect(metric.textContent).toMatch(/4/);
    expect(metric.getAttribute("aria-label")).toContain("2026");
    expect(metric).not.toHaveAttribute("role", "button");
  });

  it.each(["en", "zh_CN", "zh_TW"] as const)("distinguishes zero from unknown in %s", (locale) => {
    render(<I18nProvider preference={locale}>
      <CatalogSortMetric kind="size" label="Size" value={0} />
      <CatalogSortMetric kind="count" label="Profiles" value={0} />
      <CatalogSortMetric kind="size" label="Missing" />
      <CatalogSortMetric kind="date" label="Invalid" value="invalid" />
    </I18nProvider>);
    expect(screen.getByLabelText("Size: 0 B")).toHaveTextContent("0 B");
    expect(screen.getByLabelText("Profiles: 0")).toHaveTextContent("0");
    expect(screen.getAllByText(translate(locale, "Unavailable"))).toHaveLength(2);
  });

  it.each([-1, NaN, Infinity])("rejects invalid size %s", (value) => {
    render(<CatalogSortMetric kind="size" label="Size" value={value} />);
    expect(screen.getByLabelText("Size: Unavailable")).toHaveTextContent("Unavailable");
  });
});
