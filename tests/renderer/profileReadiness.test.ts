import { describe, expect, it } from "vitest";
import type {
  ActivationPreview,
  ApplyIssue,
  ProfileDetail,
  TargetInfo,
  TargetManagementState
} from "../../src/shared/types";
import {
  deriveApplyActionLabel,
  deriveProfileReadiness,
  hasManagedTargetDrift
} from "../../src/renderer/profileReadiness";

const profile = { id: "daily-coding", contentHash: "saved-hash" } as ProfileDetail;

const target = {
  id: "codex",
  name: "Codex",
  health: {
    canWrite: true
  }
} as TargetInfo;

const managedState = {
  targetId: "codex",
  status: "managed",
  activeProfileId: "daily-coding",
  appliedProfileHash: "saved-hash"
} as TargetManagementState;

const unmanagedState = {
  targetId: "codex",
  status: "unmanaged"
} as TargetManagementState;

const issue = (
  message: string,
  code: ApplyIssue["code"] = "operation-precondition",
  disposition: ApplyIssue["disposition"] = "block"
): ApplyIssue => ({
  id: `${code}:${message}`,
  code,
  disposition,
  resolution: disposition === "review" ? "backup-replace" : "external-action",
  resourceKind: "target",
  message
});

const previewWith = (...issues: ApplyIssue[]) => ({ issues }) as ActivationPreview;
const blockedPreview = (message: string) => previewWith(issue(message));

