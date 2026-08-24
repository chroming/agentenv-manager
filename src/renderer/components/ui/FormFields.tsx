import {
  forwardRef,
  useId,
  type Ref,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";

interface FieldFrameProps {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  error?: ReactNode;
  htmlFor: string;
  label: ReactNode;
  labelHidden?: boolean;
}

const FieldFrame = ({
  children,
  className = "",
  description,
  error,
  htmlFor,
  label,
  labelHidden = false
}: FieldFrameProps) => (
  <label className={`ui-field ${className}`.trim()} htmlFor={htmlFor}>
    <span className={`ui-field__label${labelHidden ? " ui-visually-hidden" : ""}`}>{label}</span>
    {children}
    {description ? <span className="ui-field__description">{description}</span> : null}
    {error ? <span className="ui-field__error" role="alert">{error}</span> : null}
  </label>
);

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  description?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  label: ReactNode;
  labelHidden?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(({
  className = "",
  description,
  error,
  fieldClassName,
  id,
  label,
  labelHidden,
  ...props
}, ref) => {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldFrame className={fieldClassName} description={description} error={error} htmlFor={fieldId} label={label} labelHidden={labelHidden}>
      <input ref={ref} {...props} aria-invalid={error ? true : props["aria-invalid"]} className={className} id={fieldId} />
    </FieldFrame>
  );
});

TextField.displayName = "TextField";

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  fieldClassName?: string;
  icon?: ReactNode;
  label: ReactNode;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(({
  className = "",
  fieldClassName = "",
  icon,
  id,
  label,
  ...props
}, ref) => {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <label className={`ui-search-field ${fieldClassName}`.trim()} htmlFor={fieldId}>
      {icon ? <span className="ui-search-field__icon" aria-hidden="true">{icon}</span> : null}
      <input
        ref={ref}
        {...props}
        aria-label={typeof label === "string" ? label : undefined}
        className={className}
        id={fieldId}
        type="search"
      />
      {typeof label === "string" ? null : <span className="ui-visually-hidden">{label}</span>}
    </label>
  );
});

SearchField.displayName = "SearchField";

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  controlWidth?: SelectControlWidth;
  description?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  label: ReactNode;
  labelHidden?: boolean;
}

export type SelectControlWidth = "compact" | "standard" | "wide" | "fill";

interface SelectControlProps extends SelectHTMLAttributes<HTMLSelectElement> {
  controlWidth?: SelectControlWidth;
}

export const SelectControl = forwardRef<HTMLSelectElement, SelectControlProps>(({
  children,
  className = "",
  controlWidth = "fill",
  ...props
}, ref) => (
  <select
    ref={ref}
    {...props}
    className={`ui-select-control ui-select-control--${controlWidth} ${className}`.trim()}
  >
    {children}
  </select>
));

SelectControl.displayName = "SelectControl";

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(({
  children,
  className = "",
  controlWidth,
  description,
  error,
  fieldClassName,
  id,
  label,
  labelHidden,
  ...props
}: SelectFieldProps, ref) => {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldFrame className={fieldClassName} description={description} error={error} htmlFor={fieldId} label={label} labelHidden={labelHidden}>
      <SelectControl ref={ref} {...props} aria-invalid={error ? true : props["aria-invalid"]} className={className} controlWidth={controlWidth} id={fieldId}>
        {children}
      </SelectControl>
    </FieldFrame>
  );
});

SelectField.displayName = "SelectField";

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  backdrop?: ReactNode;
  backdropClassName?: string;
  backdropRef?: Ref<HTMLDivElement>;
  description?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  label: ReactNode;
  labelHidden?: boolean;
}

export const TextAreaField = forwardRef<
  HTMLTextAreaElement,
  TextAreaFieldProps
>(({
  backdrop,
  backdropClassName = "",
  backdropRef,
  className = "",
  description,
  error,
  fieldClassName,
  id,
  label,
  labelHidden,
  ...props
}: TextAreaFieldProps, ref) => {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldFrame className={fieldClassName} description={description} error={error} htmlFor={fieldId} label={label} labelHidden={labelHidden}>
      {backdrop ? (
        <div className="ui-textarea-stack">
          <div
            ref={backdropRef}
            aria-hidden="true"
            className={`ui-textarea-stack__backdrop ${backdropClassName}`.trim()}
          >
            {backdrop}
          </div>
          <textarea ref={ref} {...props} aria-invalid={error ? true : props["aria-invalid"]} className={className} id={fieldId} />
        </div>
      ) : (
        <textarea ref={ref} {...props} aria-invalid={error ? true : props["aria-invalid"]} className={className} id={fieldId} />
      )}
    </FieldFrame>
  );
});

TextAreaField.displayName = "TextAreaField";
