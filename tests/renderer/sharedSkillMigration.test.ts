import { describe, expect, it, vi } from "vitest";
import {
  moveSharedSkillToAgents,
  moveSkillCollectionToAgents
} from "../../src/renderer/sharedSkillMigration";
import type {
  ActivationPreview,
  AgentEnvApi,
  ProfileDetail,
  SkillLibraryEntry,
  TargetManagementState
} from "../../src/shared/types";

const profile = (): ProfileDetail => ({
  id: "pi-profile",
  manifest: {
    id: "pi-profile",
    name: "Pi",
    description: "",
    preferredTargetId: "pi",
    version: 2
  },
  instructions: "",
  resources: {
    skills: [],
    managementByTarget: {
      pi: { instructions: "ignore", skills: "manage" }
    },
    mcpByTarget: {
      pi: { mode: "ignore", selections: [] }
    }
  },
  contentHash: "profile-hash"
});

const librarySkill = (): SkillLibraryEntry => ({
  id: "as-ops",
  name: "as-ops",
  description: "",
  path: "/data/skills-library/as-ops",
  sourceType: "local",
  updatePolicy: "untracked",
  contentHash: "skill-hash",
  updatedAt: "2026-07-28T00:00:00.000Z"
});

const preview = (): ActivationPreview => ({
  id: "preview-1",
  profileId: "pi-profile",
  profileContentHash: "next-hash",
  libraryVersions: { skills: { "as-ops": "skill-hash" } },
  createdAt: "2026-07-28T00:00:00.000Z",
  issues: [],
  changes: [],
  resourceChanges: [],
  liveFingerprints: {},
  resourceFingerprints: {},
  sourceFingerprints: {},
  sharedSkillPreparationChanged: true,
  targetStateChanged: true,
  targetId: "pi",
  targetState: { managedMcpNames: [] },
  operation: "apply"
});

const noOpPreview = (): ActivationPreview => ({
  ...preview(),
  sharedSkillPreparationChanged: false,
  targetStateChanged: false
});

const api = () => {
  const saved = {
    ...profile(),
    resources: {
      ...profile().resources,
      skills: [{ libraryId: "as-ops", targetName: "as-ops", enabled: true }]
    },
    contentHash: "next-hash"
  };
  return {
    listSkillLibrary: vi.fn().mockResolvedValue([librarySkill()]),
    listTargetStates: vi.fn(),
    readProfile: vi.fn().mockResolvedValue(profile()),
    updateProfileSkills: vi.fn().mockResolvedValue({ profile: saved, changed: true }),
    previewCreateProfileFromTarget: vi.fn(),
    createProfileFromTarget: vi.fn(),
    previewApply: vi.fn().mockResolvedValue(preview()),
    applyProfile: vi.fn().mockResolvedValue({ ok: true, backupId: "apply-backup" }),
    retireSharedSkill: vi.fn().mockResolvedValue({
      backupId: "migration-backup",
      libraryId: "as-ops",
      managedLocations: [
        "/home/.agents/skills/as-ops",
        "/home/.pi/agent/skills/as-ops"
      ],
      operation: "retire"
    }),
    retireSkillCollection: vi.fn().mockResolvedValue({
      backupId: "collection-backup",
      libraryId: "_collection",
      managedLocations: ["/home/.agents/skills/superpowers"],
      operation: "retire"
    })
  };
};

