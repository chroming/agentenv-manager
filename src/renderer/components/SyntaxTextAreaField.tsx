import {
  forwardRef,
  useRef,
  type UIEvent
} from "react";
import { SyntaxCodePreview } from "./SyntaxCodePreview";
import { TextAreaField, type TextAreaFieldProps } from "./ui/FormFields";

interface SyntaxTextAreaFieldProps
  extends Omit<TextAreaFieldProps, "backdrop" | "backdropClassName" | "backdropRef"> {
  path: string;
}

export const SyntaxTextAreaField = forwardRef<HTMLTextAreaElement, SyntaxTextAreaFieldProps>(({
  className = "",
  fieldClassName = "",
  onScroll,
  path,
  value,
  ...props
}, ref) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  const code = typeof value === "string" ? value : "";

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (backdropRef.current) {
      backdropRef.current.scrollTop = event.currentTarget.scrollTop;
      backdropRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    onScroll?.(event);
  };

  return (
    <TextAreaField
      {...props}
      ref={ref}
      backdrop={<SyntaxCodePreview code={code || " "} path={path} />}
      backdropClassName="syntax-textarea-field__backdrop"
      backdropRef={backdropRef}
      className={`syntax-textarea-field__input ${className}`.trim()}
      fieldClassName={`syntax-textarea-field ${fieldClassName}`.trim()}
      value={value}
      onScroll={syncScroll}
    />
  );
});

SyntaxTextAreaField.displayName = "SyntaxTextAreaField";
