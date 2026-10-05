import { describe, expect, it, vi } from "vitest";
import { refreshBackupInventory, withoutDeletedBackup } from "../../src/renderer/backupInventory";
import type { ManagedBackupInventory } from "../../src/shared/types";

describe("Backup inventory refresh policy", () => {
  it("starts a fresh post-mutation scan even when the older coalesced scan failed", async () => {
    const inventory = { items: [] } as unknown as ManagedBackupInventory;
    const read = vi.fn().mockResolvedValue(inventory);
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("old scan failed"))
      .mockImplementationOnce(async (_resource, _reason, task) => ({ performed: true, value: await task() }));
    await refreshBackupInventory(run, "mutation", read);
    expect(run).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledOnce();
  });

  it("does not automatically retry a fresh failed scan", async () => {
    const read = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    const run = vi.fn(async (_resource, _reason, task) => ({ performed: true, value: await task() }));
    await expect(refreshBackupInventory(run, "mutation", read)).rejects.toThrow("storage unavailable");
    expect(read).toHaveBeenCalledOnce();
  });

  it("does not invent an inventory when a deletion finishes before initial loading", () => {
    expect(withoutDeletedBackup(undefined, { id: "deleted", kind: "skill-cleanup" })).toBeUndefined();
  });
});
