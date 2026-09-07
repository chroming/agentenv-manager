// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AIServiceForm } from "../../src/renderer/components/SkillSummarySettings";
import type { AgentEnvApi } from "../../src/shared/types";
afterEach(cleanup);
it("separates saving from testing and keeps a persistent feedback slot after actions", async () => {
  const test = vi.fn().mockResolvedValue(undefined);
  window.agentEnv = { readSkillSummaryConfig: vi.fn().mockResolvedValue({ endpoint: "https://example.test/v1", model: "fixture", hasKey: true }),
    saveSkillSummaryConfig: vi.fn().mockResolvedValue(undefined), testAIService: test } as unknown as AgentEnvApi;
  render(<AIServiceForm />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).toBeEnabled());
  const slot = screen.getByRole("status");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(slot).toHaveTextContent("Saved"));
  expect(test).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await waitFor(() => expect(slot).toHaveTextContent("AI service is available"));
  expect(test).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole("textbox", { name: "Model" }), { target: { value: "changed" } });
  expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  expect(slot).toBeEmptyDOMElement();
});
