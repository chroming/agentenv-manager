// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSkillDiscoveryPanel } from "../../src/renderer/components/ProjectSkillDiscoveryPanel";

afterEach(cleanup);

const scanResult = {
  roots: ["/tmp/project"],
  sourceScope: {
    formatVersion: 1 as const,
    kind: "local" as const,
    canonicalLink: "file:///tmp/project",
    repository: "/tmp/project",
    ref: "",
    directory: ""
  },
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
  it("scans the selected local source and imports a selected result", async () => {
    const onScan = vi.fn().mockResolvedValue(scanResult);
    const onImport = vi.fn().mockResolvedValue(true);
    render(
      <ProjectSkillDiscoveryPanel
        rootPath="/tmp/project"
        onScan={onScan}
        onImport={onImport}
      />
    );

    expect(await screen.findByText("Review")).toBeInTheDocument();
    expect(screen.getByText(".agents/skills/review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(
      "/tmp/project/.agents/skills/review",
      expect.objectContaining({ sourceSubpath: ".agents/skills/review" })
    ));
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
  });

  it("rescans the selected source manually", async () => {
    const onScan = vi.fn().mockResolvedValue(scanResult);
    render(
      <ProjectSkillDiscoveryPanel
        rootPath="/tmp/project"
        onScan={onScan}
        onImport={vi.fn().mockResolvedValue(false)}
      />
    );

    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
  });

  it("keeps an import failure beside the affected Skill and offers retry", async () => {
    const onScan = vi.fn().mockResolvedValue(scanResult);
    const onImport = vi.fn().mockRejectedValue(new Error("The Library directory is read-only"));
    render(
      <ProjectSkillDiscoveryPanel
        rootPath="/tmp/project"
        onScan={onScan}
        onImport={onImport}
      />
    );

    await screen.findByText("Review");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText("Import failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("imports every ready Skill and preserves the ZIP as one-time provenance", async () => {
    const result = {
      ...scanResult,
      candidates: [
        scanResult.candidates[0],
        {
          ...scanResult.candidates[0],
          id: "docs",
          name: "Docs",
          path: "/tmp/archive/docs",
          relativePath: "docs"
        }
      ]
    };
    const onScan = vi.fn().mockResolvedValue(result);
    const onImport = vi.fn().mockResolvedValue(true);
    render(
      <ProjectSkillDiscoveryPanel
        rootPath="/tmp/extracted"
        sourceKind="archive"
        sourcePath="/tmp/skills.zip"
        onScan={onScan}
        onImport={onImport}
      />
    );

    await screen.findByText("Skills in this ZIP");
    fireEvent.click(screen.getByRole("button", { name: "Import all" }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
    expect(onImport).toHaveBeenNthCalledWith(
      1,
      "/tmp/project/.agents/skills/review",
      undefined,
      { kind: "local", locator: "/tmp/skills.zip", subpath: ".agents/skills/review" }
    );
    expect(onImport).toHaveBeenNthCalledWith(
      2,
      "/tmp/archive/docs",
      undefined,
      { kind: "local", locator: "/tmp/skills.zip", subpath: "docs" }
    );
  });
});
