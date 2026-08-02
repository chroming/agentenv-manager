import { useCallback, useState } from "react";
import type { AppWorkspace } from "../components/ProfileSidebar";

export const useWorkspaceNavigation = (
  defaultWorkspace: AppWorkspace = "targets"
) => {
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>(defaultWorkspace);

  const openWorkspaceNow = useCallback((workspace: AppWorkspace) => {
    setActiveWorkspace(workspace);
  }, []);

  return {
    activeWorkspace,
    openWorkspaceNow
  };
};
