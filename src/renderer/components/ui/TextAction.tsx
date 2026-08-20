import { forwardRef, type ButtonHTMLAttributes } from "react";

export const TextAction = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(({ className = "", type = "button", ...props }, ref) => (
  <button
    {...props}
    ref={ref}
    className={`ui-text-action ${className}`.trim()}
    type={type}
  />
));

TextAction.displayName = "TextAction";
