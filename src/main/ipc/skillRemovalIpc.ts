import { SafeIdSchema } from "../../shared/schemas";
import type { ProfileStore } from "../profileStore";
import { readAllProfilesForResourceMutation } from "../profileSafety";
import type { SkillGroupStore } from "../skillGroupStore";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { TargetDiscoveryService } from "../targetDiscovery";
import type { IpcRegistrationHandles } from "./registration";

const parseSkillId = (value: unknown) => {
  const parsed = SafeIdSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid skill id");
  return parsed.data;
};

export const registerSkillRemovalIpc = (
  { handleMutation }: Pick<IpcRegistrationHandles, "handleMutation">,
  services: {
    profileStore: ProfileStore;
    skillGroupStore: SkillGroupStore;
    skillLibraryStore: SkillLibraryStore;
    targetDiscoveryService: TargetDiscoveryService;
  }
) => {
  handleMutation("skills:remove-library", async (_event, id: unknown) => {
    const skillId = parseSkillId(id);
    const profiles = await readAllProfilesForResourceMutation(services.profileStore, "Skill removal");
    const profileReferences = profiles
      .filter((profile) => profile.resources.skills.some((reference) => reference.libraryId === skillId))
      .map((profile) => profile.manifest.name);
    if (profileReferences.length > 0) {
      throw new Error(
        `Library skill ${skillId} is used by ${profileReferences.join(", ")}. Remove it from those profiles first.`
      );
    }
    const groupReferences = (await services.skillGroupStore.list())
      .filter((group) => group.skillIds.includes(skillId))
      .map((group) => group.name);
    if (groupReferences.length > 0) {
      throw new Error(
        `Library skill ${skillId} is used by Skill Groups ${groupReferences.join(", ")}. Remove it from those groups first.`
      );
    }
    const targets = await services.targetDiscoveryService.listTargets();
    const managedInstallPaths = await services.skillLibraryStore.findManagedInstallPaths(
      skillId,
      targets.map((target) => target.paths)
    );
    return services.skillLibraryStore.removeSkill(skillId, managedInstallPaths);
  });
};
