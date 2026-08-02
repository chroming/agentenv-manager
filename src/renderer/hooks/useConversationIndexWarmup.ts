import { useEffect } from "react";
import {
  preloadConversationList,
  refreshConversationIndexInBackground
} from "../components/ConversationWorkspace";

export const useConversationIndexWarmup = (coreReady: boolean) => {
  useEffect(() => {
    void preloadConversationList().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!coreReady) return undefined;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        let shouldRefresh = true;
        try {
          const result = await preloadConversationList();
          shouldRefresh = result.total === 0 || result.refreshRequired !== false;
        } catch {
          // A stale or unreadable index can still be repaired by source discovery.
        }
        if (shouldRefresh) await refreshConversationIndexInBackground();
      })().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [coreReady]);
};
