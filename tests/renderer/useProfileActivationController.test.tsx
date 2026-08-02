// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActivationPreview,
  AgentEnvApi,
  ProfileDetail,
  TargetInfo
} from "../../src/shared/types";
import { useProfileActivationController } from "../../src/renderer/hooks/useProfileActivationController";

const profile = {
  id: "daily",
  profileDir: "/tmp/profiles/daily",
  manifest: {
    id: "daily",
    preferredTargetId: "opencode",
    name: "Daily",
    description: "",
    version: 2
  },
  instructions: "# Agent\n",
  resources: { skills: [], mcpByTarget: {} },
  contentHash: "profile-hash",
  targetContentHashes: { opencode: "profile-hash" }
} as ProfileDetail;

const target = {
  id: "opencode",
  name: "OpenCode",
  health: { canWrite: true, summary: "Ready" }
} as TargetInfo;

const preview = (id = "preview-1"): ActivationPreview => ({
  id,
  profileId: profile.id,
  profileContentHash: profile.contentHash ?? "",
  targetId: target.id,
  createdAt: "2026-07-29T00:00:00.000Z",
  issues: [],
  changes: [{
    path: "/tmp/AGENTS.md",
    before: "",
    after: "# Agent\n",
    diff: "+# Agent\n"
  }],
  resourceChanges: [],
  libraryVersions: { skills: {} },
  liveFingerprints: {},
  resourceFingerprints: {},
  sourceFingerprints: {},
  targetState: { managedMcpNames: [] }
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

const renderController = () => {
  const callbacks = {
    onApplied: vi.fn(),
    onBusyChange: vi.fn(),
    onError: vi.fn(),
    onRollbackClear: vi.fn(),
    onStatus: vi.fn(),
    onTargetsRefresh: vi.fn(),
    onTargetStatesRefresh: vi.fn(),
    translate: vi.fn((message: string) => message)
  };
  return {
    callbacks,
    hook: renderHook(() => useProfileActivationController(callbacks))
  };
};

describe("useProfileActivationController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds renderer validation blockers to the native Preview", async () => {
    installApi({ previewApply: vi.fn().mockResolvedValue(preview()) });
    const { callbacks, hook } = renderController();

    await act(() => hook.result.current.previewProfile({
      profile,
      target: {
        ...target,
        health: { ...target.health, canWrite: false, summary: "Not installed" }
      },
      dirty: false,
      localValidationErrors: ["Instructions are invalid"],
      onSaveRequired: vi.fn()
    }));

    expect(hook.result.current.preview?.issues.map((issue) => issue.code)).toEqual([
      "target-unavailable",
      "profile-validation"
    ]);
    expect(callbacks.onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it("does not publish a Preview that finishes after the dialog is cleared", async () => {
    const pendingPreview = deferred<ActivationPreview>();
    installApi({ previewApply: vi.fn().mockReturnValue(pendingPreview.promise) });
    const { callbacks, hook } = renderController();

    let request!: Promise<void>;
    act(() => {
      request = hook.result.current.previewProfile({
        profile,
        target,
        dirty: false,
        localValidationErrors: [],
        onSaveRequired: vi.fn()
      });
    });
    act(() => hook.result.current.clearPreview());
    await act(async () => {
      pendingPreview.resolve(preview());
      await request;
    });

    expect(hook.result.current.preview).toBeUndefined();
    expect(hook.result.current.isPreviewing).toBe(false);
    expect(callbacks.onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps the Apply dialog open with a refreshed Preview after stale input", async () => {
    installApi({
      applyProfile: vi.fn().mockResolvedValue({
        ok: false,
        kind: "stale",
        errors: ["Agent changed"]
      }),
      previewApply: vi.fn().mockResolvedValue(preview("preview-2"))
    });
    const { callbacks, hook } = renderController();

    act(() => hook.result.current.showPreview(preview()));
    await act(() => hook.result.current.applyProfile(profile));

    expect(hook.result.current.preview?.id).toBe("preview-2");
    expect(hook.result.current.refreshDetail).toBe("Agent changed");
    expect(callbacks.onStatus).toHaveBeenCalledWith(
      "The Agent changed while Preview was open. Preview refreshed."
    );
    expect(callbacks.onApplied).not.toHaveBeenCalled();
  });
});
