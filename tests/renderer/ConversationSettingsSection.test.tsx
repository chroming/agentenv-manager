// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationSettingsSection, GeneralSettingsSection, SettingsCategoryTabs } from "../../src/renderer/components/SettingsCategoryTabs";

afterEach(cleanup);
it("keeps conversation collection and terminal preferences together, outside General", () => {
  Object.defineProperty(window, "agentEnv", { configurable: true, value: { platform: "darwin" } });
  const general = render(<GeneralSettingsSection locale="en" onLocaleChange={vi.fn()} />);
  expect(screen.getByRole("combobox", { name: "Interface language" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Conversation sources" })).toBeNull();
  general.unmount();
  render(<><SettingsCategoryTabs active="conversations" onChange={vi.fn()} />
    <ConversationSettingsSection conversationTerminal="default" onConversationTerminalChange={vi.fn()} /></>);
  expect(screen.getByRole("tab", { name: "Conversations" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "Conversation sources" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Conversation terminal" })).toBeInTheDocument();
});
