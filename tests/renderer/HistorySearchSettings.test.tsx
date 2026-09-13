// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HistorySearchSettings } from "../../src/renderer/components/HistorySearchSettings";
import type { HistorySearchStatus } from "../../src/shared/conversationSearch";

afterEach(cleanup);
const install = (enabled = false) => {
  const source = {id:"source",deviceId:"local",agentId:"codex",root:"/fixture/history",kind:"default" as const};
  const status: HistorySearchStatus = {
    config:{version:1,enabled,paused:false,sources:enabled ? [source] : []},needsConsent:!enabled,running:false,
    sources:[{sourceKey:source.id,phase:"ready",discovered:2,indexed:2,failed:0,summaryOnly:2,issues:[]}],
    availableSources:[{...source,deviceName:"This device",agentName:"Codex"}]
  };
  const api = {conversationHistoryStatus:vi.fn().mockResolvedValue(status),configureConversationHistory:vi.fn().mockResolvedValue(status)};
  Object.defineProperty(window,"agentEnv",{configurable:true,value:api});
  return api;
};

it("explains unread histories and keeps retry failures inside the dialog", async () => {
  const api = install(true);
  const status = await api.conversationHistoryStatus();
  status.sources[0].phase = "unavailable";
  status.sources[0].issues = ["Permission denied: /fixture/history"];
  Object.assign(api,{refreshConversations:vi.fn().mockRejectedValue(new Error("SSH connection refused"))});
  render(<HistorySearchSettings />);
  fireEvent.click(screen.getByRole("button",{name:"History sources"}));
  fireEvent.click(await screen.findByRole("button",{name:"This device · Review unread histories"}));
  expect(screen.getByText("Permission denied: /fixture/history")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Exclude Agent"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Retry history refresh"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("SSH connection refused");
});

it("does not collect or configure anything when the entry is rendered", async () => {
  const api = install();
  render(<HistorySearchSettings />);
  expect(api.conversationHistoryStatus).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"History sources"}));
  const dialog = await screen.findByRole("dialog",{name:"History search"});
  await within(dialog).findByRole("switch",{name:"This device"});
  fireEvent.click(within(dialog).getByRole("button",{name:"Cancel"}));
  expect(api.configureConversationHistory).not.toHaveBeenCalled();
});

it("keeps source coverage in device details and clears disabled cache by default", async () => {
  const api = install(true);
  render(<HistorySearchSettings />);
  fireEvent.click(screen.getByRole("button",{name:"History sources"}));
  await screen.findByRole("switch",{name:"This device"});
  expect(screen.queryByText(/2 Summary only/)).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"This device · More"}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Details"}));
  const summary = await screen.findByText(/2 Summary only/);
  expect(summary.tagName).toBe("P");
  fireEvent.click(screen.getByRole("switch",{name:"History search"}));
  fireEvent.click(screen.getByRole("button",{name:"Save"}));
  await waitFor(()=>expect(api.configureConversationHistory).toHaveBeenCalledWith(expect.objectContaining({enabled:false}),true));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
});

it("keeps a save failure inside the source dialog without losing the selected sources", async () => {
  const api = install(true);
  api.configureConversationHistory.mockRejectedValue(new Error("Cannot save history settings"));
  render(<HistorySearchSettings />);
  fireEvent.click(screen.getByRole("button",{name:"History sources"}));
  await screen.findByRole("switch",{name:"History search"});
  fireEvent.click(screen.getByRole("button",{name:"Save"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot save history settings");
  expect(screen.getByRole("switch",{name:"This device"})).toHaveAttribute("aria-checked","true");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("enables a whole device and exposes individual Agent choices only in More", async () => {
  const api = install();
  const status = await api.conversationHistoryStatus();
  status.availableSources.push({...status.availableSources[0],id:"claude",agentId:"claude-code",agentName:"Claude Code",root:"/fixture/claude"});
  render(<HistorySearchSettings />);
  fireEvent.click(screen.getByRole("button",{name:"History sources"}));
  await screen.findByRole("switch",{name:"This device"});
  expect(screen.queryByRole("switch",{name:"History search"})).toBeNull();
  expect(screen.queryByRole("switch",{name:/Codex/})).toBeNull();
  fireEvent.click(screen.getByRole("switch",{name:"This device"}));
  fireEvent.click(screen.getByRole("button",{name:"This device · More"}));
  expect(screen.getByRole("menuitemcheckbox",{name:"Codex"})).toHaveAttribute("aria-checked","true");
  fireEvent.click(screen.getByRole("menuitemcheckbox",{name:"Claude Code"}));
  expect(screen.getByRole("switch",{name:"This device"})).toHaveAttribute("aria-checked","true");
  expect(screen.queryByRole("button",{name:"Pause"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Enable search"}));
  await waitFor(()=>expect(api.configureConversationHistory).toHaveBeenCalledWith(expect.objectContaining({enabled:true,paused:false,sources:[expect.objectContaining({agentId:"codex"})]}),true));
});
