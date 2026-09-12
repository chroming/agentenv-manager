import { useEffect } from "react";
import {
  invalidateConversationListPrefetch,
  preloadConversationList,
  refreshConversationIndexInBackground
} from "../components/ConversationWorkspace";

export const useConversationIndexWarmup = (coreReady: boolean) => {
  useEffect(() => {
    void window.agentEnv.conversationHistoryStatus?.().then((status) => {
      if (status.config.enabled) return preloadConversationList();
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!coreReady) return undefined;
    const check = () => {
      void (async () => {
        const status = await window.agentEnv.conversationHistoryStatus();
        if (!status.config.enabled || status.config.paused) return;
        let shouldRefresh = true;
        try {
          const result = await preloadConversationList();
          shouldRefresh = result.total === 0 || result.refreshRequired !== false || !result.lastRefreshedAt || Date.now() - Date.parse(result.lastRefreshedAt) > 5 * 60_000;
        } catch {
          // A stale or unreadable index can still be repaired by source discovery.
        }
        if (shouldRefresh) await refreshConversationIndexInBackground();
      })().catch(() => undefined);
    };
    const timeoutId = window.setTimeout(check, 0);
    const interval = window.setInterval(check, 5 * 60_000);
    const changed = () => { invalidateConversationListPrefetch(); check(); };
    window.addEventListener("agentenv-history-changed", changed);
    return () => { window.clearTimeout(timeoutId); window.clearInterval(interval); window.removeEventListener("agentenv-history-changed", changed); };
  }, [coreReady]);
};
