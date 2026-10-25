// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { invalidateConversationListPrefetch, preloadConversationList } from "../../src/renderer/conversationListCache";
import { notifyConversationRecoveryChange, onConversationRecoveryChange } from "../../src/renderer/conversationRecoveryEvents";
import type { AgentEnvApi } from "../../src/shared/types";

afterEach(() => { invalidateConversationListPrefetch(); });

it("invalidates restored history while Conversations is unmounted", async () => {
  const list = vi.fn().mockResolvedValueOnce({ items: [], total: 0 }).mockResolvedValue({ items: [{ id: "restored" }], total: 1 });
  window.agentEnv = { listConversations: list } as unknown as AgentEnvApi;
  expect((await preloadConversationList()).total).toBe(0);
  const change = vi.fn();
  const unsubscribe = onConversationRecoveryChange(change);
  try {
    notifyConversationRecoveryChange({ kind: "restored", backupIds: ["one"] });
    expect(change).toHaveBeenCalledWith({ kind: "restored", backupIds: ["one"] });
    expect((await preloadConversationList()).total).toBe(1);
    expect(list).toHaveBeenCalledTimes(2);
  } finally { unsubscribe(); }
});

it("does not refresh live history when only its deleted backup is removed", async () => {
  const list = vi.fn().mockResolvedValue({ items: [], total: 0 });
  window.agentEnv = { listConversations: list } as unknown as AgentEnvApi;
  await preloadConversationList();
  notifyConversationRecoveryChange({ kind: "deleted", backupIds: ["one"] });
  await preloadConversationList();
  expect(list).toHaveBeenCalledOnce();
});
