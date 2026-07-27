import {
  type CSSProperties,
  type ReactNode,
  type WheelEvent,
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
  hoverDelay?: number;
  id?: string;
  maxWidth?: number;
  popoverClassName?: string;
  preferredPlacement?: "top" | "bottom";
  showArrow?: boolean;
  showOnlyWhenOverflowing?: boolean;
  testId?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
const hoverDetailOpenEvent = "agentenv:hover-detail-open";
let activeHoverDetailId: string | undefined;

export const HoverDetail = ({
  align = "start",
  ariaLabel,
  children,
  className,
  content,
  focusable = true,
  hoverDelay = 160,
  id,
  maxWidth = 420,
  popoverClassName = "",
  preferredPlacement,
  showArrow = false,
  showOnlyWhenOverflowing = false,
  testId
}: HoverDetailProps) => {
  const popoverId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<HoverDetailPosition>();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const openTimerRef = useRef<number | undefined>(undefined);

  const cancelOpen = () => {
    if (openTimerRef.current !== undefined) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = undefined;
    }
  };

  const cancelClose = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };

  const close = useCallback(() => {
    cancelOpen();
    cancelClose();
    if (activeHoverDetailId === popoverId) {
      activeHoverDetailId = undefined;
    }
    setIsOpen(false);
  }, [popoverId]);

  const open = () => {
    const trigger = triggerRef.current;
    if (
      showOnlyWhenOverflowing &&
      trigger &&
      trigger.scrollWidth <= trigger.clientWidth + 1 &&
      trigger.scrollHeight <= trigger.clientHeight + 1
    ) {
      return;
    }
    cancelOpen();
    cancelClose();
    document.dispatchEvent(new CustomEvent(hoverDetailOpenEvent, { detail: popoverId }));
    activeHoverDetailId = popoverId;
    setIsOpen(true);
  };

  const scheduleOpen = () => {
    cancelOpen();
    if (activeHoverDetailId && activeHoverDetailId !== popoverId) {
      open();
      return;
    }
    openTimerRef.current = window.setTimeout(open, hoverDelay);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(close, 160);
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
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [close, isOpen, updatePosition]);

  useEffect(() => () => {
    cancelOpen();
    cancelClose();
    if (activeHoverDetailId === popoverId) {
      activeHoverDetailId = undefined;
    }
  }, [popoverId]);

  useEffect(() => {
    const closeForAnotherDetail = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== popoverId) close();
    };
    document.addEventListener(hoverDetailOpenEvent, closeForAnotherDetail);
    return () => document.removeEventListener(hoverDetailOpenEvent, closeForAnotherDetail);
  }, [close, popoverId]);

  const popoverStyle = {
    "--hover-detail-arrow-left": `${position?.arrowLeft ?? 24}px`,
    "--hover-detail-origin-x": `${position?.arrowLeft ?? 24}px`,
    left: position?.left ?? -9999,
    maxWidth: position?.maxWidth ?? maxWidth,
    top: position?.top ?? -9999
  } as CSSProperties;

  const forwardWheelToScrollOwner = (event: WheelEvent<HTMLDivElement>) => {
    const popover = popoverRef.current;
    if (!popover) return;
    const canScrollUp = popover.scrollTop > 0;
    const canScrollDown = popover.scrollTop + popover.clientHeight < popover.scrollHeight - 1;
    if ((event.deltaY < 0 && canScrollUp) || (event.deltaY > 0 && canScrollDown)) return;

    let scrollOwner = triggerRef.current?.parentElement;
    while (scrollOwner) {
      const style = window.getComputedStyle(scrollOwner);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        scrollOwner.scrollHeight > scrollOwner.clientHeight
      ) {
        event.preventDefault();
        scrollOwner.scrollBy({ top: event.deltaY, left: event.deltaX });
        close();
        return;
      }
      scrollOwner = scrollOwner.parentElement;
    }
  };

  return (
    <>
      <span
        aria-label={ariaLabel}
        aria-describedby={isOpen ? popoverId : undefined}
        className={className}
        data-testid={testId}
        data-ui-overflow-detail="true"
        id={id}
        ref={triggerRef}
        tabIndex={focusable ? 0 : undefined}
        onBlur={scheduleClose}
        onFocus={open}
        onMouseEnter={scheduleOpen}
        onMouseLeave={() => {
          cancelOpen();
          scheduleClose();
        }}
      >
        {children}
      </span>
      {isOpen
        ? createPortal(
            <div
              className={`ui-hover-detail ui-hover-detail--${position?.placement ?? "bottom"}${showArrow ? " ui-hover-detail--arrow" : ""}${popoverClassName ? ` ${popoverClassName}` : ""}`}
              data-ui-hover-detail="true"
              id={popoverId}
              ref={popoverRef}
              role="tooltip"
              style={popoverStyle}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
              onWheel={forwardWheelToScrollOwner}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  );
};
