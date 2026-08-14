import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { Plus, TriangleAlert } from "lucide-react";
import type {
  ProfileDetail,
  ProfileSummary,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { useI18n } from "../i18n";
import {
  profileDeploymentStatusLabels,
  summarizeProfileApplications
} from "../profileSummary";
import { ResourceIcon } from "./ResourceIconPicker";
import { ProfileActionsMenu } from "./ProfileActionsMenu";
import { defaultProfileIconKey } from "../productIcons";
import { ObjectSwitcher } from "./ui";

interface ProfileListProps {
  isLoading: boolean;
  profiles: ProfileSummary[];
  search: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  selectedProfileId?: string;
  draftProfile?: ProfileDetail;
  isProfileDirty: boolean;
  profileSaveStatus?: string;
  targets: TargetInfo[];
  targetStates: TargetManagementState[];
  actionsDisabled?: boolean;
  variant?: "header" | "hero";
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(returnFocus: HTMLButtonElement | null): void;
  onDelete(profileId: string, returnFocus: HTMLElement): void;
  onDuplicate(profileId: string): void;
  onSearchChange(value: string): void;
  onReorder(profileIds: string[]): void;
  onSelect(profileId: string): void;
}

export const ProfileList = ({
  isLoading,
  profiles,
  search,
  searchInputRef,
  selectedProfileId,
  draftProfile,
  isProfileDirty,
  profileSaveStatus,
  targets,
  targetStates,
  actionsDisabled = false,
  variant = "header",
  open,
  onOpenChange,
  onCreate,
  onDelete,
  onDuplicate,
  onSearchChange,
  onReorder,
  onSelect
}: ProfileListProps) => {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{
    profileId: string;
    left: number;
    top: number;
  }>();
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextReturnFocusRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(
      Math.max(margin, contextMenu.left),
      Math.max(margin, window.innerWidth - rect.width - margin)
    );
    const top = Math.min(
      Math.max(margin, contextMenu.top),
      Math.max(margin, window.innerHeight - rect.height - margin)
    );
    if (left !== contextMenu.left || top !== contextMenu.top) {
      setContextMenu((current) => current ? { ...current, left, top } : current);
      return;
    }
    contextMenuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const dismiss = (restoreFocus = false) => {
      setContextMenu(undefined);
      if (restoreFocus) {
        window.requestAnimationFrame(() => contextReturnFocusRef.current?.focus());
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest(".profile-row-context-menu")) {
        dismiss();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss(true);
      }
    };
    const handleWindowChange = () => dismiss();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [contextMenu]);

  const switcherItems = profiles.map((profile) => {
    const isBroken = Boolean(profile.loadError);
    const deployment = summarizeProfileApplications(profile.id, targetStates, targets);
    const isSelected = profile.id === selectedProfileId;
    const iconKey =
      (isSelected ? draftProfile?.manifest.iconKey : undefined) ??
      profile.iconKey ??
      defaultProfileIconKey;
    const deploymentStatus = t(profileDeploymentStatusLabels[deployment.state]);
    const deploymentLabel = deployment.items.length > 1
      ? t("{{count}} Agents · {{status}}", {
          count: deployment.items.length,
          status: deploymentStatus
        })
      : deployment.items.length === 1
        ? t("{{name}} · {{status}}", {
            name: deployment.items[0].name,
            status: deploymentStatus
          })
        : deploymentStatus;
    const deploymentTitle = deployment.items.length > 0
      ? deployment.items
          .map((application) => t("{{name}} · {{status}}", {
            name: application.name,
            status: t(profileDeploymentStatusLabels[application.state])
          }))
          .join(", ")
      : deploymentLabel;
    return {
      id: profile.id,
      ariaLabel: t("Profile {{name}}", { name: profile.name }),
      searchText: `${profile.name} ${profile.description}`,
      icon: isBroken
        ? <TriangleAlert size={18} strokeWidth={2.2} />
        : <ResourceIcon iconKey={iconKey} size={18} />,
      title: (
        <>
          <span className="profile-row__name">{profile.name}</span>
          {isSelected && isProfileDirty ? (
            <strong className="profile-row__dirty">
              {t(profileSaveStatus === "Profile save failed" ? "Save failed" : "Saving...")}
            </strong>
          ) : null}
        </>
      ),
      description: isBroken
        ? t("Stored Profile data could not be loaded")
        : (
          <span
            className={`profile-row__deployments profile-row__deployments--${deployment.state}`}
            aria-label={deploymentTitle}
            title={deploymentTitle}
          >
            <span className="profile-row__deployment-label">{deploymentLabel}</span>
          </span>
        ),
      tooltip: profile.loadError,
      disabled: isLoading,
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault();
        if (isBroken || actionsDisabled) return;
        contextReturnFocusRef.current = event.currentTarget;
        setContextMenu({
          profileId: profile.id,
          left: event.clientX,
          top: event.clientY
        });
      }
    };
  });

  return (
    <>
      <ObjectSwitcher
        ariaLabel={t("Choose Profile")}
        className={`profile-switcher profile-switcher--${variant}`}
        emptyMessage={t(isLoading ? "Loading Profiles" : "No Profiles match this view")}
        footerAction={{
          icon: <Plus size={15} />,
          label: t("New Profile"),
          onClick: onCreate
        }}
        items={switcherItems}
        open={open}
        query={search}
        searchInputRef={searchInputRef}
        searchLabel={t("Search Profiles")}
        searchPlaceholder={t("Search Profiles")}
        selectedId={selectedProfileId}
        triggerVariant={variant === "hero" ? "inline" : "default"}
        showTriggerIcon={variant !== "hero"}
        showTriggerTitle
        showTriggerDescription={variant !== "hero"}
        onOpenChange={onOpenChange}
        onQueryChange={onSearchChange}
        onReorder={onReorder}
        onSelect={onSelect}
      />
      {contextMenu ? createPortal(
        <ProfileActionsMenu
          className="profile-row-context-menu"
          disabled={actionsDisabled}
          menuRef={contextMenuRef}
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onDuplicate={() => {
            onDuplicate(contextMenu.profileId);
            setContextMenu(undefined);
          }}
          onDelete={() => {
            const returnFocus = contextReturnFocusRef.current;
            setContextMenu(undefined);
            if (returnFocus) onDelete(contextMenu.profileId, returnFocus);
          }}
        />,
        document.body
      ) : null}
    </>
  );
};
