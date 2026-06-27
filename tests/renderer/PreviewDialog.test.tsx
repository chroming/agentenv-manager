// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PreviewDialog } from "../../src/renderer/components/PreviewDialog";
import type { ActivationPreview } from "../../src/shared/types";

const preview: ActivationPreview = {
  id: "preview-1",
  profileId: "daily-coding",
  targetId: "opencode",
  createdAt: "2026-06-30T00:00:00.000Z",
  warnings: [],
  errors: [],
  changes: [
    {
      path: "/tmp/home/.config/opencode/opencode.json",
      before: "{}\n",
      after: '{\n  "mcp": {}\n}\n',
      diff: "--- opencode.json\n+++ opencode.json\n@@\n-{}\n+{\"mcp\":{}}\n"
    }
  ],
  liveFingerprints: {},
  targetState: { managedConfigKeys: [], managedMcpNames: [] }
};

afterEach(() => {
  cleanup();
});

describe("PreviewDialog", () => {
  it("renders a structured syntax-highlighted diff", async () => {
    render(<PreviewDialog preview={preview} />);

    const diff = await screen.findByRole("table", {
      name: "Formatted diff for /tmp/home/.config/opencode/opencode.json"
    });

    expect(within(diff).getByText("-")).toBeInTheDocument();
    expect(within(diff).getByText("+")).toBeInTheDocument();
    expect(diff).toHaveTextContent("{\"mcp\":{}}");
    expect(diff.querySelector(".diff-row--deletion")).toBeTruthy();
    expect(diff.querySelector(".diff-row--addition")).toBeTruthy();
    expect(diff.querySelector(".syntax-token")).toBeTruthy();
  });
});
