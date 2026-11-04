// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SkillRemovalDialog } from "../../src/renderer/components/SkillRemovalDialog";
import type { SkillLibraryEntry, SkillRemovalPreview } from "../../src/shared/types";

afterEach(() => { cleanup(); Reflect.deleteProperty(window, "agentEnv"); });
const skill = { id: "review", name: "Review", path: "/library/review" } as SkillLibraryEntry;
const preview: SkillRemovalPreview = { previewId: "preview", libraryId: "review", libraryPath: skill.path,
  profiles: [{ id: "daily", name: "Daily" }], groups: [{ id: "group", name: "Coding" }],
  installs: [{ path: "/codex/skills/review", targetIds: ["codex"] }] };
const api = (prepare: () => Promise<SkillRemovalPreview>) => Object.defineProperty(window, "agentEnv", {
  configurable: true, value: { previewRemoveLibrarySkill: prepare }
});
it("shows all dependencies and removes them in the same confirmation", async () => {
  api(vi.fn().mockResolvedValue(preview));
  const remove = vi.fn().mockResolvedValue(undefined), close = vi.fn();
  render(<SkillRemovalDialog skill={skill} onClose={close} onRemove={remove} />);
  await waitFor(() => expect(screen.getByText("Daily")).toBeInTheDocument());
  expect(screen.getByText("Coding")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove skill and installs" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(remove).toHaveBeenCalledWith("review", "preview");
});
it("keeps commit failures inside the dialog and offers a fresh preview", async () => {
  const prepare = vi.fn().mockResolvedValue(preview); api(prepare);
  const close = vi.fn();
  render(<SkillRemovalDialog skill={skill} onClose={close} onRemove={vi.fn().mockRejectedValue(new Error("Selected file changed"))} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove skill and installs" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove skill and installs" }));
  expect(await screen.findByText("Selected file changed")).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review again" }));
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
});
it("does not dismiss while the selected mutation is running", async () => {
  api(vi.fn().mockResolvedValue(preview));
  let finish!: () => void;
  const close = vi.fn();
  render(<SkillRemovalDialog skill={skill} onClose={close} onRemove={() => new Promise<void>((done) => { finish = done; })} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove skill and installs" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove skill and installs" }));
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("dialog").parentElement!);
  expect(close).not.toHaveBeenCalled();
  finish(); await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
