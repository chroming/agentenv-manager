// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SkillSummaryContent } from "../../src/renderer/components/SkillSummaryContent";
import type { SkillSummary } from "../../src/shared/skillSummaries";
afterEach(cleanup);
it("shows unverified findings without turning invented evidence into a file link", () => {
  const summary: SkillSummary = { schemaVersion: 1, key: "fixture", skillId: "fixture", beforeHash: "old", afterHash: "new", redacted: false, files: [],
    overview: "Changed behavior", generatedAt: "2026-09-18T00:00:00Z", model: "fixture", coverage: "complete", omittedPaths: [],
    items: [{ category: "security", fact: "Removes input validation", implication: "Review inputs before use", paths: [], evidenceStatus: "unverified" }] };
  render(<SkillSummaryContent summary={summary} onViewFile={vi.fn()} />);
  expect(screen.getAllByText("Removes input validation").some((node) => !node.closest("details"))).toBe(true);
  expect(screen.getByText("File references could not be verified. Check this finding against the original diff.")).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("keeps the quick read bounded while preserving every cached finding and evidence", () => {
  const summary: SkillSummary = { schemaVersion: 1, key: "fixture", skillId: "fixture", beforeHash: "old", afterHash: "new", redacted: false, files: [],
    overview: "Core change", generatedAt: "2026-09-06T00:00:00Z", model: "fixture", coverage: "complete", omittedPaths: [],
    items: Array.from({ length: 5 }, (_, i) => ({ category: i === 4 ? "security" : "usage", fact: `Change ${i}`, implication: `Impact ${i}`, paths: [`file-${i}.md`] })) };
  const view = vi.fn();
  const { container } = render(<SkillSummaryContent summary={summary} onViewFile={view} />);
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(container.querySelector(".ai-review-finding")?.textContent).toContain("Change 4");
  expect(screen.getAllByText("Impact 4").some((node) => !node.closest("details"))).toBe(true);
  expect(screen.getAllByText("Change 4").some((node) => !node.closest("details"))).toBe(true);
  expect(screen.getAllByText("Change 3").every((node) => node.closest("details"))).toBe(true);
  fireEvent.click(screen.getByText("More findings (1)"));
  expect(details.open).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "file-3.md" }));
  expect(view).toHaveBeenCalledWith("file-3.md");
  expect(screen.getByText("Impact 3")).toBeVisible();
});
