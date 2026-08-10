import type { ActivationService } from "../activationService";
import type { EvaluationService } from "../evaluations/evaluationService";
import type { ProfileStore } from "../profileStore";
import type { TargetCaptureService } from "../targetCaptureService";
import type {
  CreateProfileFromTargetInput,
  CreateProfileInput,
  ForkProfileSkillsInput,
  SaveProfileInput,
  TargetCaptureScope,
  UpdateProfileMetadataInput,
  UpdateProfileSkillsInput
} from "../../shared/types";
import { registerProfileComparisonIpc } from "./profileComparisonIpc";
import { parseId, type IpcRegistrationHandles } from "./registration";

interface ProfileIpcServices {
  activationService: ActivationService;
  evaluationService: EvaluationService;
  profileStore: ProfileStore;
  targetCaptureService: TargetCaptureService;
}

export const registerProfileIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  services: ProfileIpcServices
) => {
  const { diagnosticHandle, handleMutation } = handles;
  const { activationService, evaluationService, profileStore, targetCaptureService } = services;

  diagnosticHandle("profiles:list", () => profileStore.listProfiles());
  diagnosticHandle("profiles:read", async (_event, id: unknown) => {
    const profileId = parseId(id, "profile id");
    const testDelayMs = Number(process.env.AGENTENV_TEST_PROFILE_READ_DELAY_MS ?? 0);
    if (
      process.env.AGENTENV_AUTOMATION === "1" &&
      process.env.AGENTENV_TEST_PROFILE_READ_DELAY_ID === profileId &&
      Number.isFinite(testDelayMs) &&
      testDelayMs > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, testDelayMs));
    }
    return profileStore.readProfile(profileId);
  });
  handleMutation("profiles:save", (_event, input: SaveProfileInput) => profileStore.saveProfile(input));
  diagnosticHandle("profiles:recovery:list", (_event, id: unknown) =>
    profileStore.listProfileRecovery(parseId(id, "profile id"))
  );
  handleMutation("profiles:recovery:restore", (_event, id: unknown, recoveryId: unknown) =>
    profileStore.restoreProfileRecovery(
      parseId(id, "profile id"),
      parseId(recoveryId, "profile recovery id")
    )
  );
  handleMutation(
    "profiles:restore-applied",
    (_event, id: unknown, targetId: unknown, expectedContentHash: unknown) => {
      if (typeof expectedContentHash !== "string" || !expectedContentHash) {
        throw new Error("Restoring an applied Profile requires its current content hash");
      }
      return activationService.restoreAppliedProfile(
        parseId(id, "profile id"),
        parseId(targetId, "target id"),
        expectedContentHash
      );
    }
  );
  handleMutation("profiles:update-skills", (_event, input: UpdateProfileSkillsInput) =>
    profileStore.updateProfileSkills(input)
  );
  handleMutation("profiles:fork-skills", (_event, input: ForkProfileSkillsInput) =>
    profileStore.forkProfileSkills(input)
  );
  handleMutation("profiles:update-metadata", (_event, input: UpdateProfileMetadataInput) =>
    profileStore.updateProfileMetadata(input)
  );
  handleMutation("profiles:create", (_event, input: CreateProfileInput | string) =>
    profileStore.createProfile(
      typeof input === "string" ? { preferredTargetId: parseId(input, "target id") } : input
    )
  );
  diagnosticHandle("profiles:preview-create-from-target", (_event, targetId: unknown, scope: TargetCaptureScope | undefined) => {
    if (scope !== undefined && scope !== "all" && scope !== "skills") {
      throw new Error("Invalid capture scope");
    }
    return targetCaptureService.previewTarget(parseId(targetId, "target id"), scope);
  });
  handleMutation("profiles:create-from-target", (_event, input: CreateProfileFromTargetInput) =>
    targetCaptureService.createFromTarget(input)
  );
  handleMutation("profiles:duplicate", (_event, id: unknown) =>
    profileStore.duplicateProfile(parseId(id, "profile id"))
  );
  handleMutation("profiles:delete", async (_event, id: unknown) => {
    const profileId = parseId(id, "profile id");
    const activeTarget = (await activationService.listTargetStates()).find(
      (state) => state.activeProfileId === profileId
    );
    if (activeTarget) throw new Error("Apply another profile before removing this active profile");
    await profileStore.deleteProfile(profileId);
  });
  diagnosticHandle("activation:preview", (_event, profileId: unknown, targetId?: unknown) =>
    activationService.previewProfile(
      parseId(profileId, "profile id"),
      targetId === undefined ? undefined : parseId(targetId, "target id")
    )
  );
  handleMutation("activation:apply", (_event, profileId: unknown, previewId: unknown) =>
    activationService.applyProfile(parseId(profileId, "profile id"), String(previewId))
  );

  registerProfileComparisonIpc(handles, evaluationService);
};
