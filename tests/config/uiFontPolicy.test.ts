import { describe, expect, it } from "vitest";
// @ts-expect-error The policy is an executable JavaScript build script.
import { collectHardcodedMonoFonts } from "../../scripts/ui-font-policy.mjs";

describe("renderer monospace ownership", () => {
  it("detects both multiline font families and font shorthand with source lines", () => {
    expect(collectHardcodedMonoFonts(".code {\n  font-family:\n    Menlo, monospace;\n  font: 11px/1.4 ui-monospace, SFMono-Regular, monospace;\n}"))
      .toEqual([
        { line: 2, property: "font-family", value: "Menlo, monospace" },
        { line: 4, property: "font", value: "11px/1.4 ui-monospace, SFMono-Regular, monospace" }
      ]);
  });

  it("allows tokens and inherited fonts, and ignores comments and unrelated declarations", () => {
    expect(collectHardcodedMonoFonts(`/* font-family: monospace; */
      .code { font-family: var(--font-mono); font: 12px/1.5 var(--font-mono); }
      .label { font: inherit; font-family: system-ui, sans-serif; }
      :root { --font-mono: ui-monospace, Menlo, monospace; }
    `)).toEqual([]);
  });

  it("detects named mono families even without a generic fallback", () => {
    expect(collectHardcodedMonoFonts('.code { font-family: "Liberation Mono"; font: 12px Consolas; }'))
      .toHaveLength(2);
  });
});
