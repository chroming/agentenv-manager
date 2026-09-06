// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentEnvApi } from "../../src/shared/types";
import { defaultAIPreferences } from "../../src/shared/aiAssistance";
import { LocalSkillAnalysis } from "../../src/renderer/components/LocalSkillAnalysis";

afterEach(cleanup);
it("compares local versions before either is imported into Library", async () => {
  const prepare = vi.fn().mockResolvedValue({ key: "key", documents: [], partial: false, warnings: [] });
  const generate = vi.fn().mockResolvedValue({ key: "key", overview: "Different review scope", findings: [], limitations: [], documents: [] });
  window.agentEnv = {
    readAIPreferences: vi.fn().mockResolvedValue(defaultAIPreferences()),
    previewSkillImport: vi.fn(async ({ input }) => ({ incoming: { name: "Review", contentHash: input.sourcePath, skillMarkdown: input.sourcePath.endsWith("one") ? "Review tests" : "Review docs" }, conflicts: [] })),
    prepareAIAnalysis: prepare,
    readSkillSummaryConfig: vi.fn().mockResolvedValue({ endpoint: "https://example.test", model: "fixture" }),
    generateAIAnalysis: generate
  } as unknown as AgentEnvApi;
  render(<LocalSkillAnalysis sourcePath="/fixture/one" comparisonPaths={["/fixture/one", "/fixture/two"]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Analyze differences" }));
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ documents: expect.arrayContaining([
    expect.objectContaining({ content: "Review tests" }), expect.objectContaining({ content: "Review docs" })
  ]) }), "en");
  expect(window.agentEnv.previewSkillImport).toHaveBeenCalledTimes(2);
});
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
