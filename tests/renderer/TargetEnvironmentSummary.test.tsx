// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TargetEnvironmentSummary } from "../../src/renderer/components/TargetEnvironmentSummary";

afterEach(cleanup);

it("uses a state value instead of a repeated Configure command", () => {
  render(<TargetEnvironmentSummary lifecycle="Not managed" emptyLabel="Not configured" />);
  expect(screen.getByText("Not configured")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("keeps the Profile identity and recovery state visible", () => {
  render(<TargetEnvironmentSummary lifecycle="Recovery required" lifecycleStatus="recovery-required" profileName="Daily Coding" emptyLabel="Not configured" />);
  expect(screen.getByLabelText("Recovery required")).toBeInTheDocument();
  expect(screen.getByText("Daily Coding")).toHaveAttribute("title", "Recovery required");
});

it("keeps an applied Profile on one line without repeated lifecycle copy", () => {
  const { container } = render(<TargetEnvironmentSummary lifecycle="Applied" lifecycleStatus="applied" profileName="Daily Coding" emptyLabel="Not configured" />);
  expect(screen.getByText("Daily Coding")).toHaveAttribute("title", "Applied");
  expect(screen.queryByText("Applied")).not.toBeInTheDocument();
  expect(container.querySelector(".target-workflow-environment")!.children).toHaveLength(1);
});

it.each(["pending", "drifted", "applied-with-local-override"] as const)("retains %s details without a second text row", (lifecycleStatus) => {
  const { container } = render(<TargetEnvironmentSummary lifecycle="State details" lifecycleStatus={lifecycleStatus} profileName="Daily Coding" emptyLabel="Not configured" />);
  expect(screen.getByLabelText("State details")).toBeInTheDocument();
  expect(container.querySelector(".target-workflow-lifecycle")).toBeNull();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
