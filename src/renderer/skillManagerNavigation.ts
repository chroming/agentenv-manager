import type { ApplyIssue, ProfileDetail, TargetInfo } from "../shared/types";
import type { SkillManagementScope } from "../shared/skillCleanup";

export interface SkillManagerReturnContext {
  profileId: string;
  targetId: string;
}

export const createSkillManagerNavigation = ({
  targets,
  profile,
  target,
  setReturnContext,
  setSelectedTargetId,
  setFeedbackWorkspace,
  setLibraryMode,
  setScope,
  setOriginTargetId,
  setCollectionFocusPath,
  setActiveTool,
  openWorkspace,
  captureLibraryScroll,
  clearProfilePreview,
  refreshInventory,
  refreshProfilePreview,
  guardProfileAction
}: {
  targets: TargetInfo[];
  profile?: ProfileDetail;
  target?: TargetInfo;
  setReturnContext(value?: SkillManagerReturnContext): void;
  setSelectedTargetId(value: string): void;
  setFeedbackWorkspace(value: "library"): void;
  setLibraryMode(value: "skills"): void;
  setScope(value: SkillManagementScope): void;
  setOriginTargetId(value?: string): void;
  setCollectionFocusPath(value?: string): void;
  setActiveTool(value?: "discoveries"): void;
  openWorkspace(value: "library" | "profiles"): void;
  captureLibraryScroll(): void;
  clearProfilePreview(): void;
  refreshInventory(reason: "manual" | "page-entry"): Promise<void>;
  refreshProfilePreview(profileId: string, targetId: string): Promise<unknown>;
  guardProfileAction(label: string, action: () => void): void;
}) => {
  const open = (
    scope: SkillManagementScope,
    returnContext?: SkillManagerReturnContext,
    originTargetId?: string
  ) => {
    setReturnContext(returnContext);
    setOriginTargetId(originTargetId);
    setFeedbackWorkspace("library");
    setLibraryMode("skills");
    setScope(scope);
    setActiveTool("discoveries");
    openWorkspace("library");
    void refreshInventory("page-entry");
  };

  return {
    openAll: async () => {
      setReturnContext(undefined);
      setOriginTargetId(undefined);
      setFeedbackWorkspace("library");
      setLibraryMode("skills");
      setScope({ kind: "all" });
      setActiveTool("discoveries");
      openWorkspace("library");
      await refreshInventory("manual");
    },
    openTarget: (targetId: string) => {
      const nextTarget = targets.find((candidate) => candidate.id === targetId);
      if (!nextTarget) return;
      setSelectedTargetId(targetId);
      open({ kind: "all" }, undefined, targetId);
    },
    openShared: () => guardProfileAction("review shared Skills", () => {
      captureLibraryScroll();
      open({ kind: "shared" });
    }),
    reviewCollection: (issue: ApplyIssue) => {
      const collectionPath = issue.path ?? issue.resourceId;
      if (!collectionPath) return;
      clearProfilePreview();
      captureLibraryScroll();
      setCollectionFocusPath(collectionPath);
      open(
        { kind: "shared" },
        profile && target ? { profileId: profile.id, targetId: target.id } : undefined,
        target?.id
      );
    },
    reviewProfile: () => {
      if (!profile || !target) return;
      clearProfilePreview();
      captureLibraryScroll();
      open({ kind: "all" }, {
        profileId: profile.id,
        targetId: target.id
      }, target.id);
    },
    close: (returnContext?: SkillManagerReturnContext) => {
      setReturnContext(undefined);
      setOriginTargetId(undefined);
      setActiveTool(undefined);
      setScope({ kind: "all" });
      setCollectionFocusPath(undefined);
      if (!returnContext) return;
      setSelectedTargetId(returnContext.targetId);
      openWorkspace("profiles");
      void refreshProfilePreview(returnContext.profileId, returnContext.targetId);
    }
  };
};
