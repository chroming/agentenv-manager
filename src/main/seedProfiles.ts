import type { AgentEnvPaths } from "./paths";
import { createProfileStore } from "./profileStore";
import {
  createTargetRegistry,
  type TargetRegistry
} from "./targets/registry";

export const seedDefaultProfiles = async (
  paths: AgentEnvPaths,
  targetRegistry: TargetRegistry = createTargetRegistry()
) => {
  const profileStore = createProfileStore({
    appDataRoot: paths.appDataRoot,
    homeDir: paths.homeDir,
    fakeHomeRoot: paths.fakeHomeRoot
  }, targetRegistry);
  if ((await profileStore.listProfiles()).some((profile) => !profile.loadError)) {
    return;
  }

  const adapter = targetRegistry
    .listAdapters()
    .find((candidate) => candidate.descriptor.defaultProfileId);
  if (!adapter?.descriptor.defaultProfileId) {
    return;
  }
  const profile = adapter.createDefaultProfile(adapter.descriptor.defaultProfileId);
  profile.manifest.createdAt = new Date().toISOString();
  await profileStore.saveProfile(profile);
};
