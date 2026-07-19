import type { TargetHealth } from "./types";

export const isTargetInstalled = (
  health: Pick<TargetHealth, "installationFound" | "executableFound">
) => health.installationFound ?? health.executableFound;
