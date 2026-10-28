export type SkillInvocationMode = "default" | "manual";

export const usesCodexSkillInvocation = (targetId: string | undefined) =>
  targetId === "codex" || /^ssh:[^:]+:codex$/.test(targetId ?? "");

export const supportsManualSkillInvocation = (targetId: string | undefined) =>
  usesCodexSkillInvocation(targetId) ||
  targetId === "claude-code" ||
  targetId === "workbuddy" ||
  /^ssh:[^:]+:claude-code$/.test(targetId ?? "");
