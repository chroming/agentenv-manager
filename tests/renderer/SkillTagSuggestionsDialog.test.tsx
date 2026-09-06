// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillTagSuggestionsDialog } from "../../src/renderer/components/SkillTagSuggestionsDialog";
import type { AgentEnvApi, SkillLibraryEntry } from "../../src/shared/types";
import type { SkillTagSuggestion } from "../../src/shared/skillTagSuggestions";

afterEach(cleanup);
const skills = [{ id: "review", name: "Review", tags: [] }, { id: "testing", name: "Testing", tags: ["Manual"] }] as unknown as SkillLibraryEntry[];
const record = (id: string): SkillTagSuggestion => ({ schemaVersion: 1, key: id, skillId: id, contentHash: "hash", vocabularyHash: "vocab", locale: "en", generatedAt: "2026-09-05", model: "fixture", partial: false, tags: [{ tag: "Code review", reason: "Reviews code changes" }, { tag: "Testing", reason: "Tests behavior" }] });
const install = (cached = false) => {
  const api = {
    readAIPreferences: vi.fn().mockResolvedValue({ enabled: true, features: { tags: true } }),
    prepareSkillTagSuggestions: vi.fn(async (ids: string[]) => ({ items: ids.map((id) => ({ skillId: id, key: id, contentHash: "hash", partial: false, cached: cached ? record(id) : undefined })), errors: [] })),
    readSkillSummaryConfig: vi.fn().mockResolvedValue({ endpoint: "https://example.test/", model: "fixture", hasKey: false }),
    generateSkillTagSuggestions: vi.fn().mockImplementation(async ({ skillId }) => record(skillId)),
    cancelSkillTagSuggestions: vi.fn().mockResolvedValue(undefined)
  };
  window.agentEnv = api as unknown as AgentEnvApi; return api;
};
describe("AI tag review", () => {
  it("allows trimming an over-limit regenerated draft without losing fixed additions", async () => {
    const api = install(true);
    render(<SkillTagSuggestionsDialog skills={[skills[0]]} vocabulary={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    const input = await screen.findByRole("textbox", { name: "Add a tag" });
    for (let index = 0; index < 10; index++) {
      fireEvent.change(input, { target: { value: `Fixed ${index}` } }); fireEvent.keyDown(input, { key: "Enter" });
    }
    api.generateSkillTagSuggestions.mockResolvedValue({ ...record("review"), tags: Array.from({ length: 5 }, (_, i) => ({ tag: `AI ${i}`, reason: "Task" })) });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await screen.findByRole("button", { name: "Remove tag AI 0" });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: `Remove tag AI ${i}` }));
    expect(screen.queryByRole("button", { name: "Remove tag AI 0" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove tag Fixed 0" })).toBeVisible();
  });
  it("preserves unsaved fixed additions across regeneration, including model overlaps", async () => {
    const api = install(true); const save = vi.fn().mockResolvedValue(true);
    render(<SkillTagSuggestionsDialog skills={[skills[0]]} vocabulary={[]} onClose={vi.fn()} onSave={save} />);
    const input = await screen.findByRole("textbox", { name: "Add a tag" });
    for (const value of ["Docs", "Code review"]) {
      fireEvent.change(input, { target: { value } }); fireEvent.keyDown(input, { key: "Enter" });
    }
    api.generateSkillTagSuggestions.mockResolvedValue({ ...record("review"), tags: [{ tag: "New", reason: "New capability" }] });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await screen.findByRole("button", { name: "Remove tag New" });
    expect(screen.getByRole("button", { name: "Remove tag Docs" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove tag Code review" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Remove tag Testing" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save tags (1)" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ fixedTags: ["Docs", "Code review"], tags: ["New", "Docs", "Code review"] })));
  });
  it("offers configuration in place without generating or losing selection", async () => {
    const api = install(); api.readSkillSummaryConfig.mockResolvedValue({ endpoint: "", model: "", hasKey: false });
    render(<SkillTagSuggestionsDialog skills={skills} vocabulary={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Suggest tags" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Configure AI service" }));
    expect(await screen.findByRole("textbox", { name: "API endpoint" })).toBeVisible();
    for (const button of screen.getAllByRole("button", { name: "Suggest tags" })) expect(button).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select Review" })).toBeChecked();
    expect(api.generateSkillTagSuggestions).not.toHaveBeenCalled();
  });
  it("allows saving removal-only AI changes while retaining manual tags", async () => {
    install(true); const save = vi.fn().mockResolvedValue(true);
    render(<SkillTagSuggestionsDialog skills={[{ ...skills[0], tags: ["Manual", "Code review", "Testing"], aiTags: ["Code review", "Testing"] }]} vocabulary={[]} onClose={vi.fn()} onSave={save} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove tag Code review" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove tag Testing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save tags (1)" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: "review", tags: [], suggestionKey: "review" }));
  });
  it("defaults to untagged Skills, generates with one click and saves only accepted suggestions", async () => {
    const api = install(); const save = vi.fn().mockResolvedValue(true);
    render(<SkillTagSuggestionsDialog skills={skills} vocabulary={["Manual", "Testing"]} onClose={vi.fn()} onSave={save} />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select Review" })).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: "Select Review" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Testing" })).not.toBeChecked();
    expect(api.generateSkillTagSuggestions).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Suggest tags" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Remove tag Testing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save tags (1)" }));
    await screen.findByText("Saved", { exact: true });
    expect(save).toHaveBeenCalledWith({ id: "review", tags: ["Code review"], suggestionKey: "review" });
    expect(api.generateSkillTagSuggestions).toHaveBeenCalledTimes(1);
  });
  it("loads persistent suggestions without API calls and allows manual additions", async () => {
    const api = install(true); const save = vi.fn().mockResolvedValue(true);
    render(<SkillTagSuggestionsDialog skills={[skills[0]]} vocabulary={["Testing"]} onClose={vi.fn()} onSave={save} />);
    const input = await screen.findByRole("textbox", { name: "Add a tag" });
    expect(screen.getByRole("button", { name: "Remove tag Code review" }).textContent).toBe("Code review");
    expect(screen.getByText("New tag").closest("button")).toBeNull();
    fireEvent.change(input, { target: { value: "Docs" } }); fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save tags (1)" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ tags: ["Code review", "Testing", "Docs"] })));
    expect(api.generateSkillTagSuggestions).not.toHaveBeenCalled();
  });
  it("keeps per-item save failures visible and saves other items", async () => {
    install(true); const save = vi.fn().mockImplementation(async ({ id }) => { if (id === "review") throw new Error("Skill changed; analyze again"); return true; });
    render(<SkillTagSuggestionsDialog skills={skills} vocabulary={[]} onClose={vi.fn()} onSave={save} />);
    await screen.findAllByRole("textbox", { name: "Add a tag" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Save tags (2)" }));
    await screen.findByText("Skill changed; analyze again");
    expect(within(screen.getByRole("region", { name: "Testing" })).getByText("Saved", { exact: true })).toBeInTheDocument();
  });
  it("stops queued generation without discarding completed suggestions and allows retry", async () => {
    const api = install(); let reject: (error: Error) => void = () => undefined;
    api.generateSkillTagSuggestions.mockImplementation(() => new Promise((_resolve, onReject) => { reject = onReject; }));
    api.cancelSkillTagSuggestions.mockImplementation(async () => reject(new Error("Cancelled")));
    render(<SkillTagSuggestionsDialog skills={skills} vocabulary={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select all" })).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Suggest tags" })[0]);
    await screen.findByText("Analyzing");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByText("Skipped");
    expect(api.generateSkillTagSuggestions).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBe(2);
  });
  it("does not discard prior suggestions on failed regeneration", async () => {
    const api = install(true); api.generateSkillTagSuggestions.mockRejectedValue(new Error("Quota exceeded"));
    render(<SkillTagSuggestionsDialog skills={[skills[0]]} vocabulary={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    await screen.findByText("Error: Quota exceeded");
    expect(screen.getByRole("button", { name: "Remove tag Code review" })).toBeInTheDocument();
  });
  it("makes regenerating an already cached batch an explicit one-click action", async () => {
    const api = install(true);
    render(<SkillTagSuggestionsDialog skills={[skills[0]]} vocabulary={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate selected" }));
    await waitFor(() => expect(api.generateSkillTagSuggestions).toHaveBeenCalledWith(expect.objectContaining({ regenerate: true, confirmed: true })));
  });
});
