import type { InputHTMLAttributes } from "react";

export interface ChoiceInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  type: "checkbox" | "radio";
}

export const ChoiceInput = (props: ChoiceInputProps) => <input {...props} />;
