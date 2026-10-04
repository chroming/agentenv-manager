// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error The capture gate is an executable JavaScript module.
import { readInterfaceTypography } from "../../scripts/interface-typography.mjs";

const measure = () => readInterfaceTypography({ evaluate: (callback: () => unknown) => callback() });

beforeEach(() => {
  document.documentElement.style.cssText = "--font-size-body:13px;--font-size-metadata:12px;--font-weight-regular:400;--font-weight-medium:500;--line-height-code:1.55";
  document.body.style.cssText = "font-size:13px;font-weight:400";
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 100, height: 20, x: 0, y: 0, top: 0, bottom: 20, left: 0, right: 100, toJSON() {}
  });
});
afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

describe("interface typography capture gate", () => {
  it("rejects browser-default prose and heading weight in ordinary descriptions", async () => {
    document.body.innerHTML = '<p style="font-size:16px;font-weight:600">Ordinary explanation</p>';
    expect((await measure()).violations).toEqual([
      "Interface prose uses 16px: Ordinary explanation",
      "Interface prose uses heading weight 600: Ordinary explanation"
    ]);
  });

  it("preserves explicit document reading styles, title emphasis and hidden content", async () => {
    document.body.innerHTML = `
      <div class="ui-dialog-title" style="font-size:16px;font-weight:600">Dialog title</div>
      <p style="font-size:13px;font-weight:400">Description</p>
      <div class="document-markdown"><p style="font-size:16px;font-weight:600">Document content</p></div>
      <p aria-hidden="true" style="font-size:16px">Hidden content</p>`;
    const evidence = await measure();
    expect(evidence.violations).toEqual([]);
    expect(evidence.paragraphs).toHaveLength(1);
  });

  it("checks separate section, count and code roles instead of flattening their scale", async () => {
    document.body.innerHTML = `
      <h3 class="ui-section-label" style="font-size:13px;font-weight:500">Repository
        <span class="ui-section-label__count" style="font-size:12px;font-weight:400">3</span>
      </h3>
      <pre class="ui-path-list-preview" style="font-size:12px;font-weight:400;line-height:18.6px">notes.txt</pre>`;
    expect((await measure()).violations).toEqual([]);
    document.querySelector<HTMLElement>(".ui-section-label__count")!.style.fontWeight = "600";
    expect((await measure()).violations).toEqual(["Section count uses 12px/600: 3"]);
  });
});
