import type { ManagedResourceSnapshot } from "./types";

export type ManagedResourceMaterialization = NonNullable<
  ManagedResourceSnapshot["materialization"]
>;
export type ManagedResourceOrigin = NonNullable<ManagedResourceSnapshot["origin"]>;

export const managedResourceMaterialization = (
  resource: ManagedResourceSnapshot
): ManagedResourceMaterialization =>
  resource.materialization ?? (resource.deploymentMode === "linked" ? "link" : "copy");

export const managedResourceOrigin = (
  resource: ManagedResourceSnapshot
): ManagedResourceOrigin => {
  if (resource.origin) return resource.origin;
  if (resource.deploymentMode === "adopted" || resource.createdByAgentEnv === false) {
    return "adopted";
  }
  if (resource.createdByAgentEnv === true) return "created";
  return "unknown";
};

export const withManagedResourceSemantics = (
  resource: ManagedResourceSnapshot
): ManagedResourceSnapshot => ({
  ...resource,
  materialization: managedResourceMaterialization(resource),
  origin: managedResourceOrigin(resource)
});
