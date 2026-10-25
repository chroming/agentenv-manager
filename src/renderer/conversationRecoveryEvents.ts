import { invalidateConversationListPrefetch } from "./conversationListCache";

interface ConversationRecoveryChange {
  kind: "restored" | "deleted";
  backupIds: string[];
}

const eventName = "agentenv-conversation-recovery-changed";

export const notifyConversationRecoveryChange = (change: ConversationRecoveryChange) => {
  if (!change.backupIds.length) return;
  if (change.kind === "restored") invalidateConversationListPrefetch();
  window.dispatchEvent(new CustomEvent(eventName, { detail: change }));
  if (change.kind === "restored") window.dispatchEvent(new Event("agentenv-history-indexed"));
};

export const onConversationRecoveryChange = (listener: (change: ConversationRecoveryChange) => void) => {
  const handle = (event: Event) => listener((event as CustomEvent<ConversationRecoveryChange>).detail);
  window.addEventListener(eventName, handle);
  return () => window.removeEventListener(eventName, handle);
};
