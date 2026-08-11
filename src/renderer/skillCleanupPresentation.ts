import type { SkillInventoryEntry } from "../shared/types";
import type {
  SkillCleanupAutomaticEffect,
  SkillCleanupDisplayState,
  SkillCleanupGroup,
  SkillCleanupRecommendedAction
} from "../shared/skillCleanup";
import { targetNameFor, type TargetNameIndex } from "./targetPresentation";

export const cleanupLocationLabel = (
  item: SkillInventoryEntry,
  targetNames: TargetNameIndex
) => {
  const names = item.foundIn.map((targetId) =>
    targetNameFor(targetId, targetNames, "Unknown Agent")
  );
  return names.length > 1 ? `Shared: ${names.join(" + ")}` : names[0] ?? "Unknown Agent";
};

const inventoryStatusLabel = (status: SkillInventoryEntry["status"]) => {
  if (status === "library") return "Imported";
  if (status === "outside") return "Outside AgentEnv";
  if (status === "left-unmanaged") return "Left unmanaged";
  return "Managed";
};

export const cleanupInventoryStatusLabel = (item: SkillInventoryEntry) =>
  item.externalEvidence?.state === "broken-link"
    ? "Broken link"
    : inventoryStatusLabel(item.status);

export const cleanupInventoryStatusClass = (item: SkillInventoryEntry) =>
  item.externalEvidence?.state === "broken-link" ? "stale" : item.status;

export const externalManagerLabel = (skill: SkillInventoryEntry | undefined) =>
  skill?.externalEvidence?.displayName ??
  (skill?.externalEvidence?.manager === "skills-cli"
    ? "Skills CLI"
    : skill?.externalEvidence?.manager ?? "Detected source");

export const isCleanupManageable = (item: SkillInventoryEntry) =>
  !item.collectionLink &&
  item.status !== "left-unmanaged" &&
  item.locationRole !== "discovery-only" &&
  (item.locationManagement !== "observed" || item.sharedLocation === true);

export const cleanupPresentationLabel = (state: SkillCleanupDisplayState) => {
  if (state === "not-in-library") return "Not in Library";
  if (state === "duplicate-copies") return "Duplicate copies";
  if (state === "multiple-versions") return "Multiple versions";
  if (state === "copies-not-managed") return "Copies not managed";
  if (state === "local-changes-found") return "Local changes found";
  if (state === "managed-copy-changed") return "Managed copy changed";
  if (state === "outside-agentenv") return "Outside AgentEnv";
  if (state === "shared-copy-needs-decisions") return "Needs Agent choices";
  if (state === "shared-copy-ready-to-move") return "Ready to move out of shared folder";
  if (state === "shared-left-unmanaged") return "Shared location left unmanaged";
  if (state === "left-unmanaged") return "Left unmanaged";
  if (state === "unavailable") return "Unavailable";
  return "Managed";
};

export const cleanupPresentationCompactLabel = (state: SkillCleanupDisplayState) => {
  if (state === "duplicate-copies") return "Duplicate";
  if (state === "unavailable") return "Unavailable";
  if (state === "multiple-versions") return "Multiple versions";
  if (state === "local-changes-found" || state === "managed-copy-changed") return "Changed";
  if (state === "outside-agentenv") return "Outside";
  if (state === "shared-copy-needs-decisions") return "Needs choice";
  if (state === "shared-copy-ready-to-move") return "Ready";
  if (state === "shared-left-unmanaged" || state === "left-unmanaged") {
    return "Unmanaged";
  }
  if (state === "managed") return "Managed";
  return "Unmanaged";
};

export const cleanupPresentationChipClass = (state: SkillCleanupDisplayState) => {
  if (state === "managed" || state === "shared-copy-ready-to-move") return "managed";
  if (state === "left-unmanaged" || state === "shared-left-unmanaged") {
    return "left-unmanaged";
  }
  if (state === "outside-agentenv") return "outside";
  if (state === "multiple-versions" || state === "local-changes-found") return "conflict";
  if (state === "managed-copy-changed") return "stale";
  if (state === "shared-copy-needs-decisions") return "pending";
  if (state === "duplicate-copies") return "library";
  if (state === "unavailable") return "stale";
  return "outside";
};

