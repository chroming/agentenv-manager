// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIAnalysisReview } from "../../src/renderer/components/AIAnalysisReview";
import { AIAssistanceSettings } from "../../src/renderer/components/AIAssistanceSettings";
import { SkillSummarySettings } from "../../src/renderer/components/SkillSummarySettings";
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
  it("clears a different object's cached result even if the new preview fails", async () => {
    const api = install(true);
    const view = render(<AIAnalysisReview subject={{ kind: "comparison", runId: "one" }} />);
    await screen.findByText("Adds a test");
    api.prepareAIAnalysis.mockRejectedValue(new Error("Could not read new run"));
    view.rerender(<AIAnalysisReview subject={{ kind: "comparison", runId: "two" }} />);
    expect(screen.queryByText("Adds a test")).not.toBeInTheDocument();
    await screen.findByText("Error: Could not read new run");
    expect(screen.queryByText("Adds a test")).not.toBeInTheDocument();
  });
  it("keeps stale analysis only for the same duplicate object and labels it even on preview failure", async () => {
    const api = install(true);
    const view = render(<AIAnalysisReview subject={{ kind: "duplicates", objectId: "one", documents: record.documents }} />);
    await screen.findByText("Adds a test");
    api.prepareAIAnalysis.mockRejectedValue(new Error("Read failed"));
    view.rerender(<AIAnalysisReview subject={{ kind: "duplicates", objectId: "one", documents: [{ ...record.documents[0], content: "changed" }] }} />);
    await screen.findByText("Error: Read failed");
    expect(screen.getByText("Adds a test")).toBeInTheDocument();
    expect(screen.getByText(/Inputs changed/)).toBeInTheDocument();
  });
  it("configures the service in place and returns to confirmation without generating", async () => {
    const api = install();
    api.readSkillSummaryConfig.mockResolvedValue({ endpoint: "https://example.test/", model: "", hasKey: false });
    window.agentEnv.saveSkillSummaryConfig = vi.fn(async () => {
      api.readSkillSummaryConfig.mockResolvedValue({ endpoint: "https://example.test/", model: "configured", hasKey: false });
    });
    render(<AIAnalysisReview subject={{ kind: "comparison", runId: "run" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Analyze results" }));
    fireEvent.click(await screen.findByRole("button", { name: "Configure AI service" }));
    fireEvent.change(await screen.findByLabelText("Model"), { target: { value: "configured" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Generate" });
    expect(api.generateAIAnalysis).not.toHaveBeenCalled();
  });
  it("shows configuration read errors outside the collapsed disclosure", async () => {
    const api = install(); api.readSkillSummaryConfig.mockRejectedValue(new Error("Config unreadable"));
    render(<SkillSummarySettings />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(retry.closest("details")).toBeNull();
    api.readSkillSummaryConfig.mockResolvedValue({ endpoint: "https://example.test/", model: "fixture", hasKey: true });
    fireEvent.click(retry);
    await screen.findByText("AI service · Configured");
  });
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
