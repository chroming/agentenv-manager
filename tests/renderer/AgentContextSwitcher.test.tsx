// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentContextSwitcher } from "../../src/renderer/components/AgentContextSwitcher";
import type { TargetInfo } from "../../src/shared/types";

const openCode = {
  id: "opencode",
  name: "OpenCode",
  health: { executablePath: "/usr/local/bin/opencode" }
} as TargetInfo;

const codex = {
  id: "codex",
  name: "Codex",
  health: { executablePath: "/usr/local/bin/codex" }
} as TargetInfo;

afterEach(() => cleanup());

describe("AgentContextSwitcher", () => {
  it("renders zero candidates as a disabled selection control", () => {
    render(
      <AgentContextSwitcher
        open={false}
        query=""
        selectionLabel="Choose Agent"
        targets={[]}
        onOpenChange={() => undefined}
        onQueryChange={() => undefined}
        onSelect={() => undefined}
      />
    );

    const trigger = screen.getByRole("button", { name: "Choose Agent" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("renders one candidate as static current context without a menu", () => {
    const onOpenChange = vi.fn();
    render(
      <AgentContextSwitcher
        open={false}
        query=""
        selectedId={openCode.id}
        selectionLabel="Choose Agent"
        targets={[openCode]}
        onOpenChange={onOpenChange}
        onQueryChange={() => undefined}
        onSelect={() => undefined}
      />
    );

    const context = screen.getByLabelText("Current Agent OpenCode");
    expect(context).toHaveClass("agent-context-switcher--static");
    expect(context.tagName).toBe("DIV");
    expect(context.querySelector(".agent-endpoint-icon")).not.toBeNull();
    expect(context.querySelector(".lucide-chevron-down")).toBeNull();
    expect(screen.queryByRole("button", { name: "Current Agent OpenCode" }))
      .not.toBeInTheDocument();
    fireEvent.click(context);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders multiple candidates as one searchable selection menu", () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    const props = {
      query: "",
      selectedId: openCode.id,
      selectionLabel: "Choose Agent",
      targets: [openCode, codex],
      onOpenChange,
      onQueryChange: vi.fn(),
      onSelect
    };
    const { rerender } = render(<AgentContextSwitcher {...props} open={false} />);

    const trigger = screen.getByRole("button", { name: "Choose Agent" });
    expect(trigger).not.toBeDisabled();
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(<AgentContextSwitcher {...props} open />);
    const menu = screen.getByRole("dialog", { name: "Choose Agent" });
    expect(within(menu).getAllByRole("option")).toHaveLength(2);
    fireEvent.click(within(menu).getByRole("option", { name: "Codex" }));
    expect(onSelect).toHaveBeenCalledWith(codex.id);
  });

  it("groups remote endpoints by device and marks them with an SSH badge", () => {
    const remoteOpenCode = {
      ...openCode,
      id: "ssh:build-server:opencode",
      name: "OpenCode · Build server",
      health: {
        ...openCode.health,
        status: "ready",
        summary: "Ready on Build server"
      },
      location: {
        kind: "ssh",
        deviceId: "build-server",
        deviceName: "Build server",
        agentName: "OpenCode",
        host: "build.internal"
      }
    } as TargetInfo;
    render(
      <AgentContextSwitcher
        open
        query=""
        selectedId={openCode.id}
        selectionLabel="Choose Agent"
        targets={[openCode, remoteOpenCode]}
        onOpenChange={() => undefined}
        onQueryChange={() => undefined}
        onSelect={() => undefined}
      />
    );

    const menu = screen.getByRole("dialog", { name: "Choose Agent" });
    expect(within(menu).getByText("This Mac")).toBeInTheDocument();
    expect(within(menu).getByText("Build server", { selector: ".ui-object-switcher__group-label" }))
      .toBeInTheDocument();
    const remoteOption = within(menu).getByRole("option", {
      name: "OpenCode · Build server · SSH"
    });
    expect(remoteOption.querySelector(".agent-endpoint-icon__remote-badge")).not.toBeNull();
    expect(remoteOption).toHaveTextContent("Build server · SSH");
  });
});
