import type { ToolbarOverflowMenuItem } from "./ui/ToolbarOverflowMenu";
import { supportsManualSkillInvocation, type SkillInvocationMode } from "../../shared/skillInvocation";

export const skillInvocationMenuItems = (input: {
  mode?: SkillInvocationMode;
  targetId?: string;
  t(key: string): string;
  onChange(mode: SkillInvocationMode): void;
}): ToolbarOverflowMenuItem[] => [
  {
    id: "invocation-default", label: input.t("Default invocation"),
    title: input.t("Keep the Skill author's invocation behavior"),
    checked: input.mode !== "manual", onSelect: () => input.onChange("default")
  },
  {
    id: "invocation-manual", label: input.t("Manual only"), checked: input.mode === "manual",
    disabled: !supportsManualSkillInvocation(input.targetId),
    title: input.t(supportsManualSkillInvocation(input.targetId)
      ? "Invoke explicitly with /skill-name. Applied as a managed copy."
      : "Manual-only invocation is not supported by this Agent"),
    onSelect: () => input.onChange("manual")
  }
];
