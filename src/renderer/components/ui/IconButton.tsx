import { LoaderCircle } from "lucide-react";
import { forwardRef, useCallback, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ButtonSize, ButtonVariant } from "./Button";
import { useControlDensity } from "./controlDensity";
import { HoverDetail } from "../HoverDetail";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  active?: boolean;
  busy?: boolean;
  allowWhileBusy?: boolean;
  appearance?: "control" | "inline";
  label: string;
  size?: Exclude<ButtonSize, "prominent">;
  variant?: ButtonVariant;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      children,
      active = false,
      busy = false,
      allowWhileBusy = false,
      appearance = "control",
      className = "",
      label,
      size,
      title = label,
      type = "button",
      variant = appearance === "inline" ? "ghost" : "secondary",
      "aria-busy": ariaBusy,
      ...props
    },
    ref
  ) => {
    const inheritedSize = useControlDensity();
    const anchorRef = useRef<HTMLButtonElement>(null);
    const setRef = useCallback((node: HTMLButtonElement | null) => {
      anchorRef.current = node;
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    }, [ref]);
    const resolvedSize = inheritedSize ?? size ?? (appearance === "inline" ? "compact" : "default");
    const effectiveBusy = busy || ariaBusy === true || ariaBusy === "true";
    return (
      <HoverDetail
        className=""
        anchorRef={anchorRef}
        content={title || label}
        focusable={false}
        interactive={false}
        hoverDelay={300}
        maxWidth={320}
        align="center"
        preferredPlacement="top"
        renderTrigger={(tooltipProps) => <button
        {...props}
        {...tooltipProps}
        aria-describedby={[props["aria-describedby"], tooltipProps["aria-describedby"]].filter(Boolean).join(" ") || undefined}
        onFocus={(event) => { tooltipProps.onFocus?.(event); props.onFocus?.(event); }}
        onBlur={(event) => { tooltipProps.onBlur?.(event); props.onBlur?.(event); }}
        onMouseEnter={(event) => { tooltipProps.onMouseEnter?.(event); props.onMouseEnter?.(event); }}
        onMouseLeave={(event) => { tooltipProps.onMouseLeave?.(event); props.onMouseLeave?.(event); }}
        onPointerEnter={(event) => { tooltipProps.onPointerEnter?.(event); props.onPointerEnter?.(event); }}
        onPointerLeave={(event) => { tooltipProps.onPointerLeave?.(event); props.onPointerLeave?.(event); }}
        onPointerDown={(event) => { tooltipProps.onPointerDown?.(event); props.onPointerDown?.(event); }}
        onClick={(event) => { tooltipProps.onClick?.(event); props.onClick?.(event); }}
        ref={setRef}
        aria-busy={effectiveBusy}
        aria-label={label}
        className={`ui-icon-button ui-icon-button--${variant} ui-icon-button--${resolvedSize} ${active ? "ui-icon-button--active" : ""} ${appearance === "inline" ? "ui-icon-button--inline" : ""} ${className}`.trim()}
        disabled={props.disabled || (effectiveBusy && !allowWhileBusy)}
        type={type}
      >
        <span className="ui-icon-button__content">{children}</span>
        {effectiveBusy ? (
          <span className="ui-icon-button__busy" aria-hidden="true">
            <LoaderCircle className="is-spinning" />
          </span>
        ) : null}
      </button>}
      >{null}</HoverDetail>
    );
  }
);

IconButton.displayName = "IconButton";
