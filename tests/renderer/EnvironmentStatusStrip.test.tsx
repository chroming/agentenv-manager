// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentStatusStrip } from "../../src/renderer/components/EnvironmentStatusStrip";
import type { EnvironmentReviewSummary, EnvironmentReviewState } from "../../src/renderer/environmentReview";

afterEach(cleanup);

const summary = (state: EnvironmentReviewState): EnvironmentReviewSummary => ({
  state, installedTargetIds: ["codex"], installedAgentCount: 1, usableProfileCount: 1,
  sharedSkillCount: 4, sharedAutomaticCount: 2, sharedDecisionCount: 2,
  affectedTargetIds: ["codex"], attentionTargetIds: ["codex"]
});

describe("default attention budget", () => {
  it.each<EnvironmentReviewState>(["checking", "setup", "ready", "no-agents", "shared-review", "agent-review"])(
    "does not promote %s into a global task banner", (state) => {
      const { container } = render(<EnvironmentStatusStrip summary={summary(state)} busy={false} onRefresh={vi.fn()} />);
      expect(container).toBeEmptyDOMElement();
    }
  );

  it("keeps an actual scan failure visible, retryable, and guarded while busy", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<EnvironmentStatusStrip summary={summary("unavailable")} busy={false} onRefresh={onRefresh} />);
    expect(screen.getByRole("status")).toHaveTextContent("Profile check unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry check" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(<EnvironmentStatusStrip summary={summary("unavailable")} busy onRefresh={onRefresh} />);
    expect(screen.getByRole("button", { name: "Retry check" })).toBeDisabled();
  });
});
