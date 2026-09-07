// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillSummaryReview } from "../../src/renderer/components/SkillSummaryReview";
import type { AgentEnvApi, SkillUpdatePlan } from "../../src/shared/types";
import type { SkillSummary } from "../../src/shared/skillSummaries";

afterEach(cleanup);
const plan = { id: "review", name: "Review", previewId: "preview", beforeContentHash: "old", afterContentHash: "new" } as SkillUpdatePlan;
const record: SkillSummary = { schemaVersion: 1, key: "key", skillId: "review", beforeHash: "old", afterHash: "new", generatedAt: "2026-09-05T10:00:00Z", model: "fixture", overview: "Adds log upload", items: [{ category: "security", fact: "New upload endpoint", implication: "May disclose logs", paths: ["SKILL.md"] }], coverage: "complete", omittedPaths: [], redacted: false, files: [{ path: "SKILL.md", diff: "+new" }] };
const install = (history: SkillSummary[] = []) => {
  const api = { listSkillSummaries: vi.fn().mockResolvedValue(history),
    readAIPreferences: vi.fn().mockResolvedValue({ enabled: true, features: { summaries: true } }),
    prepareSkillSummary: vi.fn().mockResolvedValue({ fileCount: 1, omittedPaths: [] }),
    readSkillSummaryConfig: vi.fn().mockResolvedValue({ endpoint: "https://example.com/v1/chat/completions", model: "fixture", hasKey: true }),
    generateSkillSummary: vi.fn().mockResolvedValue(record), cancelSkillSummary: vi.fn().mockResolvedValue(undefined) };
  window.agentEnv = api as unknown as AgentEnvApi;
  return api;
};
describe("Skill summary review", () => {
  it("configures a missing AI service without navigating away or sending content", async () => {
    const api = install(); api.readSkillSummaryConfig.mockResolvedValue({ endpoint: "", model: "", hasKey: false });
    const save = vi.fn().mockImplementation(async () => {
      api.readSkillSummaryConfig.mockResolvedValue({ endpoint: "https://example.test/v1", model: "fixture", hasKey: false });
    });
    window.agentEnv.saveSkillSummaryConfig = save;
    render(<SkillSummaryReview plans={[plan]} onViewFile={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate summary" }));
    fireEvent.click(await screen.findByRole("button", { name: "Configure AI service" }));
    expect(screen.getByRole("button", { name: "Generate summary" })).toBeDisabled();
    fireEvent.change(await screen.findByRole("textbox", { name: "API endpoint" }), { target: { value: "https://example.test/v1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), { target: { value: "fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "API endpoint" })).not.toBeInTheDocument());
    expect(api.generateSkillSummary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Generate summary" }));
    await waitFor(() => expect(api.generateSkillSummary).toHaveBeenCalledTimes(1));
  });
  it("keeps progress on the initiating action and uses a non-interactive content status", async () => {
    const api = install();
    api.generateSkillSummary.mockImplementation(() => new Promise(() => undefined));
    render(<SkillSummaryReview plans={[plan]} onViewFile={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate summary" }));
    await waitFor(() => expect(api.generateSkillSummary).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Generate summary" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Generating summary");
    expect(screen.queryByRole("button", { name: "Generating summary" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(api.cancelSkillSummary).toHaveBeenCalledTimes(1);
  });
  it("generates with one manual click, without a confirmation prompt, then links evidence", async () => {
    const api = install(); const view = vi.fn();
    render(<SkillSummaryReview plans={[plan]} onViewFile={view} />);
    await waitFor(() => expect(api.listSkillSummaries).toHaveBeenCalled());
    expect(api.generateSkillSummary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Generate summary" }));
    await screen.findByText("Adds log upload");
    expect(screen.queryByText("Generate summaries?")).not.toBeInTheDocument();
    expect(api.generateSkillSummary).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Details"));
    fireEvent.click(screen.getByRole("button", { name: "SKILL.md" }));
    expect(view).toHaveBeenCalledWith(plan, "SKILL.md", expect.objectContaining({ skillId: "review" }));
  });
  it("displays persisted summaries without calling the model, and preserves them on failed regeneration", async () => {
    const api = install([record]);
    render(<SkillSummaryReview plans={[plan]} onViewFile={vi.fn()} />);
    await screen.findByText("Adds log upload");
    expect(api.generateSkillSummary).not.toHaveBeenCalled();
    api.generateSkillSummary.mockRejectedValue(new Error("Quota exceeded"));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate summary" }));
    await screen.findByText("Quota exceeded");
    expect(screen.getByText("Adds log upload")).toBeInTheDocument();
    expect(api.generateSkillSummary.mock.calls[0][0].regenerate).toBe(true);
  });
  it("only generates selected batch items", async () => {
    const api = install();
    render(<SkillSummaryReview plans={[plan, { ...plan, id: "other" }]} selectedIds={["review"]} onViewFile={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Summarize selected (1)" }));
    await screen.findByText("Adds log upload");
    expect(api.generateSkillSummary).toHaveBeenCalledTimes(1);
  });
  it("finishes each batch item before preparing the next, and keeps regeneration in its heading", async () => {
    const api = install();
    let finish!: (value: SkillSummary) => void;
    api.generateSkillSummary.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const other = { ...plan, id: "other", name: "Other", previewId: "other-preview" };
    render(<SkillSummaryReview plans={[plan, other]} onViewFile={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Summarize selected (2)" }));
    await waitFor(() => expect(api.generateSkillSummary).toHaveBeenCalledTimes(1));
    expect(api.prepareSkillSummary).not.toHaveBeenCalled();
    await act(async () => finish(record));
    await waitFor(() => expect(api.generateSkillSummary).toHaveBeenCalledTimes(2));
    const entry = screen.getByRole("region", { name: "Review" });
    const heading = within(entry).getByRole("toolbar");
    const regenerate = within(heading).getByRole("button", { name: "Regenerate summary" });
    api.generateSkillSummary.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(regenerate);
    await waitFor(() => expect(regenerate).toHaveAttribute("aria-busy", "true"));
    expect(within(entry).getByText("Adds log upload")).toBeInTheDocument();
  });
  it("does not start another item after Stop", async () => {
    const api = install();
    let finish!: (value: SkillSummary) => void;
    api.generateSkillSummary.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<SkillSummaryReview plans={[plan, { ...plan, id: "other" }]} onViewFile={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Summarize selected (2)" }));
    await waitFor(() => expect(api.generateSkillSummary).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await act(async () => finish(record));
    expect(api.generateSkillSummary).toHaveBeenCalledTimes(1);
  });
});
