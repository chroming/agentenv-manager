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
  const restoringRef = useRef<
    { token: number; view: Exclude<ActiveLibraryView, undefined> } | undefined
  >(undefined);
  const liveScrollRef = useRef({ skills: 0, mcp: 0 });
  const lastRestoredViewRef = useRef<Exclude<ActiveLibraryView, undefined> | undefined>(
    undefined
  );
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  onScrollTopChangeRef.current = onScrollTopChange;

  const restore = useCallback(() => {
    if (!scrollOwner) {
      restorationTokenRef.current += 1;
      restoringRef.current = undefined;
      return undefined;
    }
    if (!activeView) {
      restorationTokenRef.current += 1;
      restoringRef.current = undefined;
      scrollOwner.scrollTop = 0;
      return undefined;
    }

    const token = ++restorationTokenRef.current;
    const requestedTop =
      lastRestoredViewRef.current === activeView
        ? liveScrollRef.current[activeView]
        : scrollTop;
    restoringRef.current = { token, view: activeView };
    const frame = requestAnimationFrame(() => {
      if (token !== restorationTokenRef.current) {
        return;
      }
      const restoredTop = clampLibraryScrollTop(
        requestedTop,
        scrollOwner.scrollHeight,
        scrollOwner.clientHeight
      );
      scrollOwner.scrollTop = restoredTop;
      liveScrollRef.current[activeView] = restoredTop;
      lastRestoredViewRef.current = activeView;
      restoringRef.current = undefined;
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
    const view = activeView;
    const handleScroll = () => {
      if (restoringRef.current?.view === view) {
        return;
      }
      liveScrollRef.current[view] = scrollOwner.scrollTop;
    };
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

  const captureScroll = useCallback(() => {
    if (scrollOwner && activeView) {
      const capturedTop =
        restoringRef.current?.view === activeView ? scrollTop : scrollOwner.scrollTop;
      liveScrollRef.current[activeView] = capturedTop;
      onScrollTopChangeRef.current(capturedTop);
    }
  }, [activeView, scrollOwner, scrollTop]);

  const resetScrollNow = useCallback(() => {
    restorationTokenRef.current += 1;
    restoringRef.current = undefined;
    if (scrollOwner) {
      scrollOwner.scrollTop = 0;
    }
    if (activeView) {
      liveScrollRef.current[activeView] = 0;
      lastRestoredViewRef.current = activeView;
      onScrollTopChangeRef.current(0);
    }
  }, [activeView, scrollOwner]);

  return { setScrollOwner, captureScroll, resetScrollNow };
};
