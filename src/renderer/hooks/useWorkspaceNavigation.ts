import { useCallback, useEffect, useState } from "react";
import type { AppWorkspace } from "../components/ProfileSidebar";

export const workspacePreferenceKey = "agentenv:last-workspace";

const workspaceValues = new Set<AppWorkspace>([
  "library",
  "profiles",
  "conversations",
  "targets",
  "settings"
]);

export const readWorkspacePreference = (): AppWorkspace | undefined => {
  try {
    const value = window.localStorage.getItem(workspacePreferenceKey);
    return value && workspaceValues.has(value as AppWorkspace)
      ? value as AppWorkspace
      : undefined;
  } catch {
    return undefined;
  }
};

export const useWorkspaceNavigation = (
  defaultWorkspace: AppWorkspace = "targets"
) => {
  const [initialWorkspacePreference] = useState(readWorkspacePreference);
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>(
    initialWorkspacePreference ?? defaultWorkspace
  );
  const [preferenceReady, setPreferenceReady] = useState(
    Boolean(initialWorkspacePreference)
  );

  useEffect(() => {
    if (!preferenceReady) return;
    try {
      window.localStorage.setItem(workspacePreferenceKey, activeWorkspace);
    } catch {
      // A blocked UI preference must never prevent the local manager from working.
    }
  }, [activeWorkspace, preferenceReady]);

  const openWorkspaceNow = useCallback((workspace: AppWorkspace) => {
    setActiveWorkspace(workspace);
  }, []);

  const markWorkspacePreferenceReady = useCallback(() => {
    setPreferenceReady(true);
  }, []);

  return {
    activeWorkspace,
    initialWorkspacePreference,
    markWorkspacePreferenceReady,
    openWorkspaceNow
  };
};
