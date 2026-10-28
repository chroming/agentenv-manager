import { expect, it } from "vitest";
import type { AppliedSkillReceipt } from "../../src/shared/types";
import { skillReceiptsEqual } from "../../src/main/skillReconciliationReceipts";
import { parseTargetState } from "../../src/main/targetState";

const receipt: AppliedSkillReceipt = {
  libraryId: "review", targetName: "review", path: "/agent/skills/review", desired: "install",
  observed: "managed", authority: "agentenv", action: "none", outcome: "managed-active",
  requiresReview: false, localOverride: false, contentHash: "deployed-hash", invocationMode: "manual"
};

it("compares manual invocation receipts semantically after a persisted schema round trip", () => {
  const persisted = parseTargetState(JSON.parse(JSON.stringify({
    formatVersion: 3, managedMcpNames: [], skillReceipts: [receipt]
  }))).skillReceipts!;
  expect(Object.keys(persisted[0])).not.toEqual(Object.keys(receipt));
  expect(skillReceiptsEqual([receipt], persisted)).toBe(true);
  expect(skillReceiptsEqual([{ ...receipt, policyId: undefined }], persisted)).toBe(true);
});

it("does not lose invocation or unmanaged decisions while ignoring separately verified content hashes", () => {
  expect(skillReceiptsEqual([receipt], [{ ...receipt, contentHash: "updated" }])).toBe(true);
  expect(skillReceiptsEqual([receipt], [{ ...receipt, invocationMode: undefined }])).toBe(false);
  expect(skillReceiptsEqual([receipt], [{ ...receipt, authority: "leave-unmanaged", localOverride: true }])).toBe(false);
});
