import { useCallback, useEffect, useRef, useState } from "react";
import {
  runGuardedProfileAction,
  type ProfileActionGuardOptions
} from "./profileActionGuardSupport";

export interface PendingProfileAction {
  label: string;
}

type GuardedAction = () => void | Promise<void>;

export const useProfileActionGuard = ({
  autoSaveDirty = false,
  dirty,
  onBusyChange,
  onDiscard,
  onError,
  onSave,
  windowGuardApi = window.agentEnv
}: ProfileActionGuardOptions) => {
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
      void runGuardedProfileAction({
        onBusyChange,
        onError,
        action: async () => {
          await onSave();
          await action();
        }
      });
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

    await runGuardedProfileAction({
      onBusyChange,
      onError,
      action: async () => {
        if (saveFirst) await onSave();
        else await onDiscard();
        actionRef.current = null;
        pendingWindowCloseRef.current = false;
        setPendingAction(undefined);
        await action();
      }
    });
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
          void runGuardedProfileAction({
            onBusyChange,
            onError,
            action: async () => {
              try {
                await onSave();
                windowGuardApi.confirmWindowClose();
              } catch (error) {
                windowGuardApi.cancelWindowClose();
                throw error;
              }
            }
          });
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
