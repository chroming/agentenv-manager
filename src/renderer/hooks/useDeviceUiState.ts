import { useCallback, useRef, useState } from "react";
import type { UiState, UiStateUpdate } from "../../shared/types";
import { defaultUiState } from "../../shared/uiState";
import { mergeCatalogViews } from "../../shared/catalogViews";

export const useDeviceUiState = (onError: (error: string) => void) => {
  const [uiState, setUiState] = useState<UiState>(defaultUiState);
  const stateRef = useRef<UiState>(defaultUiState());

  const acceptUiState = useCallback((next: UiState) => {
    stateRef.current = next;
    setUiState(next);
  }, []);

  const persistUiState = useCallback((update: UiStateUpdate) => {
    acceptUiState({ ...stateRef.current, ...update, version: 1,
      ...(update.catalogViews ? { catalogViews: mergeCatalogViews(stateRef.current.catalogViews, update.catalogViews) } : {}) });
    void window.agentEnv.updateUiState?.(update).catch((unknownError) => {
      onError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    });
  }, [acceptUiState, onError]);

  return {
    acceptUiState,
    currentUiState: () => stateRef.current,
    persistUiState,
    uiState
  };
};
