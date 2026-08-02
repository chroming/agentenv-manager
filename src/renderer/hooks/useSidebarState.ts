import { useCallback, useEffect, useState } from "react";

export const sidebarCollapsedPreferenceKey = "agentenv:sidebar-collapsed";

export const readSidebarCollapsedPreference = () => {
  try {
    return window.localStorage.getItem(sidebarCollapsedPreferenceKey) === "true";
  } catch {
    return false;
  }
};

export const useSidebarState = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readSidebarCollapsedPreference
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        sidebarCollapsedPreferenceKey,
        String(sidebarCollapsed)
      );
    } catch {
      // A blocked presentation preference must never prevent AgentEnv from working.
    }
  }, [sidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => !current);
  }, []);

  return { sidebarCollapsed, toggleSidebar };
};
