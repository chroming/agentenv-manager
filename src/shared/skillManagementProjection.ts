import type {
  SkillCleanupGroup,
  SkillCollectionLinkGroup
} from "./skillCleanup";

export type SkillManagementState =
  | "managed"
  | "not-managed"
  | "needs-decision"
  | "unavailable";

export type SkillRuntimeControl = "profile" | "shared" | "external";

export type SkillManagementHealth = "current" | "different" | "unavailable";

export type SkillManagementNextAction =
  | "none"
  | "manage"
  | "add-to-library"
  | "choose-version"
  | "review"
  | "repair";

export interface SkillManagementProjection {
  state: SkillManagementState;
  runtimeControl: SkillRuntimeControl;
  health: SkillManagementHealth;
  nextAction: SkillManagementNextAction;
}

const runtimeControlFor = (group: SkillCleanupGroup): SkillRuntimeControl => {
  if (group.sharedMigration && group.sharedMigration.state !== "outside") {
    return group.sharedMigration.state === "unmanaged" ? "external" : "shared";
  }
  if (group.activeItems.some((item) => item.status === "managed")) return "profile";
  return "external";
};

const decisionActionFor = (group: SkillCleanupGroup): SkillManagementNextAction => {
  const hasLibraryCopy = group.items.some((item) => Boolean(item.libraryId));
  const readableVersions = new Set(
    group.activeItems.map((item) => item.contentHash).filter(Boolean)
  );
  if (readableVersions.size > 1 || group.state === "conflict") {
    return hasLibraryCopy ? "choose-version" : "add-to-library";
  }
  if (!hasLibraryCopy || group.presentation.action === "add-to-library") {
    return "add-to-library";
  }
  return "review";
};

export const projectSkillCleanupGroup = (
  group: SkillCleanupGroup
): SkillManagementProjection => {
  const runtimeControl = runtimeControlFor(group);
  const unavailable =
    group.state === "broken" || group.presentation.state === "unavailable";
  if (unavailable) {
    return {
      state: "unavailable",
      runtimeControl,
      health: "unavailable",
      nextAction: "repair"
    };
  }

  if (group.bucket === "decision") {
    return {
      state: "needs-decision",
      runtimeControl,
      health: "different",
      nextAction: decisionActionFor(group)
    };
  }

  if (group.bucket === "ready") {
    return {
      state: "not-managed",
      runtimeControl,
      health: "current",
      nextAction: "manage"
    };
  }

  if (group.bucket === "unmanaged") {
    return {
      state: "not-managed",
      runtimeControl: "external",
      health: "current",
      nextAction: "none"
    };
  }

  return {
    state: "managed",
    runtimeControl,
    health: group.state === "stale" ? "different" : "current",
    nextAction: group.state === "stale" ? "review" : "none"
  };
};

export const projectSkillCollection = (
  collection: SkillCollectionLinkGroup
): SkillManagementProjection => {
  if (collection.state === "ready") {
    return {
      state: "managed",
      runtimeControl: "shared",
      health: "current",
      nextAction: "none"
    };
  }
  if (collection.state === "unmanaged") {
    return {
      state: "not-managed",
      runtimeControl: "external",
      health: "current",
      nextAction: "none"
    };
  }
  return {
    state: "needs-decision",
    runtimeControl: "shared",
    health: collection.state === "conflict" ? "different" : "current",
    nextAction: collection.state === "conflict" ? "choose-version" : "add-to-library"
  };
};