describe("moveSharedSkillToAgents", () => {
  it("adds the shared Skill to an applied Profile before moving the shared copy", async () => {
    const mockApi = api();
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "applied",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);

    await moveSharedSkillToAgents({
      api: mockApi as unknown as AgentEnvApi,
      migration: {
        skillKey: "as-ops",
        libraryId: "as-ops",
        paths: ["/home/.agents/skills/as-ops"]
      },
      targetIds: ["pi"],
      targetNames: { pi: "Pi" }
    });

    expect(mockApi.updateProfileSkills).toHaveBeenCalledWith({
      profileId: "pi-profile",
      targetId: "pi",
      expectedContentHash: "profile-hash",
      skills: [{ libraryId: "as-ops", targetName: "as-ops", enabled: true }],
      managementMode: "manage"
    });
    expect(mockApi.previewApply).toHaveBeenCalledWith("pi-profile", "pi");
    expect(mockApi.applyProfile).toHaveBeenCalledWith("pi-profile", "preview-1");
    expect(mockApi.retireSharedSkill).toHaveBeenCalledTimes(1);
  });

  it("allows current Profile policy to remove a globally disabled shared Skill", async () => {
    const mockApi = api();
    mockApi.listSkillLibrary.mockResolvedValue([
      { ...librarySkill(), globallyEnabled: false }
    ]);
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "applied",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);

    await moveSharedSkillToAgents({
      api: mockApi as unknown as AgentEnvApi,
      migration: {
        skillKey: "as-ops",
        libraryId: "as-ops",
        paths: ["/home/.agents/skills/as-ops"]
      },
      targetIds: ["pi"]
    });

    expect(mockApi.previewApply).toHaveBeenCalledWith("pi-profile", "pi");
    expect(mockApi.applyProfile).toHaveBeenCalled();
    expect(mockApi.retireSharedSkill).toHaveBeenCalled();
  });

  it("switches Keep current to Use Profile before moving a shared Skill", async () => {
    const mockApi = api();
    mockApi.readProfile.mockResolvedValue({
      ...profile(),
      resources: {
        ...profile().resources,
        managementByTarget: {
          pi: { instructions: "ignore", skills: "ignore" }
        }
      }
    });
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "applied",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);

    await moveSharedSkillToAgents({
      api: mockApi as unknown as AgentEnvApi,
      migration: {
        skillKey: "as-ops",
        libraryId: "as-ops",
        paths: ["/home/.agents/skills/as-ops"]
      },
      targetIds: ["pi"]
    });

    expect(mockApi.updateProfileSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        managementMode: "manage",
        skills: [{ libraryId: "as-ops", targetName: "as-ops", enabled: true }]
      })
    );
    expect(mockApi.retireSharedSkill).toHaveBeenCalled();
  });

  it("preserves Turn off while moving a shared Skill out of its compatibility path", async () => {
    const mockApi = api();
    mockApi.readProfile.mockResolvedValue({
      ...profile(),
      resources: {
        ...profile().resources,
        managementByTarget: {
          pi: { instructions: "ignore", skills: "disable" }
        }
      }
    });
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "applied",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);

    await moveSharedSkillToAgents({
      api: mockApi as unknown as AgentEnvApi,
      migration: {
        skillKey: "as-ops",
        libraryId: "as-ops",
        paths: ["/home/.agents/skills/as-ops"]
      },
      targetIds: ["pi"]
    });

    expect(mockApi.updateProfileSkills).not.toHaveBeenCalled();
    expect(mockApi.previewApply).toHaveBeenCalledWith("pi-profile", "pi");
    expect(mockApi.retireSharedSkill).toHaveBeenCalled();
  });

  it("captures current Skills for an unmanaged Agent before moving the shared copy", async () => {
    const mockApi = api();
    const capturedProfile = {
      ...profile(),
      resources: {
        ...profile().resources,
        skills: [{ libraryId: "as-ops", targetName: "as-ops", enabled: true }]
      }
    };
    mockApi.listTargetStates.mockResolvedValue([]);
    mockApi.previewCreateProfileFromTarget.mockResolvedValue({
      id: "capture-1",
      targetId: "pi",
      targetName: "Pi",
      scope: "skills",
      suggestedName: "Pi",
      createdAt: "2026-07-28T00:00:00.000Z",
      resources: [],
      warnings: [],
      errors: []
    });
    mockApi.createProfileFromTarget.mockResolvedValue({
      profile: capturedProfile,
      targetId: "pi",
      importedSkillCount: 0,
      importedMcpCount: 0,
      warnings: []
    });

    await moveSharedSkillToAgents({
      api: mockApi as unknown as AgentEnvApi,
      migration: {
        skillKey: "as-ops",
        libraryId: "as-ops",
        paths: ["/home/.agents/skills/as-ops"]
      },
      targetIds: ["pi"]
    });

    expect(mockApi.previewCreateProfileFromTarget).toHaveBeenCalledWith("pi", "skills");
    expect(mockApi.createProfileFromTarget).toHaveBeenCalledWith({
      previewId: "capture-1",
      name: "Pi"
    });
    expect(mockApi.updateProfileSkills).not.toHaveBeenCalled();
    expect(mockApi.applyProfile).toHaveBeenCalled();
    expect(mockApi.retireSharedSkill).toHaveBeenCalled();
  });

  it("does not absorb unrelated pending Profile changes", async () => {
    const mockApi = api();
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "pending",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);

    await expect(
      moveSharedSkillToAgents({
        api: mockApi as unknown as AgentEnvApi,
        migration: {
          skillKey: "as-ops",
          libraryId: "as-ops",
          paths: ["/home/.agents/skills/as-ops"]
        },
        targetIds: ["pi"],
        targetNames: { pi: "Pi" }
      })
    ).rejects.toThrow("Pi has pending or changed Profile resources");
    expect(mockApi.updateProfileSkills).not.toHaveBeenCalled();
    expect(mockApi.applyProfile).not.toHaveBeenCalled();
    expect(mockApi.retireSharedSkill).not.toHaveBeenCalled();
  });

  it("keeps the shared copy when Agent preparation fails", async () => {
    const mockApi = api();
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "applied",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);
    mockApi.applyProfile.mockResolvedValue({
      ok: false,
      errors: ["Pi changed while applying"]
    });

    await expect(
      moveSharedSkillToAgents({
        api: mockApi as unknown as AgentEnvApi,
        migration: {
          skillKey: "as-ops",
          libraryId: "as-ops",
          paths: ["/home/.agents/skills/as-ops"]
        },
        targetIds: ["pi"],
        targetNames: { pi: "Pi" }
      })
    ).rejects.toThrow("Pi could not be prepared");
    expect(mockApi.retireSharedSkill).not.toHaveBeenCalled();
  });

  it("treats an already-applied no-op preview as prepared", async () => {
    const mockApi = api();
    mockApi.readProfile.mockResolvedValue({
      ...profile(),
      resources: {
        ...profile().resources,
        skills: [{ libraryId: "as-ops", targetName: "as-ops", enabled: true }]
      }
    });
    mockApi.listTargetStates.mockResolvedValue([{
      targetId: "pi",
      activeProfileId: "pi-profile",
      status: "managed",
      lifecycleStatus: "applied",
      managedResourceCount: 1,
      warningCount: 0,
      errorCount: 0
    } satisfies TargetManagementState]);
    mockApi.previewApply.mockResolvedValue(noOpPreview());
    mockApi.applyProfile.mockResolvedValue({
      ok: false,
      kind: "no-op",
      errors: ["No changes to apply"]
    });

    await moveSharedSkillToAgents({
      api: mockApi as unknown as AgentEnvApi,
      migration: {
        skillKey: "as-ops",
        libraryId: "as-ops",
        paths: ["/home/.agents/skills/as-ops"]
      },
      targetIds: ["pi"]
    });

    expect(mockApi.applyProfile).not.toHaveBeenCalled();
    expect(mockApi.retireSharedSkill).toHaveBeenCalledTimes(1);
  });
});

