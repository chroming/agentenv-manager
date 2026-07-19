import type { ProfileDetail } from "../shared/types";
import type { ProfileStore } from "./profileStore";

export const readAllProfilesForResourceMutation = async (
  profileStore: Pick<ProfileStore, "listProfiles" | "readProfile">,
  operation: string
): Promise<ProfileDetail[]> => {
  const summaries = await profileStore.listProfiles();
  const damaged = summaries.filter((profile) => profile.loadError);
  if (damaged.length > 0) {
    throw new Error(
      `${operation} is blocked until damaged Profile data is repaired: ${damaged
        .map((profile) => profile.name)
        .join(", ")}`
    );
  }
  return Promise.all(summaries.map((profile) => profileStore.readProfile(profile.id)));
};
