// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileSkillsComposerSection } from "../../src/renderer/components/ProfileSkillsComposerSection";
import type {
  ProfileDetail,
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetManagementState
} from "../../src/shared/types";

afterEach(cleanup);

const profile: ProfileDetail = {
  id: "daily-coding",
  manifest: {
    version: 2,
    id: "daily-coding",
    name: "Daily Coding",
    description: "Daily work"
  },
  instructions: "",
  resources: {
    skills: [{ libraryId: "review", targetName: "review", enabled: false }],
    managementByTarget: {
      opencode: { instructions: "manage", skills: "manage" }
    },
    mcpByTarget: {}
  },
  contentHash: "profile-hash"
};

const librarySkill: SkillLibraryEntry = {
  id: "review",
  name: "Code Review",
  description: "Review code",
  path: "/library/review",
  sourceType: "local",
  updatePolicy: "untracked",
  contentHash: "review-hash",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const retainedSharedSkill: SkillInventoryEntry = {
  id: "review",
  name: "Code Review",
  description: "Review code",
  path: "/home/test/.agents/skills/review",
  foundIn: ["opencode"],
  status: "left-unmanaged",
  skillKey: "review",
  runtimeName: "review",
  deploymentName: "review",
  runtimeAvailability: "enabled",
  runtimeConfidence: "verified",
  contentHash: "review-hash",
  contentMatchesLibrary: true,
  sharedLocation: true,
  managedAsShared: false,
  unmanagedCoverage: "exact",
  libraryId: "review"
};

const staleTargetState: TargetManagementState = {
  targetId: "opencode",
  activeProfileId: "daily-coding",
  status: "managed",
  lifecycleStatus: "applied",
  managedResourceCount: 0,
  warningCount: 0,
  errorCount: 0,
  sharedSkillPreparations: [{
    skillKey: "review",
    libraryId: "review",
    sharedPaths: ["/home/test/.agents/skills/review"],
    targetName: "review",
    disposition: "omit",
    profileId: "daily-coding",
    profileHash: "old-profile-hash"
  }]
};

describe("ProfileSkillsComposerSection", () => {
  it("does not revive a retained shared Skill from stale preparation state", () => {
    render(
      <ProfileSkillsComposerSection
        profile={profile}
        summary={{ count: 0, total: 1, names: ["Code Review"], mode: "manage" }}
        policy="manage"
        capabilityAvailable
        expanded
        targetId="opencode"
        targetName="OpenCode"
        targetState={staleTargetState}
        currentSkills={[retainedSharedSkill]}
        environmentScanStatus="ready"
        librarySkills={[librarySkill]}
        skillUpdates={[]}
        checkingSkillUpdates={false}
        onToggle={vi.fn()}
        onPolicyChange={vi.fn()}
        onReviewSharedSkills={vi.fn()}
        onRefresh={vi.fn()}
        onCheckUpdates={vi.fn()}
        onPreviewUpdate={vi.fn()}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByText("Shared copy prevents changes")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Move shared Skills to Profile control…"
    }))
      .not.toBeInTheDocument();
  });
});