describe("profile readiness", () => {
  it("prioritizes missing profile and target before draft and validation states", () => {
    expect(
      deriveProfileReadiness({
        isDirty: true,
        localValidationErrors: ["Instructions are empty"],
        preview: blockedPreview("Preview blocked")
      })
    ).toEqual({
      status: "no-profile",
      label: "No profile",
      message: "Create a profile to continue"
    });

    expect(
      deriveProfileReadiness({
        profile,
        isDirty: true,
        localValidationErrors: ["Instructions are empty"],
        preview: blockedPreview("Preview blocked")
      })
    ).toEqual({
      status: "no-target",
      label: "No Agent",
      message: "Select an Agent to continue"
    });
  });

  it("labels unmanaged and managed targets", () => {
    const unmanagedInput = {
      profile,
      target,
      targetState: unmanagedState,
      isDirty: false
    };
    const managedInput = {
      profile,
      target,
      targetState: managedState,
      isDirty: false
    };

    expect(deriveProfileReadiness(unmanagedInput)).toEqual({
      status: "unmanaged",
      label: "Ready",
      message: "Codex is ready to take over"
    });
    expect(deriveApplyActionLabel(unmanagedInput)).toBe("Take over Codex");

    expect(deriveProfileReadiness(managedInput)).toEqual({
      status: "applied",
      label: "Applied",
      message: "Codex matches this profile"
    });
    expect(deriveApplyActionLabel(managedInput)).toBe("Applied to Codex");

    const otherProfileInput = {
      ...managedInput,
      targetState: { ...managedState, activeProfileId: "other-profile" }
    };
    expect(deriveProfileReadiness(otherProfileInput).status).toBe("ready");
    expect(deriveApplyActionLabel(otherProfileInput)).toBe("Preview & apply to Codex");
  });

  it("classifies managed drift from preview errors", () => {
    const driftIssue = issue(
      "AgentEnv-managed Instructions changed outside AgentEnv",
      "managed-resource-drift",
      "review"
    );

    expect(hasManagedTargetDrift([driftIssue])).toBe(true);
    expect(
      hasManagedTargetDrift([issue("Other issue")])
    ).toBe(false);
    expect(
      deriveApplyActionLabel({
        profile,
        target,
        targetState: managedState,
        isDirty: false,
        preview: previewWith(driftIssue)
      })
    ).toBe("Preview & apply to Codex");
  });

  it("distinguishes saved changes from the version applied to the target", () => {
    const pending = {
      ...managedState,
      appliedProfileHash: "older-hash"
    };

    expect(
      deriveProfileReadiness({ profile, target, targetState: pending, isDirty: false })
    ).toEqual({
      status: "apply-pending",
      label: "Apply pending",
      message: "Saved changes have not been applied to Codex"
    });
    expect(
      deriveApplyActionLabel({ profile, target, targetState: pending, isDirty: false })
    ).toBe("Preview & apply to Codex");
  });

  it("marks referenced library changes as pending apply", () => {
    expect(
      deriveProfileReadiness({
        profile,
        target,
        targetState: managedState,
        isDirty: false,
        dependenciesCurrent: false
      })
    ).toEqual({
      status: "apply-pending",
      label: "Apply pending",
      message: "Library resources changed after this profile was applied to Codex"
    });
  });

  it("uses the complete readiness precedence and exact remediations", () => {
    const unavailableTarget = {
      ...target,
      health: { ...target.health, canWrite: false }
    };
    const cases = [
      {
        input: { isDirty: true },
        expected: [
          "no-profile",
          "Create a profile to continue",
          undefined
        ]
      },
      {
        input: { profile, isDirty: true },
        expected: ["no-target", "Select an Agent to continue", undefined]
      },
      {
        input: { profile, target, isDirty: true },
        expected: ["dirty", "Save this profile before previewing changes", "Save now"]
      },
      {
        input: { profile, target: unavailableTarget, isDirty: false },
        expected: ["target-unavailable", "Codex is unavailable", "Open Agents"]
      },
      {
        input: {
          profile,
          target,
          isDirty: false,
          localValidationErrors: ["Instructions are empty"],
          preview: blockedPreview("Preview blocked")
        },
        expected: ["validation-error", "This profile has validation issues", undefined]
      },
      {
        input: {
          profile,
          target,
          isDirty: false,
          preview: blockedPreview("Preview blocked")
        },
        expected: ["preview-error", "Preview found blocking issues", undefined]
      },
      {
        input: { profile, target, targetState: unmanagedState, isDirty: false },
        expected: ["unmanaged", "Codex is ready to take over", undefined]
      },
      {
        input: { profile, target, targetState: managedState, isDirty: false },
        expected: ["applied", "Codex matches this profile", undefined]
      }
    ] as const;

    for (const { input, expected } of cases) {
      const readiness = deriveProfileReadiness(input);
      expect([readiness.status, readiness.message, readiness.remediationLabel]).toEqual(expected);
    }
  });

  it("requires review when a managed target changed outside AgentEnv", () => {
    const driftedState = { ...managedState, errorCount: 1 };

    expect(
      deriveProfileReadiness({ profile, target, targetState: driftedState, isDirty: false })
    ).toEqual({
      status: "preview-error",
      label: "Needs review",
      message: "Codex changed outside AgentEnv"
    });
    expect(
      deriveApplyActionLabel({ profile, target, targetState: driftedState, isDirty: false })
    ).toBe("Review Codex issues");
  });

  it("offers a distinct recovery destination only when target recovery is required", () => {
    expect(
      deriveProfileReadiness({
        profile,
        target,
        targetState: { ...managedState, lifecycleStatus: "recovery-required" },
        isDirty: false
      })
    ).toEqual({
      status: "preview-error",
      label: "Needs review",
      message: "Codex requires recovery",
      remediationLabel: "Open Recovery"
    });
  });

  it("reviews unavailable and locally invalid targets before lifecycle labels", () => {
    expect(
      deriveApplyActionLabel({
        profile,
        target: { ...target, health: { ...target.health, canWrite: false } },
        targetState: managedState,
        isDirty: false
      })
    ).toBe("Review Codex issues");
    expect(
      deriveApplyActionLabel({
        profile,
        target,
        targetState: managedState,
        isDirty: false,
        localValidationErrors: ["Instructions are empty"]
      })
    ).toBe("Review Codex issues");
  });
});
