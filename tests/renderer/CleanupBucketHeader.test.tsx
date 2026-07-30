// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CleanupBucketHeader } from "../../src/renderer/components/CleanupBucketHeader";

describe("CleanupBucketHeader", () => {
  it("uses the complete collapsible heading as the disclosure button", () => {
    const onToggle = vi.fn();

    render(
      <CleanupBucketHeader
        bucket="managed"
        count={3}
        readyCleanupCount={0}
        actionDisabled={false}
        actionWorking={false}
        collapsible
        expanded={false}
        onReviewCleanup={vi.fn()}
        onToggle={onToggle}
      />
    );

    const heading = screen.getByRole("button", { name: "Expand Managed" });
    expect(heading).toHaveClass(
      "cleanup-bucket-heading",
      "cleanup-bucket-heading--managed",
      "cleanup-bucket-disclosure"
    );
    expect(heading).toHaveTextContent("Managed3");
    expect(heading).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(heading);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