export const cleanupActionLabel = (action: SkillCleanupRecommendedAction) => {
  if (action === "add-to-library") return "Add to Library";
  if (action === "manage-copies") return "Manage copies";
  if (action === "review-differences") return "Review differences";
  if (action === "review-drift") return "Review drift";
  if (action === "review-paths") return "Review paths";
  if (action === "review-agents") return "Review Agents";
  if (action === "move-from-shared") return "Move out of shared folder";
  if (action === "review-details") return "Review details";
  return "";
};

export const cleanupActionDisplayLabel = (action: SkillCleanupRecommendedAction) => {
  if (action === "review-agents") return "Review Agents";
  if (action === "move-from-shared") return "Move";
  if (
    action === "review-differences" ||
    action === "review-drift" ||
    action === "review-paths" ||
    action === "review-details"
  ) {
    return "Review";
  }
  return cleanupActionLabel(action);
};

export const cleanupEffectLabel = (effect: SkillCleanupAutomaticEffect) => {
  if (effect === "import-and-manage") return "Save and manage existing copies";
  if (effect === "import-shared") return "Save shared copy and remove duplicates";
  if (effect === "move-shared-to-agents") return "Move Skills out of shared folder";
  if (effect === "adopt-managed-copy") return "Adopt matching copies";
  if (effect === "replace-with-managed-copy") return "Back up and replace local copies";
  if (effect === "refresh-managed-copy") return "Refresh managed copies";
  return "Remove unavailable links";
};

export const formatSkillCleanupDetails = (
  group: SkillCleanupGroup,
  targetNames: TargetNameIndex
) => [
  "AgentEnv Local Skill details",
  `Skill: ${group.primary?.name ?? group.skillKey}`,
  `Skill key: ${group.skillKey}`,
  `State: ${group.state}`,
  `Resolution: ${group.resolution}`,
  `Reason: ${group.resolutionReason}`,
  group.automaticEffect ? `Planned action: ${group.automaticEffect}` : undefined,
  "",
  ...group.items.flatMap((item, index) => [
    `Copy ${index + 1}:`,
    `Agent: ${cleanupLocationLabel(item, targetNames)}`,
    `Status: ${item.status}`,
    `Path: ${item.path}`,
    `Content hash: ${item.contentHash || "unavailable"}`,
    `Library: ${item.libraryId ?? "not imported"}`,
    `Install method: ${item.installMethod ?? "unknown"}`,
    `Location role: ${item.locationRole ?? "unknown"}`,
    `Location management: ${item.locationManagement ?? "unknown"}`,
    item.collectionLink ? `Collection link: ${item.collectionLink.path}` : undefined,
    item.collectionLink ? `Collection target: ${item.collectionLink.canonicalPath}` : undefined,
    `Runtime availability: ${item.runtimeAvailability ?? "unknown"}`,
    item.modifiedAt ? `Modified: ${item.modifiedAt}` : undefined,
    item.externalEvidence
      ? `External evidence: ${item.externalEvidence.displayName ?? item.externalEvidence.manager} (${item.externalEvidence.state})`
      : undefined,
    ...(item.runtimeIssues ?? []).map(
      (issue) => `Runtime issue [${issue.code}/${issue.severity}]: ${issue.message}`
    ),
    ...(item.runtimeStates ?? []).flatMap((state) => [
      `Runtime ${targetNameFor(state.targetId, targetNames, state.targetId)}: ${state.availability}`,
      ...state.issues.map(
        (issue) => `Runtime issue [${issue.code}/${issue.severity}]: ${issue.message}`
      )
    ]),
    ""
  ])
].filter((line): line is string => line !== undefined).join("\n");
