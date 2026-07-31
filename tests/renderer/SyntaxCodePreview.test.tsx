// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SyntaxCodePreview } from "../../src/renderer/components/SyntaxCodePreview";

afterEach(cleanup);

describe("SyntaxCodePreview", () => {
  it("renders readable fallback content before applying file-aware highlighting", async () => {
    const { container } = render(
      <SyntaxCodePreview
        className="custom-preview"
        code={"const ready: boolean = true;\n"}
        path="scripts/check.ts"
      />
    );

    expect(screen.getByText(/const ready/)).toBeInTheDocument();
    expect(container.querySelector("pre")).toHaveClass("syntax-code-preview", "custom-preview");
    await waitFor(() =>
      expect(container.querySelector(".syntax-code-preview__line span[style*='color']"))
        .toBeInTheDocument()
    );
  });
});
