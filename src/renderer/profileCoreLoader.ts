import type {
  AgentEnvSettings,
  ProfileSummary,
  SkillLibraryEntry,
  TargetDescriptor,
  TargetInfo,
  TargetManagementState,
  UiState
} from "../shared/types";
import { defaultUiState, orderByPreference } from "../shared/uiState";
import { compareProfilesByCreationTime } from "./profileSummary";

export interface ProfileCoreData {
  supportedTargetItems: TargetDescriptor[];
  targetItems: TargetInfo[];
  targetStateItems: TargetManagementState[];
  profileItems: ProfileSummary[];
  skillItems: SkillLibraryEntry[];
  settings: AgentEnvSettings;
  uiState: UiState;
}

export const loadProfileCoreData = async ({
  forceTargetRefresh,
  settingsOverride,
  onSkillsLoaded
}: {
  forceTargetRefresh: boolean;
  settingsOverride?: AgentEnvSettings;
  onSkillsLoaded(items: SkillLibraryEntry[]): void;
}): Promise<ProfileCoreData> => {
  const skillItemsPromise = window.agentEnv.listSkillLibrary();
  void skillItemsPromise.then(onSkillsLoaded);
  const [supportedTargets, targets, targetStateItems, profiles, skillItems, settings, uiState] =
    await Promise.all([
      window.agentEnv.listSupportedTargets(),
      window.agentEnv.listTargets(forceTargetRefresh),
      window.agentEnv.listTargetStates(),
      window.agentEnv.listProfiles(),
      skillItemsPromise,
      settingsOverride ?? window.agentEnv.readSettings(),
      window.agentEnv.readUiState?.() ?? Promise.resolve(defaultUiState())
    ]);
  return {
    supportedTargetItems: orderByPreference(supportedTargets, uiState.agentOrder, (item) => item.id),
    targetItems: orderByPreference(targets, uiState.agentOrder, (item) => item.id),
    targetStateItems,
    profileItems: orderByPreference(
      [...profiles].sort(compareProfilesByCreationTime),
      uiState.profileOrder,
      (item) => item.id
    ),
    skillItems,
    settings,
    uiState
  };
};
