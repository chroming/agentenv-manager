import { useCallback, useEffect, useRef, useState } from "react";

export interface PendingProfileAction {
  label: string;
}

type GuardedAction = () => void | Promise<void>;

interface WindowGuardApi {
  cancelWindowClose(): void;
  confirmWindowClose(): void;
  onWindowCloseRequested(callback: () => void): () => void;
  setWindowCloseGuard(enabled: boolean): void;
}

export const useProfileActionGuard = ({
  autoSaveDirty = false,
  dirty,
  onBusyChange,
  onDiscard,
  onError,
  onSave,
  windowGuardApi = window.agentEnv
}: {
  autoSaveDirty?: boolean;
  dirty: boolean;
  onBusyChange(busy: boolean): void;
  onDiscard(): Promise<void>;
  onError(error: string | undefined): void;
  onSave(): Promise<unknown>;
  windowGuardApi?: WindowGuardApi;
}) => {
  const actionRef = useRef<GuardedAction | null>(null);
  const pendingWindowCloseRef = useRef(false);
  const dirtyRef = useRef(dirty);
  const autoSaveDirtyRef = useRef(autoSaveDirty);
  const [pendingAction, setPendingAction] = useState<PendingProfileAction>();
  dirtyRef.current = dirty;
  autoSaveDirtyRef.current = autoSaveDirty;

  const guardAction = useCallback((label: string, action: GuardedAction) => {
    if (!dirtyRef.current) {
      if (!autoSaveDirtyRef.current) {
        void action();
        return;
      }
      void (async () => {
        onBusyChange(true);
        onError(undefined);
        try {
          await onSave();
          await action();
        } catch (unknownError) {
          onError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        } finally {
          onBusyChange(false);
        }
      })();
      return;
    }
    actionRef.current = action;
    setPendingAction({ label });
  }, [onBusyChange, onError, onSave]);

  const cancelPendingAction = useCallback(() => {
    if (pendingWindowCloseRef.current) {
      pendingWindowCloseRef.current = false;
      windowGuardApi.cancelWindowClose();
    }
    actionRef.current = null;
    setPendingAction(undefined);
  }, [windowGuardApi]);

  const continuePendingAction = useCallback(async (saveFirst: boolean) => {
    const action = actionRef.current;
    if (!action) {
      setPendingAction(undefined);
      return;
    }

    onBusyChange(true);
    onError(undefined);
    try {
      if (saveFirst) {
        await onSave();
      } else {
        await onDiscard();
      }
      actionRef.current = null;
      pendingWindowCloseRef.current = false;
      setPendingAction(undefined);
      await action();
    } catch (unknownError) {
      onError(
        unknownError instanceof Error ? unknownError.message : String(unknownError)
      );
    } finally {
      onBusyChange(false);
    }
  }, [onBusyChange, onDiscard, onError, onSave]);

  useEffect(() => {
    windowGuardApi.setWindowCloseGuard(dirty || autoSaveDirty);
  }, [autoSaveDirty, dirty, windowGuardApi]);

  useEffect(
    () =>
      windowGuardApi.onWindowCloseRequested(() => {
        if (!dirtyRef.current && !autoSaveDirtyRef.current) {
          windowGuardApi.confirmWindowClose();
          return;
        }
        if (!dirtyRef.current && autoSaveDirtyRef.current) {
          void (async () => {
            onBusyChange(true);
            onError(undefined);
            try {
              await onSave();
              windowGuardApi.confirmWindowClose();
            } catch (unknownError) {
              windowGuardApi.cancelWindowClose();
              onError(unknownError instanceof Error ? unknownError.message : String(unknownError));
            } finally {
              onBusyChange(false);
            }
          })();
          return;
        }
        pendingWindowCloseRef.current = true;
        actionRef.current = () => windowGuardApi.confirmWindowClose();
        setPendingAction({ label: "close AgentEnv Manager" });
      }),
    [onBusyChange, onError, onSave, windowGuardApi]
  );

  return {
    cancelPendingAction,
    continuePendingAction,
    guardAction,
    pendingAction
  };
};
