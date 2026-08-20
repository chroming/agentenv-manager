// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteDeviceManager } from "../../src/renderer/components/RemoteDeviceManager";

afterEach(cleanup);

const device = {
  id: "93cf2229-0e22-4d10-8b7f-5600b71f4a44",
  name: "Build server",
  host: "build.internal",
  user: "agent",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z"
};

describe("RemoteDeviceManager", () => {
  it("uses the shared form dialog and never asks for a password or private key", () => {
    render(
      <RemoteDeviceManager
        devices={[]}
        endpoints={[]}
        busy={false}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add SSH device" }));
    const dialog = screen.getByRole("dialog", { name: "Add SSH device" });
    expect(dialog).toHaveTextContent("system OpenSSH");
    expect(screen.getByLabelText("Device name")).toBeInTheDocument();
    expect(screen.getByLabelText("SSH host")).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/password field|private key path/i);
  });

  it("confirms that removing a device leaves remote files unchanged", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <RemoteDeviceManager
        devices={[device]}
        endpoints={[]}
        busy={false}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={onRemove}
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Build server" }));
    const dialog = screen.getByRole("dialog", { name: "Remove SSH device" });
    expect(dialog).toHaveTextContent("Files on the Linux device are not changed");
    fireEvent.click(screen.getByRole("button", { name: "Remove device" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(device.id));
  });
});
