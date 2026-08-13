import { describe, expect, it } from "vitest";
// @ts-expect-error The policy is an executable JavaScript build script.
import { compareRawInteractiveBaseline, countRawInteractiveElements, countRawInteractiveElementsByTag } from "../../scripts/ui-component-policy.mjs";

describe("renderer component policy", () => {
  it("counts raw interactive controls in feature markup", () => {
    expect(countRawInteractiveElements(`
      export const Feature = () => <><button>Save</button><select /><input /></>;
    `)).toBe(3);
  });

  it("can enforce a zero-raw-select contract independently of legacy inputs", () => {
    expect(countRawInteractiveElementsByTag(
      `export const Feature = () => <><select /><input /></>;`,
      "select"
    )).toBe(1);
  });

  it("rejects new files and growth beyond the recorded migration baseline", () => {
    expect(compareRawInteractiveBaseline(
      new Map([
        ["src/renderer/components/Existing.tsx", 3],
        ["src/renderer/components/NewFeature.tsx", 1]
      ]),
      {
        "src/renderer/components/Existing.tsx": 2
      }
    )).toEqual([
      "src/renderer/components/Existing.tsx uses 3 raw interactive elements; baseline is 2",
      "src/renderer/components/NewFeature.tsx uses 1 raw interactive element; new feature files must use shared UI components"
    ]);
  });

  it("allows a migration baseline to decrease", () => {
    expect(compareRawInteractiveBaseline(
      new Map([["src/renderer/components/Existing.tsx", 1]]),
      { "src/renderer/components/Existing.tsx": 2 }
    )).toEqual([]);
  });
});
