export interface WindowGuardApi {
  cancelWindowClose(): void;
  confirmWindowClose(): void;
  onWindowCloseRequested(callback: () => void): () => void;
  setWindowCloseGuard(enabled: boolean): void;
}

export interface ProfileActionGuardOptions {
  autoSaveDirty?: boolean;
  dirty: boolean;
  onBusyChange(busy: boolean): void;
  onDiscard(): Promise<void>;
  onError(error: string | undefined): void;
  onSave(): Promise<unknown>;
  windowGuardApi?: WindowGuardApi;
}

interface GuardedProfileActionOptions {
  action(): Promise<void>;
  onBusyChange(busy: boolean): void;
  onError(error: string | undefined): void;
}

export const runGuardedProfileAction = async ({
  action,
  onBusyChange,
  onError
}: GuardedProfileActionOptions) => {
  onBusyChange(true);
  onError(undefined);
  try {
    await action();
  } catch (unknownError) {
    onError(unknownError instanceof Error ? unknownError.message : String(unknownError));
  } finally {
    onBusyChange(false);
  }
};
