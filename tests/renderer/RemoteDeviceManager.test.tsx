// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteDeviceManager,
  type RemoteDeviceManagerHandle
} from "../../src/renderer/components/RemoteDeviceManager";

afterEach(cleanup);

const device = {
  id: "93cf2229-0e22-4d10-8b7f-5600b71f4a44",
  name: "Build server",
  host: "build.internal",
  user: "agent",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z"
};

const sshConfigProps = () => ({
  onListSshConfigHosts: vi.fn().mockResolvedValue([]),
  onResolveSshConfigHost: vi.fn()
});

const workspaceProps = () => ({
  remoteTargets: [],
  targetStates: [],
  busyDeviceIds: [],
  onRefreshDevice: vi.fn().mockResolvedValue(undefined),
  onOpenProfile: vi.fn()
});

const openAddDialog = (ref: RefObject<RemoteDeviceManagerHandle | null>) => {
  act(() => ref.current?.openAdd(document.body));
};

describe("RemoteDeviceManager", () => {
  it("uses the shared form dialog and never asks for a password or private key", async () => {
    const ref = createRef<RemoteDeviceManagerHandle>();
    render(
      <RemoteDeviceManager
        ref={ref}
        {...sshConfigProps()}
        {...workspaceProps()}
        devices={[]}
        endpoints={[]}
        probes={[]}
        busy={false}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    openAddDialog(ref);
    const dialog = screen.getByRole("dialog", { name: "Add SSH device" });
    expect(dialog).toHaveTextContent("system OpenSSH");
    expect(screen.getByLabelText("Device name")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("SSH host")).toBeInTheDocument());
    expect(dialog).not.toHaveTextContent(/password field|private key path/i);
  });

  it("selects a named SSH config host without copying resolved connection fields", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const ref = createRef<RemoteDeviceManagerHandle>();
    render(
      <RemoteDeviceManager
        ref={ref}
        {...workspaceProps()}
        devices={[]}
        endpoints={[]}
        probes={[]}
        busy={false}
        onListSshConfigHosts={vi.fn().mockResolvedValue([{ alias: "build-prod" }])}
        onResolveSshConfigHost={vi.fn().mockResolvedValue({
          alias: "build-prod",
          hostName: "10.0.0.12",
          user: "deploy",
          port: 2202
        })}
        onAdd={onAdd}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    openAddDialog(ref);
    const dialog = screen.getByRole("dialog", { name: "Add SSH device" });
    const hostPicker = await within(dialog).findByRole("combobox", { name: "SSH config host" });
    fireEvent.change(hostPicker, { target: { value: "build-prod" } });

    await waitFor(() => expect(dialog).toHaveTextContent("deploy@10.0.0.12:2202"));
    expect(within(dialog).getByLabelText("Device name")).toHaveValue("build-prod");
    expect(within(dialog).queryByLabelText("SSH host")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add device" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({
      name: "build-prod",
      host: "build-prod"
    }));
  });

  it("falls back to manual connection fields when SSH config cannot be read", async () => {
    const ref = createRef<RemoteDeviceManagerHandle>();
    render(
      <RemoteDeviceManager
        ref={ref}
        {...workspaceProps()}
        devices={[]}
        endpoints={[]}
        probes={[]}
        busy={false}
        onListSshConfigHosts={vi.fn().mockRejectedValue(new Error("permission denied"))}
        onResolveSshConfigHost={vi.fn()}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    openAddDialog(ref);
    const dialog = screen.getByRole("dialog", { name: "Add SSH device" });
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: /^SSH host/ })).toBeInTheDocument());
    expect(dialog).toHaveTextContent("You can still enter connection details manually");
  });

  it("keeps an unavailable connection result in the add dialog with a retry action", async () => {
    const ref = createRef<RemoteDeviceManagerHandle>();
    render(
      <RemoteDeviceManager
        ref={ref}
        {...sshConfigProps()}
        {...workspaceProps()}
        devices={[]}
        endpoints={[]}
        probes={[]}
        busy={false}
        onAdd={vi.fn().mockResolvedValue({
          device,
          probe: {
            deviceId: device.id,
            status: "unavailable",
            agentExecutables: {},
            checkedAt: "2026-08-21T00:00:00.000Z",
            error: "Permission denied (publickey)"
          }
        })}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    openAddDialog(ref);
    const dialog = screen.getByRole("dialog", { name: "Add SSH device" });
    await waitFor(() => expect(within(dialog).getByLabelText("SSH host")).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText("Device name"), {
      target: { value: "Build server" }
    });
    fireEvent.change(within(dialog).getByLabelText("SSH host"), {
      target: { value: "build.internal" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add device" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Edit SSH device" }))
      .toHaveTextContent("Device saved, but AgentEnv could not connect: Permission denied (publickey)"));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("confirms that removing a device leaves remote files unchanged", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <RemoteDeviceManager
        {...sshConfigProps()}
        {...workspaceProps()}
        devices={[device]}
        endpoints={[]}
        probes={[{
          deviceId: device.id,
          status: "unavailable",
          agentExecutables: {},
          checkedAt: "2026-08-21T00:00:00.000Z",
          error: "device is offline"
        }]}
        busy={false}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={onRemove}
      />
    );

    const menuTrigger = screen.getByRole("button", { name: "More actions for Build server" });
    fireEvent.click(menuTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", { name: "Remove SSH device" });
    expect(dialog).toHaveTextContent("Files on the Linux device are not changed");
    fireEvent.click(screen.getByRole("button", { name: "Remove device" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(device.id));
    await waitFor(() => expect(menuTrigger).toHaveFocus());
  });

  it("distinguishes an offline device from a device with no supported Agents", () => {
    render(
      <RemoteDeviceManager
        {...sshConfigProps()}
        {...workspaceProps()}
        devices={[device]}
        endpoints={[]}
        probes={[{
          deviceId: device.id,
          status: "unavailable",
          agentExecutables: {},
          checkedAt: "2026-08-21T00:00:00.000Z",
          error: "device is offline"
        }]}
        busy={false}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("device is offline")).toBeInTheDocument();
    expect(screen.queryByText("No supported Agents installed")).not.toBeInTheDocument();
  });

  it("keeps refresh progress local to one device and exposes its detected Agent", () => {
    const onRefreshDevice = vi.fn().mockResolvedValue(undefined);
    const remoteTarget = {
      id: `ssh:${device.id}:opencode`,
      name: "OpenCode · Build server",
      iconKey: "opencode",
      health: { status: "ready" },
      location: {
        kind: "ssh",
        deviceId: device.id,
        deviceName: device.name,
        agentName: "OpenCode",
        host: device.host
      }
    } as never;
    render(
      <RemoteDeviceManager
        {...sshConfigProps()}
        {...workspaceProps()}
        devices={[device]}
        endpoints={[{
          id: `ssh:${device.id}:opencode`,
          deviceId: device.id,
          deviceName: device.name,
          agentId: "opencode",
          agentName: "OpenCode",
          homeDir: "/home/agent",
          executablePath: "/usr/bin/opencode",
          deviceFingerprint: "fixture",
          checkedAt: "2026-08-21T00:00:00.000Z",
          availability: "ready",
          capabilities: {
            apply: true,
            capture: false,
            conversations: false,
            workspaceOpen: false,
            comparison: false
          }
        }]}
        probes={[{
          deviceId: device.id,
          status: "ready",
          agentExecutables: { opencode: "/usr/bin/opencode" },
          checkedAt: "2026-08-21T00:00:00.000Z"
        }]}
        remoteTargets={[remoteTarget]}
        busy={false}
        busyDeviceIds={[device.id]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onRefreshDevice={onRefreshDevice}
        onOpenProfile={vi.fn()}
      />
    );

    expect(screen.getByText("OpenCode")).toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Build server" })).toBeDisabled();
  });
});
