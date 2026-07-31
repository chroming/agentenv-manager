import { useCallback, useRef, useState } from "react";
import type { TargetInfo } from "../../shared/types";
import type { AppWorkspace } from "../components/ProfileSidebar";
import type {
  ConversationOpenRequest
} from "../components/ConversationWorkspace";
import type { TranslationValues } from "../i18n";
import { buildConversationQuickOpenItems } from "../quickOpenItems";

interface ConversationQuickOpenOptions {
  targets: TargetInfo[];
  t(message: string, values?: TranslationValues): string;
  formatDate(value: string | number | Date): string;
  guardAction(label: string, action: () => void): void;
  captureScroll(): void;
  openWorkspaceNow(workspace: AppWorkspace): void;
}

export const useConversationQuickOpen = ({
  targets,
  t,
  formatDate,
  guardAction,
  captureScroll,
  openWorkspaceNow
}: ConversationQuickOpenOptions) => {
  const [openRequest, setOpenRequest] = useState<ConversationOpenRequest>();
  const requestIdRef = useRef(0);

  const openConversation = useCallback((
    summary: ConversationOpenRequest["summary"],
    query: string
  ) => {
    guardAction("open Conversations", () => {
      captureScroll();
      setOpenRequest({
        requestId: ++requestIdRef.current,
        query,
        summary
      });
      openWorkspaceNow("conversations");
    });
  }, [captureScroll, guardAction, openWorkspaceNow]);

  const searchAdditionalItems = useCallback(async (query: string) => {
    const conversations = await window.agentEnv.searchConversations({
      query,
      limit: 6
    });
    return buildConversationQuickOpenItems({
      conversations,
      query,
      targets,
      t,
      formatDate,
      onOpenConversation: openConversation
    });
  }, [formatDate, openConversation, t, targets]);

  const handleOpenRequest = useCallback((requestId: number) => {
    setOpenRequest((current) =>
      current?.requestId === requestId ? undefined : current
    );
  }, []);

  return {
    handleOpenRequest,
    openRequest,
    searchAdditionalItems
  };
};
