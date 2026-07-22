// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSkillDiscoveryPanel } from "../../src/renderer/components/ProjectSkillDiscoveryPanel";

afterEach(cleanup);

const scanResult = {
  roots: ["/tmp/project"],
  candidates: [{
    id: "review",
    name: "Review",
    description: "Review changes before release",
    version: "1.2.3",
    rootPath: "/tmp/project",
    path: "/tmp/project/.agents/skills/review",
    relativePath: ".agents/skills/review",
    contentHash: "abc123",
    modifiedAt: "2026-07-22T00:00:00.000Z",
    status: "ready" as const
  }],
  issues: [],
  scannedDirectories: 12,
  truncated: false
};

describe("ProjectSkillDiscoveryPanel", () => {
  it("scans configured roots and imports a selected result", async () => {
    const onScan = vi.fn().mockResolvedValue(scanResult);
    const onImport = vi.fn().mockResolvedValue(true);
    render(
      <ProjectSkillDiscoveryPanel
        roots={["/tmp/project"]}
        onAddRoot={vi.fn().mockResolvedValue(undefined)}
        onRemoveRoot={vi.fn().mockResolvedValue(undefined)}
        onScan={onScan}
        onImport={onImport}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByText("Review")).toBeInTheDocument();
    expect(screen.getByText(".agents/skills/review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith("/tmp/project/.agents/skills/review"));
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
  });

  it("adds and removes roots without scanning implicitly", async () => {
    const onAddRoot = vi.fn().mockResolvedValue("/tmp/another-project");
    const onRemoveRoot = vi.fn().mockResolvedValue(undefined);
    const onScan = vi.fn().mockResolvedValue(scanResult);
    render(
      <ProjectSkillDiscoveryPanel
        roots={["/tmp/project"]}
        onAddRoot={onAddRoot}
        onRemoveRoot={onRemoveRoot}
        onScan={onScan}
        onImport={vi.fn().mockResolvedValue(false)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() => expect(onAddRoot).toHaveBeenCalledTimes(1));
    expect(onScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove project folder /tmp/project" }));
    await waitFor(() => expect(onRemoveRoot).toHaveBeenCalledWith("/tmp/project"));
  });
});