describe("moveSkillCollectionToAgents", () => {
  it("saves exact collection intent without applying unrelated pending Profile changes", async () => {
    const mockApi = api();
    mockApi.listSkillLibrary.mockResolvedValue([
      librarySkill(),
      {
        ...librarySkill(),
        id: "debugging",
        name: "debugging",
        path: "/data/skills-library/debugging"
      }
    ]);
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "pending",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);
    mockApi.updateProfileSkills.mockImplementation(async (input) => ({
      profile: {
        ...profile(),
        resources: {
          ...profile().resources,
          skills: input.skills
        },
        contentHash: "collection-profile-hash"
      },
      changed: true
    }));

    await moveSkillCollectionToAgents({
      api: mockApi as unknown as AgentEnvApi,
      collection: {
        path: "/home/.agents/skills/superpowers",
        members: [
          {
            skillKey: "as-ops",
            libraryId: "as-ops",
            consumerTargetIds: ["pi"]
          },
          {
            skillKey: "debugging",
            libraryId: "debugging",
            consumerTargetIds: ["pi"]
          }
        ]
      }
    });

    expect(mockApi.updateProfileSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "pi-profile",
        targetId: "pi",
        expectedContentHash: "profile-hash",
        skills: [
          { libraryId: "as-ops", targetName: "as-ops", enabled: true },
          { libraryId: "debugging", targetName: "debugging", enabled: true }
        ]
      })
    );
    expect(mockApi.previewApply).not.toHaveBeenCalled();
    expect(mockApi.applyProfile).not.toHaveBeenCalled();
    expect(mockApi.retireSkillCollection).toHaveBeenCalledWith({
      path: "/home/.agents/skills/superpowers",
      profileReceipts: {
        pi: {
          profileId: "pi-profile",
          contentHash: "collection-profile-hash"
        }
      }
    });
  });

  it("moves a collection after its active Profile was already applied", async () => {
    const mockApi = api();
    mockApi.readProfile.mockResolvedValue({
      ...profile(),
      resources: {
        ...profile().resources,
        skills: [{ libraryId: "as-ops", targetName: "as-ops", enabled: true }]
      }
    });
    mockApi.listTargetStates.mockResolvedValue([{
      targetId: "pi",
      activeProfileId: "pi-profile",
      status: "managed",
      lifecycleStatus: "applied",
      managedResourceCount: 1,
      warningCount: 0,
      errorCount: 0
    } satisfies TargetManagementState]);
    mockApi.previewApply.mockResolvedValue(noOpPreview());
    mockApi.applyProfile.mockResolvedValue({
      ok: false,
      kind: "no-op",
      errors: ["No changes to apply"]
    });

    await moveSkillCollectionToAgents({
      api: mockApi as unknown as AgentEnvApi,
      collection: {
        path: "/home/.agents/skills/superpowers",
        members: [{
          skillKey: "as-ops",
          libraryId: "as-ops",
          consumerTargetIds: ["pi"]
        }]
      }
    });

    expect(mockApi.updateProfileSkills).not.toHaveBeenCalled();
    expect(mockApi.applyProfile).not.toHaveBeenCalled();
    expect(mockApi.retireSkillCollection).toHaveBeenCalledWith({
      path: "/home/.agents/skills/superpowers",
      profileReceipts: {
        pi: {
          profileId: "pi-profile",
          contentHash: "profile-hash"
        }
      }
    });
  });

  it("replaces a captured same-name reference with the reviewed Library member", async () => {
    const mockApi = api();
    mockApi.listSkillLibrary.mockResolvedValue([
      librarySkill(),
      {
        ...librarySkill(),
        id: "reviewed-as-ops",
        path: "/data/skills-library/reviewed-as-ops"
      }
    ]);
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "applied",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);
    mockApi.readProfile.mockResolvedValue({
      ...profile(),
      resources: {
        ...profile().resources,
        skills: [{
          libraryId: "captured-as-ops",
          targetName: "as-ops",
          enabled: true
        }]
      }
    });
    mockApi.updateProfileSkills.mockImplementation(async (input) => ({
      profile: {
        ...profile(),
        resources: {
          ...profile().resources,
          skills: input.skills
        },
        contentHash: "collection-profile-hash"
      },
      changed: true
    }));

    await moveSkillCollectionToAgents({
      api: mockApi as unknown as AgentEnvApi,
      collection: {
        path: "/home/.agents/skills/superpowers",
        members: [{
          skillKey: "as-ops",
          libraryId: "reviewed-as-ops",
          consumerTargetIds: ["pi"]
        }]
      }
    });

    expect(mockApi.updateProfileSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: [{
          libraryId: "reviewed-as-ops",
          targetName: "as-ops",
          enabled: true
        }]
      })
    );
  });

  it("switches Keep current to Use Profile before moving a collection", async () => {
    const mockApi = api();
    mockApi.readProfile.mockResolvedValue({
      ...profile(),
      resources: {
        ...profile().resources,
        managementByTarget: {
          pi: { instructions: "ignore", skills: "ignore" }
        }
      }
    });
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "applied",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);

    await moveSkillCollectionToAgents({
      api: mockApi as unknown as AgentEnvApi,
      collection: {
        path: "/home/.agents/skills/superpowers",
        members: [{
          skillKey: "as-ops",
          libraryId: "as-ops",
          consumerTargetIds: ["pi"]
        }]
      }
    });

    expect(mockApi.updateProfileSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        managementMode: "manage",
        skills: [{ libraryId: "as-ops", targetName: "as-ops", enabled: true }]
      })
    );
    expect(mockApi.retireSkillCollection).toHaveBeenCalled();
  });

  it("preserves Turn off while moving a collection out of its compatibility path", async () => {
    const mockApi = api();
    mockApi.readProfile.mockResolvedValue({
      ...profile(),
      resources: {
        ...profile().resources,
        managementByTarget: {
          pi: { instructions: "ignore", skills: "disable" }
        }
      }
    });
    mockApi.listTargetStates.mockResolvedValue([
      {
        targetId: "pi",
        activeProfileId: "pi-profile",
        status: "managed",
        lifecycleStatus: "applied",
        managedResourceCount: 0,
        warningCount: 0,
        errorCount: 0
      } satisfies TargetManagementState
    ]);

    await moveSkillCollectionToAgents({
      api: mockApi as unknown as AgentEnvApi,
      collection: {
        path: "/home/.agents/skills/superpowers",
        members: [{
          skillKey: "as-ops",
          libraryId: "as-ops",
          consumerTargetIds: ["pi"]
        }]
      }
    });

    expect(mockApi.updateProfileSkills).not.toHaveBeenCalled();
    expect(mockApi.previewApply).not.toHaveBeenCalled();
    expect(mockApi.applyProfile).not.toHaveBeenCalled();
    expect(mockApi.retireSkillCollection).toHaveBeenCalled();
  });
});
