import { describe, expect, it, vi } from "vitest";
import { registerInstructionIpc } from "../../src/main/ipc/instructionIpc";
import { registerSettingsIpc } from "../../src/main/ipc/settingsIpc";
import type { IpcHandler, IpcRegistrationHandles } from "../../src/main/ipc/registration";

vi.mock("electron", () => ({ shell: {} }));

const fixture = () => {
  const handlers = new Map<string, IpcHandler>();
  const register = (channel: string, handler: IpcHandler) => { handlers.set(channel, handler); };
  const handles: IpcRegistrationHandles = { diagnosticHandle: register, handleMutation: register, handleWorkspaceSyncMutation: register };
  return { handles, call: (channel: string, ...args: unknown[]) => handlers.get(channel)!({} as Electron.IpcMainInvokeEvent, ...args) };
};

describe("operation boundaries", () => {
  it("lists Instructions when optional Profile usage hangs without inventing zero references", async () => {
    const { handles, call } = fixture();
    const block = { id: "review", name: "Review" };
    registerInstructionIpc(handles, {
      instructionLibraryStore: { list: async () => [block] },
      profileStore: { listProfiles: () => new Promise(() => {}) }
    } as unknown as Parameters<typeof registerInstructionIpc>[1]);
    const blocks = await call("instructions:list");
    expect(blocks).toEqual([block]);
    expect(blocks[0]).not.toHaveProperty("usedByProfiles");
  });

  it("keeps a failed reference read mandatory for deleting an Instruction", async () => {
    const { handles, call } = fixture();
    const remove = vi.fn();
    const createBackup = vi.fn();
    registerInstructionIpc(handles, {
      instructionLibraryStore: { read: async () => ({ id: "review", name: "Review", contentHash: "before" }), remove },
      profileStore: { listProfiles: async () => [{ id: "daily" }], readProfile: async () => { throw new Error("Profile is unreadable"); } },
      backupStore: { createBackup }
    } as unknown as Parameters<typeof registerInstructionIpc>[1]);
    await expect(call("instructions:remove", { id: "review", expectedContentHash: "before" })).rejects.toThrow("Profile is unreadable");
    expect(createBackup).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("returns saved settings even if the native menu cannot refresh", async () => {
    const { handles, call } = fixture();
    const saved = { locale: "zh_CN" };
    const onSettingsUpdated = vi.fn(() => new Promise<void>(() => {}));
    registerSettingsIpc(handles, {
      settingsStore: { updateSettings: vi.fn().mockResolvedValue(saved) }, onSettingsUpdated
    } as unknown as Parameters<typeof registerSettingsIpc>[1]);
    await expect(call("settings:update", saved)).resolves.toEqual(saved);
    expect(onSettingsUpdated).toHaveBeenCalledWith(saved);
  });
});
