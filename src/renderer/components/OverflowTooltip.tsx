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
  focusable?: boolean;
  preferredPlacement?: "top" | "bottom";
  text: string;
  tooltipClassName?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
const tooltipOpenEvent = "agentenv:tooltip-open";

export const OverflowTooltip = ({
  ariaLabel,
  className,
  displayText,
  focusable = true,
  preferredPlacement,
  text,
  tooltipClassName = ""
}: OverflowTooltipProps) => {
  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const cancelClose = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };

  const openTooltip = () => {
    cancelClose();
    document.dispatchEvent(new CustomEvent(tooltipOpenEvent, { detail: tooltipId }));
    setIsOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 160);
  };

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
    const bottomTop = triggerRect.bottom + gap;
    const topTop = triggerRect.top - height - gap;
    const bottomFits = bottomTop + height <= window.innerHeight - margin;
    const topFits = topTop >= margin;
    const placement = preferredPlacement === "top"
      ? topFits ? "top" : "bottom"
      : preferredPlacement === "bottom"
        ? bottomFits ? "bottom" : "top"
        : bottomFits ? "bottom" : "top";
    const unclampedTop =
      placement === "bottom" ? bottomTop : topTop;
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    setPosition({
      left: clamp(triggerRect.left, margin, Math.max(margin, window.innerWidth - width - margin)),
      maxWidth,
      placement,
      top: clamp(unclampedTop, margin, maxTop)
    });
  }, [preferredPlacement]);

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

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    const closeForAnotherTooltip = (event: Event) => {
      if ((event as CustomEvent<string>).detail === tooltipId) return;
      cancelClose();
      setIsOpen(false);
    };
    document.addEventListener(tooltipOpenEvent, closeForAnotherTooltip);
    return () => document.removeEventListener(tooltipOpenEvent, closeForAnotherTooltip);
  }, [tooltipId]);

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
        tabIndex={focusable ? 0 : undefined}
        onBlur={scheduleClose}
        onFocus={openTooltip}
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleClose}
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
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </>
  );
};
