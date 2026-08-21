import { describe, expect, it, vi } from "vitest";
import { registerConversationIpc } from "../../src/main/ipc/conversationIpc";
import { registerProfileIpc } from "../../src/main/ipc/profileIpc";
import { registerProjectIpc } from "../../src/main/ipc/projectIpc";
import { registerRecoveryIpc } from "../../src/main/ipc/recoveryIpc";
import { registerSettingsIpc } from "../../src/main/ipc/settingsIpc";
import { registerTargetIpc } from "../../src/main/ipc/targetIpc";
import { registerRemoteDeviceIpc } from "../../src/main/ipc/remoteDeviceIpc";
import { registerDialogIpc } from "../../src/main/ipc/dialogIpc";
import type { IpcHandler, IpcRegistrationHandles } from "../../src/main/ipc/registration";

const service = () => new Proxy({}, {
  get: () => vi.fn()
}) as any;

const collectChannels = () => {
  const registrations: Array<{ channel: string; kind: string }> = [];
  const handlers = new Map<string, IpcHandler>();
  const handles: IpcRegistrationHandles = {
    diagnosticHandle: (channel, handler) => {
      registrations.push({ channel, kind: "diagnostic" });
      handlers.set(channel, handler);
    },
    handleMutation: (channel, handler) => {
      registrations.push({ channel, kind: "mutation" });
      handlers.set(channel, handler);
    },
    handleWorkspaceSyncMutation: (channel, handler) => {
      registrations.push({ channel, kind: "workspace" });
      handlers.set(channel, handler);
    }
  };
  return { handles, handlers, registrations };
};

const event = { sender: {} } as Electron.IpcMainInvokeEvent;

