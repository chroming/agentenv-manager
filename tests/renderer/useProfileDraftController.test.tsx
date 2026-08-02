// @vitest-environment jsdom
import { useMemo, useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEnvApi,
  ProfileDetail,
  ProfileSummary,
  TargetInfo,
  TargetManagementState
} from "../../src/shared/types";
import { useProfileDraftController } from "../../src/renderer/hooks/useProfileDraftController";

const profile = (
  id: string,
  contentHash = `${id}-hash`
): ProfileDetail => ({
  id,
  profileDir: `/tmp/profiles/${id}`,
  manifest: {
    id,
    preferredTargetId: "opencode",
    name: id,
    description: "",
    version: 2
  },
  instructions: "# Agent\n",
  resources: { skills: [], mcpByTarget: {} },
  contentHash,
  targetContentHashes: { opencode: contentHash }
});

const summary = (detail: ProfileDetail): ProfileSummary => ({
  id: detail.id,
  preferredTargetId: detail.manifest.preferredTargetId,
  name: detail.manifest.name,
  description: detail.manifest.description,
  contentHash: detail.contentHash,
  targetContentHashes: detail.targetContentHashes
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const installApi = (api: Partial<AgentEnvApi>) => {
  Object.defineProperty(window, "agentEnv", {
    configurable: true,
    value: api as AgentEnvApi
  });
};

const target = {
  id: "opencode",
  name: "OpenCode"
} as TargetInfo;

const useHarness = (initialProfile = profile("daily")) => {
  const [profiles, setProfiles] = useState([summary(initialProfile)]);
  const [profileLibraryVersions, setProfileLibraryVersions] =
    useState<Record<string, { skills: Record<string, string> }>>({
      [initialProfile.id]: { skills: {} }
    });
  const [skillUsage, setSkillUsage] = useState<Record<string, string[]>>({});
  const [targetStates, setTargetStates] = useState<TargetManagementState[]>([{
    targetId: "opencode",
    status: "managed",
    activeProfileId: initialProfile.id,
    activeProfileName: initialProfile.manifest.name,
    appliedProfileHash: initialProfile.contentHash,
    lifecycleStatus: "applied",
    managedResourceCount: 0,
    warningCount: 0,
    errorCount: 0
  }]);
  const onBusyChange = useMemo(() => vi.fn(), []);
  const onError = useMemo(() => vi.fn(), []);
  const onDraftInvalidated = useMemo(() => vi.fn(), []);
  const controller = useProfileDraftController({
    profiles,
    targets: [target],
    librarySkills: [],
    profileLibraryVersions,
    setProfiles,
    setProfileLibraryVersions,
    setSkillUsage,
    setTargetStates,
    onBusyChange,
    onError,
    onDraftInvalidated
  });

  return {
    controller,
    onBusyChange,
    onDraftInvalidated,
    onError,
    profiles,
    skillUsage,
    targetStates
  };
};

describe("useProfileDraftController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the latest Profile selection when an older read finishes later", async () => {
    const secondRead = deferred<ProfileDetail>();
    const thirdRead = deferred<ProfileDetail>();
    installApi({
      readProfile: vi.fn((id: string) =>
        id === "second" ? secondRead.promise : thirdRead.promise
      )
    });
    const { result } = renderHook(() => useHarness());

    let secondSelection!: Promise<ProfileDetail | undefined>;
    let thirdSelection!: Promise<ProfileDetail | undefined>;
    act(() => {
      secondSelection = result.current.controller.selectProfile("second");
      thirdSelection = result.current.controller.selectProfile("third");
    });
    await act(async () => {
      secondRead.resolve(profile("second"));
      await secondSelection;
    });
    expect(result.current.controller.selectedProfileId).toBeUndefined();
    expect(result.current.controller.profileLoadingId).toBe("third");

    await act(async () => {
      thirdRead.resolve(profile("third"));
      await thirdSelection;
    });
    expect(result.current.controller.selectedProfileId).toBe("third");
    expect(result.current.controller.draftProfile?.id).toBe("third");
    expect(result.current.controller.profileLoadingId).toBeUndefined();
  });

  it("saves one draft and synchronizes summary and active deployment state", async () => {
    const initial = profile("daily");
    const saved = profile("daily", "saved-hash");
    installApi({ saveProfile: vi.fn().mockResolvedValue(saved) });
    const { result } = renderHook(() => useHarness(initial));

    act(() => {
      result.current.controller.acceptProfile(initial);
      result.current.controller.updateDraft({
        ...initial,
        instructions: "# Changed\n"
      });
    });
    expect(result.current.controller.isDirty).toBe(true);

    await act(() => result.current.controller.saveDraft());

    expect(result.current.controller.isDirty).toBe(false);
    expect(result.current.controller.status).toBe("Profile saved");
    expect(result.current.profiles[0]?.contentHash).toBe("saved-hash");
    expect(result.current.targetStates[0]?.lifecycleStatus).toBe("pending");
    expect(result.current.onDraftInvalidated).toHaveBeenCalled();
  });

  it("returns to clean when a Skill edit is reverted and skips a no-op Save", async () => {
    const initial = {
      ...profile("daily"),
      resources: {
        skills: [{
          libraryId: "reviewer",
          targetName: "reviewer",
          enabled: true
        }],
        mcpByTarget: {}
      }
    };
    const saveProfile = vi.fn();
    installApi({ saveProfile });
    const { result } = renderHook(() => useHarness(initial));

    act(() => {
      result.current.controller.acceptProfile(initial);
      result.current.controller.updateDraft({
        ...initial,
        resources: {
          ...initial.resources,
          skills: [{ ...initial.resources.skills[0]!, enabled: false }]
        }
      });
    });
    expect(result.current.controller.isDirty).toBe(true);

    act(() => {
      result.current.controller.updateDraft(initial);
    });
    expect(result.current.controller.isDirty).toBe(false);

    await act(() => result.current.controller.saveDraft());

    expect(saveProfile).not.toHaveBeenCalled();
    expect(result.current.controller.isDirty).toBe(false);
    expect(result.current.controller.status).toBe("");
  });

  it("preserves an environment draft while saved Profile metadata changes", () => {
    const initial = profile("daily");
    const savedMetadata = {
      ...initial,
      manifest: {
        ...initial.manifest,
        name: "Daily review"
      }
    };
    const { result } = renderHook(() => useHarness(initial));

    act(() => {
      result.current.controller.acceptProfile(initial);
      result.current.controller.updateDraft({
        ...initial,
        instructions: "# Unsaved\n"
      });
      result.current.controller.acceptProfileMetadata(savedMetadata, "daily");
    });

    expect(result.current.controller.draftProfile?.manifest.name).toBe("Daily review");
    expect(result.current.controller.draftProfile?.instructions).toBe("# Unsaved\n");
    expect(result.current.controller.isDirty).toBe(true);

    act(() => {
      result.current.controller.updateDraft({
        ...result.current.controller.draftProfile!,
        instructions: initial.instructions
      });
    });
    expect(result.current.controller.isDirty).toBe(false);
  });

  it("reloads the saved Profile when a pending edit is discarded", async () => {
    const saved = profile("daily");
    installApi({ readProfile: vi.fn().mockResolvedValue(saved) });
    const { result } = renderHook(() => useHarness(saved));

    act(() => {
      result.current.controller.acceptProfile(saved);
      result.current.controller.updateDraft({
        ...saved,
        instructions: "# Unsaved\n"
      });
    });
    await act(() => result.current.controller.discardDraft());

    expect(result.current.controller.draftProfile?.instructions).toBe("# Agent\n");
    expect(result.current.controller.isDirty).toBe(false);
  });
});
