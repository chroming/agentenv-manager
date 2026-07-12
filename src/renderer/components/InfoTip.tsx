import { Info } from "lucide-react";
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

interface InfoTipProps {
  label: string;
}

interface TipPosition {
  arrowLeft: number;
  left: number;
  maxWidth: number;
  placement: "top" | "bottom";
  top: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
const tooltipOpenEvent = "agentenv:tooltip-open";

export const InfoTip = ({ label }: InfoTipProps) => {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TipPosition>();
  const closeTimerRef = useRef<number | undefined>(undefined);

  const cancelClose = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };

  const openTip = () => {
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
    const maxWidth = Math.max(180, Math.min(320, window.innerWidth - 24));
    const measured = bubbleRef.current?.getBoundingClientRect();
    const width = Math.min(measured?.width ?? maxWidth, maxWidth);
    const height = measured?.height ?? 44;
    const gap = 8;
    const margin = 12;
    const triggerCenter = triggerRect.left + triggerRect.width / 2;
    const preferredTop = triggerRect.top - height - gap;
    const placement = preferredTop >= margin ? "top" : "bottom";
    const unclampedTop =
      placement === "top" ? preferredTop : triggerRect.bottom + gap;
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const top = clamp(unclampedTop, margin, maxTop);
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const left = clamp(triggerCenter - width / 2, margin, maxLeft);

    setPosition({
      arrowLeft: clamp(triggerCenter - left, 12, width - 12),
      left,
      maxWidth,
      placement,
      top
    });
  }, []);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen, label, updatePosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", handleKeyDown);
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
    "--tip-arrow-left": `${position?.arrowLeft ?? 24}px`,
    left: position?.left ?? -9999,
    maxWidth: position?.maxWidth ?? 320,
    top: position?.top ?? -9999
  } as CSSProperties;

  return (
    <>
      <span
        className="info-tip"
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-label={label}
        onBlur={scheduleClose}
        onFocus={openTip}
        onMouseEnter={openTip}
        onMouseLeave={scheduleClose}
      >
        <Info size={14} strokeWidth={2.2} aria-hidden="true" />
      </span>
      {isOpen
        ? createPortal(
            <span
              className={`info-tip__bubble info-tip__bubble--portal info-tip__bubble--${position?.placement ?? "top"}`}
              id={tooltipId}
              ref={bubbleRef}
              role="tooltip"
              style={tooltipStyle}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </>
  );
};
