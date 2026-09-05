// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIAnalysisReview } from "../../src/renderer/components/AIAnalysisReview";
import { AIAssistanceSettings } from "../../src/renderer/components/AIAssistanceSettings";
import { defaultAIPreferences, type AIPreferences, type AIAnalysisRecord } from "../../src/shared/aiAssistance";
import type { AgentEnvApi } from "../../src/shared/types";

afterEach(cleanup);
const record: AIAnalysisRecord = { schemaVersion: 1, key: "key", kind: "comparison", locale: "en", generatedAt: "2026-09-06T00:00:00Z", endpoint: "https://example.test/", model: "fixture", partial: false,
  overview: "Adds a test", findings: [{ category: "observation", detail: "A test was added", suggestion: "Review the assertion", evidence: ["proposed"] }], limitations: [], documents: [{ id: "proposed", label: "With Profile", content: "test added" }] };
const install = (cached = false, prefs = defaultAIPreferences()) => {
  const listeners = new Set<(prefs: AIPreferences) => void>();
  const api = {
    readAIPreferences: vi.fn(async () => prefs),
    onAIPreferencesChanged: vi.fn((listener) => { listeners.add(listener); return () => listeners.delete(listener); }),
    saveAIPreferences: vi.fn(async (next) => { prefs = next; listeners.forEach((listener) => listener(next)); return next; }),
    prepareAIAnalysis: vi.fn().mockResolvedValue({ key: "key", documents: record.documents, warnings: [], partial: false, cached: cached ? record : undefined }),
    readSkillSummaryConfig: vi.fn().mockResolvedValue({ endpoint: "https://example.test/", model: "fixture", hasKey: true }),
    generateAIAnalysis: vi.fn().mockResolvedValue(record), cancelAIAnalysis: vi.fn()
  };
  window.agentEnv = api as unknown as AgentEnvApi;
  return api;
};
describe("AI assistance surfaces", () => {
  it("keeps generation manual, confirms destination and shows linked evidence", async () => {
    const api = install(); render(<AIAnalysisReview subject={{ kind: "comparison", runId: "run" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze results" }));
    const generate = await screen.findByRole("button", { name: "Generate" });
    expect(api.generateAIAnalysis).not.toHaveBeenCalled(); fireEvent.click(generate);
    await screen.findByText("Adds a test");
    fireEvent.click(screen.getByRole("button", { name: "With Profile" })); await screen.findByText("test added");
    expect(api.generateAIAnalysis).toHaveBeenCalledTimes(1);
  });
  it("preserves cached results on failure and allows read-only access with AI disabled", async () => {
    const api = install(true); render(<AIAnalysisReview subject={{ kind: "comparison", runId: "run" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    api.generateAIAnalysis.mockRejectedValue(new Error("Quota exceeded"));
    fireEvent.click(await screen.findByRole("button", { name: "Generate" }));
    await screen.findByText("Error: Quota exceeded"); expect(screen.getByText("Adds a test")).toBeInTheDocument();
    await api.saveAIPreferences({ ...defaultAIPreferences(), enabled: false });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument());
    expect(screen.getByText("Adds a test")).toBeInTheDocument();
  });
  it("cancels an open analysis when disabled", async () => {
    const api = install(); api.generateAIAnalysis.mockImplementation(() => new Promise(() => undefined));
    render(<AIAnalysisReview subject={{ kind: "comparison", runId: "run" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze results" }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate" }));
    await waitFor(() => expect(api.generateAIAnalysis).toHaveBeenCalled());
    await api.saveAIPreferences({ ...defaultAIPreferences(), enabled: false });
    await waitFor(() => expect(api.cancelAIAnalysis).toHaveBeenCalled());
  });
  it("restores individual choices after the master switch reopens", async () => {
    const api = install(); render(<AIAssistanceSettings />);
    const master = await screen.findByRole("switch", { name: "AI assistance" });
    await waitFor(() => expect(master).toBeEnabled());
    fireEvent.click(screen.getByRole("switch", { name: "Tag suggestions" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Tag suggestions" })).not.toBeChecked());
    fireEvent.click(master); await waitFor(() => expect(master).not.toBeChecked());
    expect(screen.getByRole("switch", { name: "Tag suggestions" })).toBeDisabled();
    fireEvent.click(master); await waitFor(() => expect(master).toBeChecked());
    expect(screen.getByRole("switch", { name: "Tag suggestions" })).not.toBeChecked();
    expect(api.saveAIPreferences).toHaveBeenCalledTimes(3);
  });
});
