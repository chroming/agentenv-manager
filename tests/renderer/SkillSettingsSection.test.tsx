// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillSettingsSection } from "../../src/renderer/components/SkillSettingsSection";
import type { AgentEnvSettings } from "../../src/shared/types";

afterEach(cleanup);

const settings: AgentEnvSettings = {
  locale: "system",
  conversationTerminal: "default",
  skillSyncMethod: "symlink",
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60,
  backupRetentionDays: null
};

describe("Skill settings", () => {
  it("preserves a multi-keystroke interval draft and commits only after editing", () => {
    const onChange = vi.fn();
    render(<SkillSettingsSection busy={false} settings={settings} onChange={onChange} />);

    const interval = screen.getByLabelText("Skill auto check interval minutes");
    fireEvent.change(interval, { target: { value: "1" } });
    expect(interval).toHaveValue(1);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(interval, { target: { value: "15" } });
    expect(interval).toHaveValue(15);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(interval);
    expect(onChange).toHaveBeenCalledWith({ skillAutoCheckIntervalMinutes: 15 });
  });

  it("keeps an invalid interval draft visible and explains the valid range", () => {
    const onChange = vi.fn();
    render(<SkillSettingsSection busy={false} settings={settings} onChange={onChange} />);

    const interval = screen.getByLabelText("Skill auto check interval minutes");
    fireEvent.change(interval, { target: { value: "1" } });
    fireEvent.blur(interval);

    expect(interval).toHaveValue(1);
    expect(interval).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a value from 5 to 1440.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