describe("domain IPC registrars", () => {
  it("keeps clipboard, conversation, and context-menu channels behind the diagnostic handle", () => {
    const { handles, registrations } = collectChannels();
    registerConversationIpc(handles, { conversationService: service() });

    expect(registrations).toContainEqual({ channel: "clipboard:write-text", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "conversations:search", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "conversations:continue", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "menu:open-context", kind: "diagnostic" });
  });

  it("keeps conversation search and continuation validation at the registrar boundary", async () => {
    const { handles, handlers } = collectChannels();
    const conversationService = {
      search: vi.fn().mockResolvedValue([]),
      previewContinuation: vi.fn()
    } as any;
    registerConversationIpc(handles, { conversationService });

    expect(() => handlers.get("conversations:search")!(event, undefined)).toThrow(
      "Conversation search requires a query"
    );
    await handlers.get("conversations:search")!(event, { query: "  needle  ", limit: 99 });
    expect(conversationService.search).toHaveBeenCalledWith({ query: "needle", limit: 20 });
    expect(() =>
      handlers.get("conversations:preview-continue")!(event, {
        conversationId: "conversation-1",
        targetId: "../invalid"
      })
    ).toThrow("Invalid target id");
  });

  it("keeps Project reads and mutations behind their existing shared handles", () => {
    const { handles, registrations } = collectChannels();
    registerProjectIpc(handles, {
      projectEnvironmentService: service(),
      projectLaunchService: service(),
      projectMutationService: service(),
      projectRecoveryStore: service(),
      projectStore: service(),
      targetDiscoveryService: {
        listTargets: vi.fn().mockResolvedValue([])
      } as any
    });

    expect(registrations).toContainEqual({ channel: "projects:inspect", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "projects:save-resource", kind: "mutation" });
    expect(registrations).toContainEqual({ channel: "projects:remove", kind: "mutation" });
  });

  it("keeps Project id and mutation schema validation at the registrar boundary", async () => {
    const { handles, handlers } = collectChannels();
    registerProjectIpc(handles, {
      projectEnvironmentService: service(),
      projectLaunchService: service(),
      projectMutationService: service(),
      projectRecoveryStore: service(),
      projectStore: service(),
      targetDiscoveryService: {
        listTargets: vi.fn().mockResolvedValue([])
      } as any
    });

    await expect(handlers.get("projects:inspect")!(event, "../invalid")).rejects.toThrow(
      "Invalid Project id"
    );
    expect(() => handlers.get("projects:update")!(event, {})).toThrow();
  });

  it("keeps settings, connection, update, and sync channels behind shared handles", () => {
    const { handles, registrations } = collectChannels();
    registerSettingsIpc(handles, {
      activationService: service(),
      appUpdateService: service(),
      githubAuthService: service(),
      mutationCoordinator: service(),
      settingsStore: service(),
      targetRegistry: service(),
      telemetryService: service(),
      uiStateStore: service(),
      workspaceSyncService: service()
    });

    expect(registrations).toContainEqual({ channel: "settings:update", kind: "mutation" });
    expect(registrations).toContainEqual({ channel: "github:start-device-login", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "workspace-sync:update", kind: "workspace" });
    expect(registrations).toContainEqual({ channel: "app-updates:install", kind: "diagnostic" });
  });

  it("keeps Profile, comparison, and Apply channels in one domain registrar", () => {
    const { handles, registrations } = collectChannels();
    registerProfileIpc(handles, {
      activationService: service(),
      evaluationService: service(),
      profileStore: service(),
      targetCaptureService: service()
    });

    expect(registrations).toContainEqual({ channel: "profiles:read", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "profiles:save", kind: "mutation" });
    expect(registrations).toContainEqual({ channel: "profile-comparisons:start", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "activation:apply", kind: "mutation" });
  });

  it("does not delete a Profile that is still active on an SSH endpoint", async () => {
    const { handles, handlers } = collectChannels();
    const profileStore = { deleteProfile: vi.fn() } as any;
    registerProfileIpc(handles, {
      activationService: {
        listTargetStates: vi.fn().mockResolvedValue([])
      } as any,
      remoteActivationService: {
        listTargetStates: vi.fn().mockResolvedValue([
          { targetId: "ssh:device:opencode", activeProfileId: "daily" }
        ])
      } as any,
      evaluationService: service(),
      profileStore,
      targetCaptureService: service()
    });

    await expect(handlers.get("profiles:delete")!(event, "daily")).rejects.toThrow(
      "Apply another profile"
    );
    expect(profileStore.deleteProfile).not.toHaveBeenCalled();
  });

  it("keeps recovery and data mutations behind the mutation handle", () => {
    const { handles, registrations } = collectChannels();
    registerRecoveryIpc(handles, {
      activationService: service(),
      backupMaintenanceService: service(),
      backupStore: service(),
      mutationCoordinator: service(),
      paths: service()
    });

    expect(registrations).toContainEqual({ channel: "backups:list", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "backups:delete-managed", kind: "mutation" });
    expect(registrations).toContainEqual({ channel: "data:create-backup", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "data:restore", kind: "mutation" });
  });

  it("keeps Target discovery and native resource inspection behind the diagnostic handle", () => {
    const { handles, registrations } = collectChannels();
    registerTargetIpc(handles, {
      activationService: service(),
      targetDiscoveryService: service(),
      targetRegistry: service()
    });

    expect(registrations).toContainEqual({ channel: "targets:list", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "targets:list-states", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "targets:list-native-mcps", kind: "diagnostic" });
    expect(registrations).toContainEqual({
      channel: "targets:list-native-instructions",
      kind: "diagnostic"
    });
  });

  it("registers SSH device and endpoint channels only when the remote capability is present", () => {
    const { handles, registrations } = collectChannels();
    registerRemoteDeviceIpc(handles, { remoteActivationService: service() });

    expect(registrations).toContainEqual({ channel: "remote-devices:list", kind: "diagnostic" });
    expect(registrations).toContainEqual({
      channel: "remote-devices:list-ssh-config-hosts",
      kind: "diagnostic"
    });
    expect(registrations).toContainEqual({
      channel: "remote-devices:resolve-ssh-config-host",
      kind: "diagnostic"
    });
    expect(registrations).toContainEqual({ channel: "remote-devices:add", kind: "mutation" });
    expect(registrations).toContainEqual({ channel: "remote-endpoints:list", kind: "diagnostic" });
    expect(registrations).toContainEqual({ channel: "remote-endpoints:list-states", kind: "diagnostic" });
  });

  it("keeps desktop pickers and temporary Skill archives in one dialog registrar", () => {
    const { handles, registrations } = collectChannels();
    registerDialogIpc(handles, { targetRegistry: service() });

    expect(registrations).toContainEqual({
      channel: "dialog:select-skill-folder",
      kind: "diagnostic"
    });
    expect(registrations).toContainEqual({
      channel: "dialog:select-project-folder",
      kind: "diagnostic"
    });
    expect(registrations).toContainEqual({
      channel: "skills:release-archive",
      kind: "diagnostic"
    });
  });
});
