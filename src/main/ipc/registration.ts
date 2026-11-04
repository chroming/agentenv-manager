import { SafeIdSchema } from "../../shared/schemas";

export type IpcHandler = (
  event: Electron.IpcMainInvokeEvent,
  ...args: any[]
) => any;

export type DiagnosticHandle = (channel: string, handler: IpcHandler) => void;
export type MutationScope = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => readonly string[] | undefined | Promise<readonly string[] | undefined>;
export type MutationHandle = (channel: string, handler: IpcHandler, scope?: MutationScope) => void;

export interface IpcRegistrationHandles {
  diagnosticHandle: DiagnosticHandle;
  handleMutation: MutationHandle;
  handleWorkspaceSyncMutation: MutationHandle;
}

export const parseId = (value: unknown, label: string): string => {
  const parsed = SafeIdSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${label}`);
  return parsed.data;
};
