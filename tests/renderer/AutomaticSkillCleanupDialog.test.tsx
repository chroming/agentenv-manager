// @vitest-environment jsdom

import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomaticSkillCleanupDialog } from "../../src/renderer/components/AutomaticSkillCleanupDialog";

afterEach(cleanup);

describe("AutomaticSkillCleanupDialog", () => {
  it("uses semantic item status and promotes Close after the run finishes", () => {
    render(
      <AutomaticSkillCleanupDialog
        items={[{
          effect: "adopt-managed-copy",
          skillKey: "reviewer",
          name: "Reviewer",
          paths: ["/tmp/reviewer"]
        }]}
        progress={{ reviewer: { status: "managed" } }}
        running={false}
        stopRequested={false}
        dialogRef={createRef<HTMLElement>()}
        initialFocusRef={createRef<HTMLButtonElement>()}
        onClose={vi.fn()}
        onRun={vi.fn()}
        onStop={vi.fn()}
      />
    );

    expect(screen.getByText("Managed").closest(".cleanup-bulk-item__status"))
      .toHaveClass("is-managed");
    expect(screen.getByRole("button", { name: "Close" }))
      .toHaveClass("ui-button--primary");
  });
});
