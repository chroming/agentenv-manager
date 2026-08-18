import type { SkillInventoryEntry } from "../shared/types";
import {
  isSkillCleanupManageable,
  type SkillCleanupAutomaticEffect,
  type SkillCleanupDisplayState,
  type SkillCleanupGroup,
  type SkillCleanupRecommendedAction
} from "../shared/skillCleanup";
import type {
  SkillManagementNextAction,
  SkillManagementProjection,
  SkillManagementState,
  SkillRuntimeControl
} from "../shared/skillManagementProjection";
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
  if (status === "library") return "Matches Library";
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

export const isCleanupManageable = isSkillCleanupManageable;

export const cleanupPresentationLabel = (state: SkillCleanupDisplayState) => {
  if (state === "not-in-library") return "Not in Library";
  if (state === "duplicate-copies") return "Duplicate copies";
  if (state === "multiple-versions") return "Multiple versions";
  if (state === "copies-not-managed") return "Copies not managed";
  if (state === "local-changes-found") return "Local changes found";
  if (state === "managed-copy-changed") return "Managed copy changed";
  if (state === "legacy-records") return "Legacy records";
  if (state === "management-record-missing") return "Management record missing";
  if (state === "outside-agentenv") return "Outside AgentEnv";
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
  if (state === "legacy-records") return "Legacy records";
  if (state === "management-record-missing") return "Needs repair";
  if (state === "outside-agentenv") return "Outside";
  if (state === "shared-left-unmanaged" || state === "left-unmanaged") {
    return "Unmanaged";
  }
  if (state === "managed") return "Managed";
  return "Unmanaged";
};

export const cleanupPresentationChipClass = (state: SkillCleanupDisplayState) => {
  if (state === "managed") return "managed";
  if (state === "left-unmanaged" || state === "shared-left-unmanaged") {
    return "left-unmanaged";
  }
  if (state === "outside-agentenv") return "outside";
  if (state === "multiple-versions" || state === "local-changes-found") return "conflict";
  if (state === "managed-copy-changed") return "stale";
  if (state === "legacy-records" || state === "management-record-missing") return "pending";
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
  if (action === "review-details") return "Review details";
  return "";
};

export const cleanupActionDisplayLabel = (action: SkillCleanupRecommendedAction) => {
  if (action === "review-differences" || action === "review-drift") return "Compare";
  if (action === "review-paths") return "Review paths";
  if (action === "review-details") return "View details";
  return cleanupActionLabel(action);
};

export const skillManagementStateLabel = (state: SkillManagementState) => {
  if (state === "managed") return "Managed";
  if (state === "not-managed") return "Not managed";
  if (state === "needs-decision") return "Needs decision";
  return "Unavailable";
};

export const skillManagementStateClass = (projection: SkillManagementProjection) => {
  if (projection.state === "managed") return "managed";
  if (projection.state === "not-managed") return "left-unmanaged";
  if (projection.state === "unavailable") return "stale";
  return projection.health === "different" ? "conflict" : "pending";
};

export const skillManagementActionLabel = (action: SkillManagementNextAction) => {
  if (action === "manage") return "Manage";
  if (action === "add-to-library") return "Add to Library";
  if (action === "choose-version") return "Choose version";
  if (action === "review") return "Review";
  if (action === "repair") return "Repair";
  return "";
};

export const skillRuntimeControlLabel = (control: SkillRuntimeControl) => {
  if (control === "profile") return "Profile controlled";
  if (control === "shared") return "Shared across Agents";
  return "Outside AgentEnv";
};

export const cleanupEffectLabel = (effect: SkillCleanupAutomaticEffect) => {
  if (effect === "import-and-manage") return "Save and manage existing copies";
  if (effect === "import-shared") return "Manage shared Skills in place";
  if (effect === "move-shared-to-agents") return "Replace shared copies with Profiles";
  if (effect === "adopt-managed-copy") return "Adopt matching copies";
  if (effect === "migrate-legacy-ownership") return "Move legacy ownership into AgentEnv data";
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
