// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TargetEnvironmentSummary } from "../../src/renderer/components/TargetEnvironmentSummary";

afterEach(cleanup);

it("uses one actionable line for an unconfigured Agent", () => {
  const configure = vi.fn();
  render(<TargetEnvironmentSummary lifecycle="Not managed" actionOnly actionLabel="Configure" onAction={configure} />);
  expect(screen.queryByText("Not managed")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Configure" }));
  expect(configure).toHaveBeenCalledOnce();
});

it("keeps the Profile identity and actionable recovery state visible", () => {
  render(<TargetEnvironmentSummary lifecycle="Recovery required" lifecycleStatus="recovery-required" profileName="Daily Coding" actionLabel="Open Recovery" onAction={vi.fn()} />);
  expect(screen.getByLabelText("Recovery required")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Recovery" })).toHaveAttribute("title", "Daily Coding\nRecovery required");
});

it("keeps an applied Profile on one line without repeated lifecycle copy", () => {
  const { container } = render(<TargetEnvironmentSummary lifecycle="Applied" lifecycleStatus="applied" profileName="Daily Coding" onAction={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Daily Coding" })).toHaveAttribute("title", "Daily Coding\nApplied");
  expect(screen.queryByText("Applied")).not.toBeInTheDocument();
  expect(container.querySelector(".target-workflow-environment")!.children).toHaveLength(1);
});

it.each(["pending", "drifted", "applied-with-local-override"] as const)("retains %s details without a second text row", (lifecycleStatus) => {
  const open = vi.fn();
  const { container } = render(<TargetEnvironmentSummary lifecycle="State details" lifecycleStatus={lifecycleStatus} profileName="Daily Coding" onAction={open} />);
  expect(screen.getByLabelText("State details")).toBeInTheDocument();
  expect(container.querySelector(".target-workflow-lifecycle")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Daily Coding" }));
  expect(open).toHaveBeenCalledOnce();
});
