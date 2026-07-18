import type { TargetInfo } from "../shared/types";

export type TargetNameIndex = Readonly<Record<string, string>>;

export const createTargetNameIndex = (
  targets: readonly Pick<TargetInfo, "id" | "name">[]
): TargetNameIndex => Object.fromEntries(targets.map((target) => [target.id, target.name]));

export const targetNameFor = (
  targetId: string | undefined,
  targetNames: TargetNameIndex,
  fallback: string
): string => (targetId ? targetNames[targetId] ?? targetId : fallback);
