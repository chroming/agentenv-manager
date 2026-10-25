import type { ConversationListResult } from "../shared/types";

let prefetchedList: Promise<ConversationListResult> | undefined;
export const conversationPageSize = 200;

export const preloadConversationList = () => {
  prefetchedList ??= window.agentEnv.listConversations({ limit: conversationPageSize }).catch((error) => {
    prefetchedList = undefined;
    throw error;
  });
  return prefetchedList;
};

export const invalidateConversationListPrefetch = () => {
  prefetchedList = undefined;
};
