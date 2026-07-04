import { type RefObject, useEffect } from "react";
import type { AppWorkspace, LibraryTab } from "../components/ProfileSidebar";

interface DesktopShortcutOptions {
  activeWorkspace: AppWorkspace;
  activeLibraryTab: LibraryTab;
  isProfileSaving: boolean;
  onSaveProfile(): void | Promise<void>;
  profileSearchRef: RefObject<HTMLInputElement | null>;
  skillSearchRef: RefObject<HTMLInputElement | null>;
  mcpSearchRef: RefObject<HTMLInputElement | null>;
  platform?: string;
}

const hasVisibleBlockingModal = () =>
  [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some((modal) => {
    const style = window.getComputedStyle(modal);
    return (
      !modal.hidden &&
      modal.getAttribute("aria-hidden") !== "true" &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  });

export const useDesktopShortcuts = ({
  activeWorkspace,
  activeLibraryTab,
  isProfileSaving,
  onSaveProfile,
  profileSearchRef,
  skillSearchRef,
  mcpSearchRef,
  platform = navigator.platform
}: DesktopShortcutOptions) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) {
        return;
      }
      const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
      const hasCommandModifier = isMac ? event.metaKey : event.ctrlKey;
      if (!hasCommandModifier) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== "s" && key !== "f") {
        return;
      }
      const isSaveContext = key === "s" && activeWorkspace === "profiles";
      const isFindContext =
        key === "f" &&
        (activeWorkspace === "profiles" || activeWorkspace === "library");
      if (!isSaveContext && !isFindContext) {
        return;
      }

      event.preventDefault();
      if (hasVisibleBlockingModal()) {
        return;
      }

      if (isSaveContext) {
        if (!isProfileSaving) {
          void onSaveProfile();
        }
        return;
      }

      const searchInput =
        activeWorkspace === "profiles"
          ? profileSearchRef.current
          : activeLibraryTab === "skills"
            ? skillSearchRef.current
            : mcpSearchRef.current;
      searchInput?.focus();
      searchInput?.select();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    activeLibraryTab,
    activeWorkspace,
    isProfileSaving,
    mcpSearchRef,
    onSaveProfile,
    platform,
    profileSearchRef,
    skillSearchRef
  ]);
};
