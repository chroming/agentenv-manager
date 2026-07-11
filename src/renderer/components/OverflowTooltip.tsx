import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

interface TooltipPosition {
  left: number;
  maxWidth: number;
  placement: "top" | "bottom";
  top: number;
}

interface OverflowTooltipProps {
  ariaLabel?: string;
  className: string;
  displayText?: string;
  text: string;
  tooltipClassName?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const OverflowTooltip = ({
  ariaLabel,
  className,
  displayText,
  text,
  tooltipClassName = ""
}: OverflowTooltipProps) => {
  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const maxWidth = Math.max(220, Math.min(420, window.innerWidth - 24));
    const measured = tooltipRef.current?.getBoundingClientRect();
    const width = Math.min(measured?.width ?? maxWidth, maxWidth);
    const height = measured?.height ?? 52;
    const gap = 8;
    const margin = 12;
    const preferredTop = triggerRect.bottom + gap;
    const placement =
      preferredTop + height <= window.innerHeight - margin ? "bottom" : "top";
    const unclampedTop =
      placement === "bottom" ? preferredTop : triggerRect.top - height - gap;
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    setPosition({
      left: clamp(triggerRect.left, margin, Math.max(margin, window.innerWidth - width - margin)),
      maxWidth,
      placement,
      top: clamp(unclampedTop, margin, maxTop)
    });
  }, []);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen, text, updatePosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  const tooltipStyle = {
    left: position?.left ?? -9999,
    maxWidth: position?.maxWidth ?? 420,
    top: position?.top ?? -9999
  } as CSSProperties;

  return (
    <>
      <span
        aria-label={ariaLabel}
        aria-describedby={isOpen ? tooltipId : undefined}
        className={className}
        ref={triggerRef}
        tabIndex={0}
        onBlur={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        {displayText ?? text}
      </span>
      {isOpen
        ? createPortal(
            <div
              className={`skill-description-tooltip skill-description-tooltip--${position?.placement ?? "bottom"}${tooltipClassName ? ` ${tooltipClassName}` : ""}`}
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={tooltipStyle}
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </>
  );
};
