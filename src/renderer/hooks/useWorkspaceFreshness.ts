import { useEffect, useRef } from "react";
import type { AppWorkspace } from "../components/ProfileSidebar";

type LocalReason = "page-entry" | "focus" | "mutation" | "manual";

interface WorkspaceFreshnessActions {
  refreshSkillDiscoveries(
    announce?: boolean,
    reason?: LocalReason
  ): Promise<void>;
  refreshSkills(reason?: LocalReason): Promise<void>;
  refreshTargets(reason?: LocalReason): Promise<void>;
}

export const useWorkspaceFreshness = ({
  activeWorkspace,
  isLoading,
  ...actions
}: WorkspaceFreshnessActions & {
  activeWorkspace: AppWorkspace;
  isLoading: boolean;
}) => {
  const actionsRef = useRef(actions);
  const activeWorkspaceRef = useRef(activeWorkspace);
  const isLoadingRef = useRef(isLoading);
  actionsRef.current = actions;
  activeWorkspaceRef.current = activeWorkspace;
  isLoadingRef.current = isLoading;

  useEffect(() => {
    if (isLoading) return;
    if (activeWorkspace === "targets") {
      void actionsRef.current.refreshTargets("page-entry");
    } else if (activeWorkspace === "library") {
      void actionsRef.current.refreshSkills("page-entry");
    }
  }, [activeWorkspace, isLoading]);

  useEffect(() => {
    const handleFocus = () => {
      if (isLoadingRef.current) return;
      const workspace = activeWorkspaceRef.current;
      if (workspace === "targets" || workspace === "profiles") {
        void actionsRef.current.refreshTargets("focus");
      }
      if (workspace === "library" || workspace === "profiles" || workspace === "targets") {
        void actionsRef.current.refreshSkillDiscoveries(false, "focus");
      }
      if (workspace === "library" || workspace === "profiles") {
        void actionsRef.current.refreshSkills("focus");
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);
};
