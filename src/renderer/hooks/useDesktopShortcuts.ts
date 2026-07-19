import { type RefObject, useEffect } from "react";
import type { AppWorkspace } from "../components/ProfileSidebar";

interface DesktopShortcutOptions {
  activeWorkspace: AppWorkspace;
  isProfileSaving: boolean;
  onSaveProfile(): void | Promise<void>;
  onRefreshSkills(): void | Promise<void>;
  profileSearchRef: RefObject<HTMLInputElement | null>;
  skillSearchRef: RefObject<HTMLInputElement | null>;
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
  isProfileSaving,
  onSaveProfile,
  onRefreshSkills,
  profileSearchRef,
  skillSearchRef,
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
      if (key !== "s" && key !== "f" && key !== "r") {
        return;
      }
      const isSaveContext = key === "s" && activeWorkspace === "profiles";
      const isFindContext =
        key === "f" &&
        (activeWorkspace === "profiles" || activeWorkspace === "library");
      const isRefreshContext = key === "r" && activeWorkspace === "library";
      if (!isSaveContext && !isFindContext && !isRefreshContext) {
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

      if (isRefreshContext) {
        void onRefreshSkills();
        return;
      }

      const searchInput =
        activeWorkspace === "profiles"
          ? profileSearchRef.current
          : skillSearchRef.current;
      searchInput?.focus();
      searchInput?.select();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    activeWorkspace,
    isProfileSaving,
    onSaveProfile,
    onRefreshSkills,
    platform,
    profileSearchRef,
    skillSearchRef
  ]);
};
