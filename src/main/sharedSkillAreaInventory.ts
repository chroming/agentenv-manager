import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  ManagedSharedSkillReceipt,
  SharedSkillAreaState
} from "../shared/types";

interface SharedSkillInventoryOwnershipInput {
  path: string;
  shared: boolean;
  explicitlyUnmanaged: boolean;
}

export const createSharedSkillInventoryOwnership = (
  state: SharedSkillAreaState,
  libraryIds: ReadonlySet<string>
) => {
  const receipts = new Map(
    state.receipts.map((receipt) => [resolve(receipt.path), receipt])
  );

  return ({
    path,
    shared,
    explicitlyUnmanaged
  }: SharedSkillInventoryOwnershipInput) => {
    const receipt = shared ? receipts.get(resolve(path)) : undefined;
    const libraryId = receipt && libraryIds.has(receipt.libraryId)
      ? receipt.libraryId
      : undefined;
    return {
      libraryId,
      managed: Boolean(libraryId),
      kept: shared && (state.mode === "keep" || explicitlyUnmanaged),
      mode: shared ? state.mode : undefined
    };
  };
};

export const managedSharedSkillReceipt = async (
  path: string,
  libraryId: string,
  contentHash: string
): Promise<Omit<ManagedSharedSkillReceipt, "createdAt" | "updatedAt">> => {
  const [directoryStats, skillFileStats] = await Promise.all([
    lstat(path),
    lstat(join(path, "SKILL.md"))
  ]);
  return {
    path,
    sharedLocationId: "agents-skills",
    libraryId,
    adoptedContentHash: contentHash,
    materialization:
      directoryStats.isSymbolicLink() || skillFileStats.isSymbolicLink()
        ? "linked"
        : "copied"
  };
};
