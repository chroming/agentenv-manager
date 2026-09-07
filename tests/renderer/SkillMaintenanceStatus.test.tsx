// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillMaintenanceStatus } from "../../src/renderer/components/SkillMaintenanceStatus";
import { skillMaintenanceState } from "../../src/renderer/skillMaintenanceState";
import type { SkillUpdateInfo } from "../../src/shared/types";

afterEach(cleanup);
const update: SkillUpdateInfo = { id: "review", name: "review", sourceType: "git", updateAvailable: true };

describe("shared Skill maintenance semantics", () => {
  it("prioritizes disabled, untracked, removed and failed states over a stale update flag", () => {
    expect(skillMaintenanceState({ globallyEnabled: false, updatePolicy: "tracked" }, update)).toBe("disabled");
    expect(skillMaintenanceState({ updatePolicy: "untracked" }, update)).toBe("untracked");
    expect(skillMaintenanceState({ updatePolicy: "tracked" }, { ...update, sourceStatus: "removed" })).toBe("removed");
    expect(skillMaintenanceState({ updatePolicy: "tracked" }, { ...update, error: "Offline" })).toBe("error");
    expect(skillMaintenanceState({ updatePolicy: "tracked" }, update)).toBe("update");
  });

  it.each([
    ["disabled", "Disabled", "neutral"],
    ["untracked", "No update checks", "neutral"],
    ["unchecked", "Not checked", "neutral"],
    ["current", "Up to date", "neutral"],
    ["removed", "Removed upstream", "warning"],
    ["error", "Check failed", "danger"]
  ] as const)("maps %s to the same label and tone everywhere", (state, label, tone) => {
    render(<SkillMaintenanceStatus state={state} />);
    const status = screen.getByText(label).closest(".ui-interactive-status")!;
    expect(status).toHaveAttribute("data-tone", tone);
    expect(status).toHaveClass("ui-interactive-status--metadata");
  });

  it("offers a retry without disguising failure as an update", () => {
    const retry = vi.fn();
    render(<SkillMaintenanceStatus state="error" detail="Network unavailable" onReview={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Check failed" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveAttribute("title", "Network unavailable");
  });
});
