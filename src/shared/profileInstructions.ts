import type { ProfileDetail } from "./types";

export const normalizeInstructionContent = (content: string): string =>
  content.replaceAll("\r\n", "\n").replace(/[\t ]+$/gm, "").trim();

export const joinInstructionContents = (contents: readonly string[]): string => {
  const normalized = contents.map(normalizeInstructionContent).filter(Boolean);
  return normalized.length > 0 ? `${normalized.join("\n\n")}\n` : "";
};

export const profileEffectiveInstructions = (
  profile: Pick<ProfileDetail, "instructions" | "resolvedInstructions">
): string => profile.resolvedInstructions ?? profile.instructions;
