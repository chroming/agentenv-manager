// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentEnvApi } from "../../src/shared/types";
import { defaultAIPreferences } from "../../src/shared/aiAssistance";
import { LocalSkillAnalysis } from "../../src/renderer/components/LocalSkillAnalysis";

afterEach(cleanup);
it("offers duplicate analysis after a local read, but never sends content until clicked", async () => {
  const api = {
    readAIPreferences: vi.fn().mockResolvedValue(defaultAIPreferences()),
    previewSkillImport: vi.fn().mockResolvedValue({ incoming: { name: "Review", skillMarkdown: "New review" }, conflicts: [
      { existing: { id: "review", name: "Review", skillMarkdown: "Old review" }, changes: [] }
    ] }),
    prepareAIAnalysis: vi.fn().mockResolvedValue({ key: "key", documents: [], partial: false, warnings: [] }),
    readSkillSummaryConfig: vi.fn().mockResolvedValue({ endpoint: "https://example.test", model: "fixture" }),
    generateAIAnalysis: vi.fn().mockResolvedValue({ key: "key", overview: "Now reviews tests", findings: [], limitations: [], documents: [], generatedAt: "2026-09-06", model: "fixture" }),
    cancelAIAnalysis: vi.fn()
  };
  window.agentEnv = api as unknown as AgentEnvApi;
  render(<LocalSkillAnalysis sourcePath="/fixture/review" />);
  const action = await screen.findByRole("button", { name: "Analyze differences" });
  expect(screen.getByText("Duplicate Skill analysis")).toBeVisible();
  expect(api.generateAIAnalysis).not.toHaveBeenCalled();
  fireEvent.click(action);
  await waitFor(() => expect(api.generateAIAnalysis).toHaveBeenCalledTimes(1));
  await screen.findByText("Now reviews tests");
  expect(api.previewSkillImport).toHaveBeenCalledWith({ kind: "local", input: { sourcePath: "/fixture/review" } });
});
