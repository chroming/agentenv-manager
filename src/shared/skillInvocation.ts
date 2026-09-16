export type SkillInvocationMode = "default" | "manual";

export const supportsManualSkillInvocation = (targetId: string | undefined) =>
  targetId === "claude-code" || /^ssh:[^:]+:claude-code$/.test(targetId ?? "");
