// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareReviewedSkillImport } from "../../src/renderer/skillImportPreparation";

afterEach(() => vi.unstubAllGlobals());

describe("reviewed Skill imports", () => {
  const setup = (conflicts: Array<{ existing: { id: string } }> = []) => {
    vi.stubGlobal("window", { agentEnv: { previewSkillImport: vi.fn().mockResolvedValue({
      incoming: { contentHash: "reviewed" }, conflicts
    }) } });
    return { kind: "local" as const, input: { sourcePath: "/fixture/skill", expectedContentHash: "reviewed" } };
  };

  it("rejects changed content before asking the user to resolve a conflict", async () => {
    const source = setup([{ existing: { id: "existing" } }]);
    const resolve = vi.fn();
    await expect(prepareReviewedSkillImport({ ...source, input: { ...source.input, expectedContentHash: "old" } }, resolve))
      .rejects.toThrow("Skill content changed after preview");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("retains the reviewed hash without inventing a conflict for a new Skill", async () => {
    const source = setup();
    const resolve = vi.fn();
    expect(await prepareReviewedSkillImport(source, resolve)).toEqual(source);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("cancellation does not turn a duplicate into an import", async () => {
    const source = setup([{ existing: { id: "existing" } }]);
    expect(await prepareReviewedSkillImport(source, vi.fn().mockResolvedValue(undefined))).toBeUndefined();
  });
});
