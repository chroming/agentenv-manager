import { describe, expect, it } from "vitest";
import { selectQuickVerification } from "../../scripts/changed-test-selection.mjs";

describe("changed test selection", () => {
  it("selects renderer contracts and style audits without Electron tests", () => {
    const selection = selectQuickVerification([
      "src/renderer/components/AgentDiscoveryDialog.tsx",
      "src/renderer/ui/pages/targets.css"
    ]);

    expect(selection.relatedFiles).toContain("src/renderer/components/AgentDiscoveryDialog.tsx");
    expect(selection.extraTests).toContain("tests/renderer/App.test.tsx");
    expect(selection.audits).toEqual(expect.arrayContaining(["audit:styles", "audit:modules"]));
    expect(selection.runElectron).toBe(false);
  });

  it("widens shared IPC changes to renderer and main contract tests", () => {
    const selection = selectQuickVerification([
      "src/shared/types.ts",
      "src/main/ipc.ts",
      "src/preload/index.ts"
    ]);

    expect(selection.extraTests).toEqual(expect.arrayContaining([
      "tests/renderer/App.test.tsx",
      "tests/main/packagePackaging.test.ts"
    ]));
    expect(selection.audits).toEqual(expect.arrayContaining([
      "audit:modules",
      "audit:targets"
    ]));
  });
});
