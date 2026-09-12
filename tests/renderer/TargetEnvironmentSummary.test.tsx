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
  render(<TargetEnvironmentSummary lifecycle="Recovery required" profileName="Daily Coding" actionLabel="Open Recovery" onAction={vi.fn()} />);
  expect(screen.getByText("Recovery required")).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Recovery" })).toHaveAttribute("title", "Daily Coding");
});
