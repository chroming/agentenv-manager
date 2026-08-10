import { shell } from "electron";
import type { ActivationService } from "../activationService";
import type { AppUpdateService } from "../appUpdates/updateService";
import { parseExternalUrl } from "../externalUrl";
import type { GitHubAuthService } from "../githubAuthService";
import type { MutationCoordinator } from "../mutationCoordinator";
import type { SettingsStore } from "../settingsStore";
import type { TargetRegistry } from "../targets/registry";
import type { TelemetryService } from "../telemetry/telemetryService";
import type { WorkspaceSyncService } from "../workspaceSync/workspaceSyncService";
import type { UiStateStore } from "../uiStateStore";
import type { IpcRegistrationHandles } from "./registration";

interface SettingsIpcServices {
  activationService: ActivationService;
  appUpdateService: AppUpdateService;
  githubAuthService: GitHubAuthService;
  mutationCoordinator: MutationCoordinator;
  settingsStore: SettingsStore;
  targetRegistry: TargetRegistry;
  telemetryService: TelemetryService;
  workspaceSyncService: WorkspaceSyncService;
  uiStateStore: UiStateStore;
}

export const registerSettingsIpc = (
  handles: IpcRegistrationHandles,
  services: SettingsIpcServices
) => {
  const { diagnosticHandle, handleMutation, handleWorkspaceSyncMutation } = handles;
  const {
    activationService,
    appUpdateService,
    githubAuthService,
    mutationCoordinator,
    settingsStore,
    targetRegistry,
    telemetryService,
    uiStateStore,
    workspaceSyncService
  } = services;

  handleMutation("settings:read", () => settingsStore.readSettings());
  handleMutation("settings:update", async (_event, input: unknown) => {
    const nextInput = input && typeof input === "object"
      ? input as Partial<import("../../shared/types").AgentEnvSettings>
      : {};
    if (nextInput.targetConfigRoots) {
      const current = await settingsStore.readSettings();
      const changedTargetIds = new Set([
        ...Object.keys(current.targetConfigRoots ?? {}),
        ...Object.keys(nextInput.targetConfigRoots)
      ].filter((targetId) =>
        current.targetConfigRoots?.[targetId] !== nextInput.targetConfigRoots?.[targetId]
      ));
      if (changedTargetIds.size > 0) {
        const managed = (await activationService.listTargetStates({ includeDisabled: true })).find(
          (state) => changedTargetIds.has(state.targetId) && state.lifecycleStatus !== "unmanaged"
        );
        if (managed) {
          throw new Error(
            `Stop managing ${targetRegistry.get(managed.targetId).descriptor.name} before changing its configuration folder`
          );
        }
      }
    }
    return settingsStore.updateSettings(nextInput);
  });
  diagnosticHandle("ui-state:read", () => uiStateStore.read());
  diagnosticHandle("ui-state:update", (_event, input: unknown) =>
    uiStateStore.update(
      input && typeof input === "object"
        ? input as import("../../shared/uiState").UiStateUpdate
        : {}
    )
  );

  diagnosticHandle("app-updates:status", () => appUpdateService.readStatus());
  diagnosticHandle("app-updates:check", () => appUpdateService.check({ manual: true }));
  diagnosticHandle("app-updates:download", () => appUpdateService.download());
  diagnosticHandle("app-updates:install", () =>
    mutationCoordinator.runExclusive("Install AgentEnv update", () =>
      appUpdateService.install({ restart: true })
    )
  );
  diagnosticHandle("telemetry:preview", () => telemetryService.preview());

  diagnosticHandle("workspace-sync:status", () => workspaceSyncService.readStatus());
  handleWorkspaceSyncMutation("workspace-sync:connect", (_event, input: unknown) =>
    workspaceSyncService.connect(input as import("../../shared/workspaceSync").WorkspaceSyncConnectInput)
  );
  diagnosticHandle("workspace-sync:check", () => workspaceSyncService.check());
  diagnosticHandle("workspace-sync:review", () => workspaceSyncService.review());
  handleWorkspaceSyncMutation("workspace-sync:update", (_event, input: unknown) =>
    workspaceSyncService.update(input as import("../../shared/workspaceSync").WorkspaceSyncUpdateInput)
  );
  handleWorkspaceSyncMutation("workspace-sync:publish", () => workspaceSyncService.publish());
  handleWorkspaceSyncMutation("workspace-sync:recover", () => workspaceSyncService.recover());
  handleWorkspaceSyncMutation("workspace-sync:disconnect", () => workspaceSyncService.disconnect());

  handleMutation("github:status", () => githubAuthService.readStatus());
  diagnosticHandle("github:start-device-login", () => githubAuthService.startDeviceLogin());
  handleMutation("github:poll-device-login", (_event, id: unknown) =>
    githubAuthService.pollDeviceLogin(String(id))
  );
  handleMutation("github:sign-out", () => githubAuthService.signOut());
  diagnosticHandle("github:open-device-page", (_event, url: unknown) =>
    shell.openExternal(parseExternalUrl(url))
  );
  diagnosticHandle("external:open-url", (_event, url: unknown) =>
    shell.openExternal(parseExternalUrl(url))
  );
};
