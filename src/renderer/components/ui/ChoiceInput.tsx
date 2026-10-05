import type { InputHTMLAttributes } from "react";

export interface ChoiceInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  type: "checkbox" | "radio";
  alignment?: "native" | "flush";
}

export const ChoiceInput = ({ alignment = "native", className = "", ...props }: ChoiceInputProps) =>
  <input {...props} className={[className, alignment === "flush" ? "ui-choice-input--flush" : ""].filter(Boolean).join(" ")} />;
