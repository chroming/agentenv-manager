import { describe, expect, it } from "vitest";
import type { ProfileResources, SkillLibraryEntry } from "../../src/shared/types";
import {
  addProfileSkillGroup,
  materializeProfileSkillGroups,
  profileSkillEnabled,
  reconcileProfileSkillGroups,
  removeProfileSkillGroup,
  setProfileSkillGroupEnabled,
  sourceProfileSkillGroupName,
  syncProfileSkillGroup
} from "../../src/shared/profileSkillGroups";

const librarySkills: SkillLibraryEntry[] = ["alpha", "beta", "gamma"].map((id) => ({
  id,
  name: id,
  description: `${id} skill`,
  path: `/library/${id}`,
  sourceType: "local",
  updatePolicy: "untracked",
  contentHash: `${id}-hash`,
  updatedAt: "2026-08-21T00:00:00.000Z"
}));

const emptyResources = (): ProfileResources => ({ skills: [], mcpByTarget: {} });

describe("Profile Skill Groups", () => {
  it("uses the group as a gate while preserving member preferences", () => {
    const grouped = addProfileSkillGroup(emptyResources(), {
      kind: "manual",
      groupId: "group-review",
      name: "Review",
      iconKey: "shield",
      memberIds: ["alpha", "beta"]
    }, librarySkills);
    expect(grouped.skillGroups?.[0]?.iconKey).toBe("shield");
    const withMemberOff = {
      ...grouped,
      skills: grouped.skills.map((skill) =>
        skill.libraryId === "beta" ? { ...skill, enabled: false } : skill
      )
    };

    const groupId = withMemberOff.skillGroups![0].id;
    const groupOff = setProfileSkillGroupEnabled(withMemberOff, groupId, false);
    expect(groupOff.skills.map((skill) => skill.enabled)).toEqual([true, false]);
    expect(groupOff.skills.every((skill) => !profileSkillEnabled(groupOff, skill))).toBe(true);
    expect(materializeProfileSkillGroups(groupOff).skills.map((skill) => skill.enabled)).toEqual([false, false]);

    const restored = setProfileSkillGroupEnabled(groupOff, groupId, true);
    expect(restored.skills.map((skill) => profileSkillEnabled(restored, skill))).toEqual([true, false]);
  });

  it("removes group-only members but preserves Skills that were already direct", () => {
    const resources: ProfileResources = {
      skills: [{ libraryId: "alpha", targetName: "alpha", enabled: true }],
      mcpByTarget: {}
    };
    const grouped = addProfileSkillGroup(resources, {
      kind: "manual",
      groupId: "group-review",
      name: "Review",
      memberIds: ["alpha", "beta"]
    }, librarySkills);
    const removed = removeProfileSkillGroup(grouped, grouped.skillGroups![0].id);

    expect(removed.skills.map((skill) => skill.libraryId)).toEqual(["alpha"]);
    expect(removed.skills[0].groupIds).toBeUndefined();
  });

  it("syncs membership without losing existing member switches", () => {
    const grouped = addProfileSkillGroup(emptyResources(), {
      kind: "manual",
      groupId: "group-review",
      name: "Review",
      memberIds: ["alpha", "beta"]
    }, librarySkills);
    const groupId = grouped.skillGroups![0].id;
    const withPreference = {
      ...grouped,
      skills: grouped.skills.map((skill) =>
        skill.libraryId === "beta" ? { ...skill, enabled: false } : skill
      )
    };
    const synced = syncProfileSkillGroup(withPreference, groupId, {
      kind: "manual",
      groupId: "group-review",
      name: "Review and test",
      memberIds: ["beta", "gamma"]
    }, librarySkills);

    expect(synced.skillGroups![0]).toMatchObject({
      id: groupId,
      name: "Review and test",
      memberIds: ["beta", "gamma"]
    });
    expect(synced.skills.find((skill) => skill.libraryId === "beta")?.enabled).toBe(false);
    expect(synced.skills.find((skill) => skill.libraryId === "gamma")?.enabled).toBe(true);
  });

  it("reconciles current Group membership while preserving saved member choices", () => {
    const grouped = addProfileSkillGroup(emptyResources(), {
      kind: "manual",
      groupId: "group-review",
      name: "Review",
      memberIds: ["alpha", "beta"]
    }, librarySkills);
    const withPreference = {
      ...grouped,
      skills: grouped.skills.map((skill) =>
        skill.libraryId === "beta" ? { ...skill, enabled: false } : skill
      )
    };

    const reconciled = reconcileProfileSkillGroups(withPreference, [{
      kind: "manual",
      groupId: "group-review",
      name: "Review and test",
      memberIds: ["beta", "gamma"]
    }], librarySkills);

    expect(reconciled.skillGroups?.[0]).toMatchObject({
      name: "Review and test",
      memberIds: ["beta", "gamma"]
    });
    expect(reconciled.skills.map((skill) => [skill.libraryId, skill.enabled])).toEqual([
      ["beta", false],
      ["gamma", true]
    ]);
    expect(reconcileProfileSkillGroups(reconciled, [{
      kind: "manual",
      groupId: "group-review",
      name: "Review and test",
      memberIds: ["beta", "gamma"]
    }], librarySkills)).toBe(reconciled);
  });

  it("uses a readable repository and directory name for source groups", () => {
    expect(sourceProfileSkillGroupName({
      sourceId: "source-1",
      canonicalLink: "https://github.com/anthropics/skills/tree/main/skills/algorithmic-art",
      repository: "https://github.com/anthropics/skills.git",
      ref: "main",
      directory: "skills/algorithmic-art",
      sourceKind: "repository",
      automaticChecks: true,
      observationState: "ready",
      counts: { total: 1, updates: 0, new: 0, removed: 0 },
      candidates: [],
      formatVersion: 1
    })).toBe("anthropics/skills · skills/algorithmic-art");
  });
});
