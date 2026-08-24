import { useCallback, useEffect, useState, type RefObject } from "react";
import type {
  SharedSkillAreaMode,
  SharedSkillAreaState,
  SkillInventoryEntry
} from "../../shared/types";
import { isSharedSkillInventoryEntry } from "../../shared/skillLocationSemantics";

interface SharedSkillAreaControllerOptions {
  active: boolean;
  inventory: SkillInventoryEntry[];
  historyRef: RefObject<HTMLElement | null>;
  readState(): Promise<SharedSkillAreaState>;
  setMode(mode: SharedSkillAreaMode): Promise<SharedSkillAreaState | undefined>;
}

export const useSharedSkillAreaController = ({
  active,
  inventory,
  historyRef,
  readState,
  setMode
}: SharedSkillAreaControllerOptions) => {
  const [state, setState] = useState<SharedSkillAreaState>();
  const [operation, setOperation] = useState<SharedSkillAreaMode>();

  useEffect(() => {
    if (!active) return;
    let current = true;
    void readState().then((nextState) => {
      if (current) setState(nextState);
    });
    return () => {
      current = false;
    };
  }, [active, readState]);

  const changeMode = useCallback(async (mode: SharedSkillAreaMode) => {
    if (operation) return undefined;
    setOperation(mode);
    try {
      const nextState = await setMode(mode);
      if (nextState) setState(nextState);
      return nextState;
    } finally {
      setOperation(undefined);
    }
  }, [operation, setMode]);

  const requestMode = useCallback(async ({
    mode,
    blocked,
    reviewRequired,
    onReview
  }: {
    mode: SharedSkillAreaMode;
    blocked: boolean;
    reviewRequired: boolean;
    onReview(): void;
  }) => {
    if (operation || blocked) return;
    if (reviewRequired) {
      onReview();
      return;
    }
    await changeMode(mode);
  }, [changeMode, operation]);

  const showRestorePoints = useCallback(() => {
    const history = historyRef.current;
    if (!history) return;
    history.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => {
      history
        .querySelector<HTMLButtonElement>('[data-cleanup-operation="retire"] button')
        ?.focus({ preventScroll: true });
    });
  }, [historyRef]);

  return {
    mode: state?.mode ?? inventory.find(isSharedSkillInventoryEntry)?.sharedAreaMode,
    operation,
    changeMode,
    requestMode,
    showRestorePoints
  };
};
