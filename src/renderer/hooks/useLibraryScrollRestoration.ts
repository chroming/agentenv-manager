import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type ActiveLibraryView = "skills" | "mcp" | undefined;

interface LibraryScrollRestorationOptions {
  activeView: ActiveLibraryView;
  scrollTop: number;
  restoreKey: unknown;
  onScrollTopChange(scrollTop: number): void;
}

export const clampLibraryScrollTop = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
) => Math.min(Math.max(0, scrollTop), Math.max(0, scrollHeight - clientHeight));

export const useLibraryScrollRestoration = ({
  activeView,
  scrollTop,
  restoreKey,
  onScrollTopChange
}: LibraryScrollRestorationOptions) => {
  const [scrollOwner, setScrollOwner] = useState<HTMLElement | null>(null);
  const restorationTokenRef = useRef(0);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  onScrollTopChangeRef.current = onScrollTopChange;

  const restore = useCallback(() => {
    if (!scrollOwner) {
      restorationTokenRef.current += 1;
      return undefined;
    }
    if (!activeView) {
      restorationTokenRef.current += 1;
      scrollOwner.scrollTop = 0;
      return undefined;
    }

    const token = ++restorationTokenRef.current;
    const frame = requestAnimationFrame(() => {
      if (token !== restorationTokenRef.current) {
        return;
      }
      scrollOwner.scrollTop = clampLibraryScrollTop(
        scrollTop,
        scrollOwner.scrollHeight,
        scrollOwner.clientHeight
      );
    });

    return () => {
      restorationTokenRef.current += 1;
      cancelAnimationFrame(frame);
    };
  }, [activeView, scrollOwner, scrollTop]);

  useLayoutEffect(restore, [restore, restoreKey]);

  useEffect(() => {
    if (!scrollOwner || !activeView) {
      return undefined;
    }
    const handleScroll = () => onScrollTopChangeRef.current(scrollOwner.scrollTop);
    scrollOwner.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollOwner.removeEventListener("scroll", handleScroll);
  }, [activeView, scrollOwner]);

  useEffect(() => {
    if (!activeView) {
      return undefined;
    }
    const handleResize = () => {
      restore();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeView, restore]);

  return setScrollOwner;
};
