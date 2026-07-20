import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

interface HoverDetailPosition {
  arrowLeft: number;
  left: number;
  maxWidth: number;
  placement: "top" | "bottom";
  top: number;
}

interface HoverDetailProps {
  align?: "start" | "center";
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  content: ReactNode;
  focusable?: boolean;
  maxWidth?: number;
  popoverClassName?: string;
  preferredPlacement?: "top" | "bottom";
  showArrow?: boolean;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
const hoverDetailOpenEvent = "agentenv:hover-detail-open";

export const HoverDetail = ({
  align = "start",
  ariaLabel,
  children,
  className,
  content,
  focusable = true,
  maxWidth = 420,
  popoverClassName = "",
  preferredPlacement,
  showArrow = false
}: HoverDetailProps) => {
  const popoverId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<HoverDetailPosition>();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const cancelClose = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };

  const close = useCallback(() => {
    cancelClose();
    setIsOpen(false);
  }, []);

  const open = () => {
    cancelClose();
    document.dispatchEvent(new CustomEvent(hoverDetailOpenEvent, { detail: popoverId }));
    setIsOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 160);
  };

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const availableMaxWidth = Math.max(220, Math.min(maxWidth, window.innerWidth - 24));
    const measured = popoverRef.current?.getBoundingClientRect();
    const width = Math.min(measured?.width ?? availableMaxWidth, availableMaxWidth);
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
    const triggerAnchor = align === "center"
      ? triggerRect.left + triggerRect.width / 2
      : triggerRect.left;
    const unclampedLeft = align === "center" ? triggerAnchor - width / 2 : triggerAnchor;
    const left = clamp(
      unclampedLeft,
      margin,
      Math.max(margin, window.innerWidth - width - margin)
    );
    const unclampedTop = placement === "bottom" ? bottomTop : topTop;
    const top = clamp(
      unclampedTop,
      margin,
      Math.max(margin, window.innerHeight - height - margin)
    );

    setPosition({
      arrowLeft: clamp(triggerRect.left + triggerRect.width / 2 - left, 12, width - 12),
      left,
      maxWidth: availableMaxWidth,
      placement,
      top
    });
  }, [align, maxWidth, preferredPlacement]);

  useLayoutEffect(() => {
    if (isOpen) updatePosition();
  }, [content, isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, isOpen, updatePosition]);

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    const closeForAnotherDetail = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== popoverId) close();
    };
    document.addEventListener(hoverDetailOpenEvent, closeForAnotherDetail);
    return () => document.removeEventListener(hoverDetailOpenEvent, closeForAnotherDetail);
  }, [close, popoverId]);

  const popoverStyle = {
    "--hover-detail-arrow-left": `${position?.arrowLeft ?? 24}px`,
    left: position?.left ?? -9999,
    maxWidth: position?.maxWidth ?? maxWidth,
    top: position?.top ?? -9999
  } as CSSProperties;

  return (
    <>
      <span
        aria-label={ariaLabel}
        aria-describedby={isOpen ? popoverId : undefined}
        className={className}
        ref={triggerRef}
        tabIndex={focusable ? 0 : undefined}
        onBlur={scheduleClose}
        onFocus={open}
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
      >
        {children}
      </span>
      {isOpen
        ? createPortal(
            <div
              className={`ui-hover-detail ui-hover-detail--${position?.placement ?? "bottom"}${showArrow ? " ui-hover-detail--arrow" : ""}${popoverClassName ? ` ${popoverClassName}` : ""}`}
              id={popoverId}
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  );
};
