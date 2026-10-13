import type { InputHTMLAttributes } from "react";

export interface ChoiceInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  type: "checkbox" | "radio";
  alignment?: "native" | "flush";
  indeterminate?: boolean;
}

export const ChoiceInput = ({ alignment = "native", className = "", indeterminate = false, ...props }: ChoiceInputProps) =>
  <input {...props} ref={(input) => { if (input) input.indeterminate = indeterminate; }}
    className={[className, alignment === "flush" ? "ui-choice-input--flush" : ""].filter(Boolean).join(" ")} />;
